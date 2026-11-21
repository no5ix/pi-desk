import { execFile } from "node:child_process";

import {
  readTailscaleStatusUncached,
  tailscaleBinaries,
  type TailscaleStatus,
} from "./tailscale-status";

/**
 * Tailscale Serve at server startup.
 *
 * Settings › Remote access used to only hand the user a `tailscale serve --bg <port>`
 * string to paste in a terminal, so every restart of Pi dropped the tailnet listener
 * (or left it pointing at a port Pi no longer uses). This module runs that command
 * itself when the Node server boots, starts the Tailscale app when the daemon is not
 * up, and prints `tailscale serve status` in green so the startup log shows the
 * HTTPS name the phone opens.
 *
 * `register()` must stay fast (lib/browser-open.js waits for Next's `Ready` line), so
 * every caller here is fire-and-forget: startTailscaleServeAtStartup() never awaits.
 *
 * macOS only (the Tailscale app is what the fork supports, and the packaged app runs
 * the same server). `PI_WEB_DISABLE_TAILSCALE_SERVE=1` turns it off; the e2e harness
 * sets it so tests never touch a real tailnet.
 */

/** Pi's default port: `npm run dev/start` pass `-p 30141`, the bin falls back to PORT. */
export const DEFAULT_SERVE_PORT = 30141;

const CLI_TIMEOUT_MS = 10_000;
const DAEMON_WAIT_MS = 15_000;
const DAEMON_POLL_MS = 2_000;
const MACOS_TAILSCALE_APP = "/usr/bin/open";

const ANSI_GREEN = "\x1b[32m";
const ANSI_DIM = "\x1b[2m";
const ANSI_RESET = "\x1b[0m";

export type TailscaleServeState = "served" | "added" | "missing" | "stopped" | "failed";

export interface TailscaleServeOutcome {
  state: TailscaleServeState;
  port: number;
  /** `tailscale serve status` output when it could be read, else "". */
  status: string;
  detail?: string;
}

export function tailscaleServeDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.PI_WEB_DISABLE_TAILSCALE_SERVE;
  return flag === "1" || flag === "true";
}

/** The port this server listens on: `-p`/`--port` argv, then PORT, then 30141. */
export function resolveServePort(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): number {
  const flagIndex = argv.findIndex((arg) => arg === "-p" || arg === "--port");
  const inline = argv.find((arg) => arg.startsWith("--port="))?.slice("--port=".length);
  for (const candidate of [flagIndex >= 0 ? argv[flagIndex + 1] : undefined, inline, env.PORT]) {
    const port = Number(candidate);
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  }
  return DEFAULT_SERVE_PORT;
}

/** Ports `tailscale serve` proxies to this machine, e.g. `/ proxy http://127.0.0.1:30141`. */
export function parseServeProxyPorts(status: string): number[] {
  const ports: number[] = [];
  const pattern = /proxy\s+https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|::1):(\d{1,5})/g;
  for (const match of status.matchAll(pattern)) {
    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && !ports.includes(port)) ports.push(port);
  }
  return ports;
}

export function hasServeProxy(status: string, port: number): boolean {
  return parseServeProxyPorts(status).includes(port);
}

/** The status block the startup log prints, green, one ANSI pair per line. */
export function formatServeLog(status: string): string {
  const lines = status.trimEnd().split("\n").map((line) => line.trimEnd());
  return lines.map((line) => `${ANSI_GREEN}${line}${ANSI_RESET}`).join("\n");
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(binary: string, args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: CLI_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error
          ? typeof (error as { code?: unknown }).code === "number"
            ? (error as { code: number }).code
            : 1
          : 0;
        resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
      });
  });
}

/** The first tailscale binary that exists, else the bare name on PATH. */
export function serveBinaryCandidates(platform: NodeJS.Platform = process.platform): string[] {
  return tailscaleBinaries(platform);
}

async function readServeStatus(binary: string): Promise<string> {
  const result = await runCli(binary, ["serve", "status"]);
  // `serve status` exits non-zero while the daemon is busy; stdout is what matters.
  return result.stdout.trim();
}

async function startTailscaleDaemon(platform: NodeJS.Platform): Promise<boolean> {
  if (platform !== "darwin") return false;
  const opened = await runCli(MACOS_TAILSCALE_APP, ["-a", "Tailscale"]);
  if (opened.code !== 0) return false;
  const deadline = Date.now() + DAEMON_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, DAEMON_POLL_MS));
    if ((await readTailscaleStatusUncached()).state === "running") return true;
  }
  return false;
}

function statusDetail(status: TailscaleStatus): string {
  return status.state === "stopped"
    ? `Tailscale backend state: ${status.backendState}`
    : status.state === "missing"
      ? "The tailscale command was not found."
      : status.hostname;
}

/**
 * Make sure `tailscale serve` proxies `port`, then read its status.
 * Never throws: a missing CLI, a stopped daemon and a failing `serve` all come back
 * as a state the caller logs.
 */
export async function ensureTailscaleServe(port = resolveServePort()): Promise<TailscaleServeOutcome> {
  const binaries = serveBinaryCandidates();
  const binary = binaries[0];
  if (!binary) return { state: "missing", port, status: "", detail: statusDetail({ state: "missing" }) };

  let status = await readTailscaleStatusUncached();
  if (status.state === "stopped") {
    if (await startTailscaleDaemon(process.platform)) status = await readTailscaleStatusUncached();
  }
  if (status.state !== "running") {
    const serveStatus = await readServeStatus(binary);
    return {
      state: status.state === "missing" ? "missing" : "stopped",
      port,
      status: serveStatus,
      detail: statusDetail(status),
    };
  }

  const serveStatus = await readServeStatus(binary);
  if (hasServeProxy(serveStatus, port)) {
    return { state: "served", port, status: serveStatus, detail: statusDetail(status) };
  }
  const added = await runCli(binary, ["serve", "--bg", String(port)]);
  if (added.code !== 0 && !added.stdout.trim()) {
    return {
      state: "failed",
      port,
      status: serveStatus,
      detail: added.stderr.trim() || `tailscale serve --bg ${port} exited ${added.code}`,
    };
  }
  return {
    state: "added",
    port,
    status: (await readServeStatus(binary)) || added.stdout.trim(),
    detail: statusDetail(status),
  };
}

/**
 * Startup entry: called unawaited from registerNodeInstrumentation(), which keeps
 * Next's `Ready` line fast. macOS only, and off under PI_WEB_DISABLE_TAILSCALE_SERVE.
 */
export function startTailscaleServeAtStartup(
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = (line) => console.log(line),
): void {
  if (process.platform !== "darwin" || tailscaleServeDisabled(env)) return;
  const port = resolveServePort(env);
  void ensureTailscaleServe(port)
    .then((outcome) => {
      if (outcome.status) {
        log(`[tailscale] tailscale serve status (port ${outcome.port})\n${formatServeLog(outcome.status)}`);
      }
      if (outcome.state === "stopped" || outcome.state === "missing" || outcome.state === "failed") {
        log(`${ANSI_DIM}[tailscale] not serving ${outcome.port}: ${outcome.detail ?? outcome.state}${ANSI_RESET}`);
      }
    })
    .catch((error: unknown) => {
      log(`${ANSI_DIM}[tailscale] serve check failed: ${error instanceof Error ? error.message : String(error)}${ANSI_RESET}`);
    });
}
