import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const {
  DEFAULT_SERVE_PORT,
  EPHEMERAL_PORT_MIN,
  resolveServePort,
  isAutoServePort,
  parseServeProxyPorts,
  hasServeProxy,
  formatServeLog,
  tailscaleServeDisabled,
  ensureTailscaleServe,
  startTailscaleServeAtStartup,
} = await createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false })
  .import("./tailscale-serve.ts");

// The startup tailnet setup (Settings › Remote access used to only print this command
// for the user to paste). No test here runs the tailscale CLI: the pure parts are
// checked directly, the wiring by source sentinel.

const SERVE_STATUS = [
  "https://macb00kpr0m4.taila0e40f.ts.net (tailnet only)",
  "|-- / proxy http://127.0.0.1:30141",
  "",
].join("\n");

test("the served port comes from the launch flags, then PORT, then 30141", () => {
  assert.equal(resolveServePort({}, ["node", "next", "dev", "-H", "127.0.0.1", "-p", "30141"]), 30141);
  assert.equal(resolveServePort({}, ["node", "next", "start", "--port", "30500"]), 30500);
  assert.equal(resolveServePort({}, ["node", "next", "dev", "--port=30777"]), 30777);
  assert.equal(resolveServePort({ PORT: "3099" }, ["node", "server.js"]), 3099);
  assert.equal(resolveServePort({}, []), DEFAULT_SERVE_PORT);
  assert.equal(resolveServePort({ PORT: "not-a-port" }, []), DEFAULT_SERVE_PORT);
  assert.equal(resolveServePort({}, ["node", "next", "dev", "-p"]), DEFAULT_SERVE_PORT, "a trailing -p is no port");
  assert.equal(resolveServePort({ PORT: "70000" }, []), DEFAULT_SERVE_PORT, "out of range falls back");
});

// The machine's `tailscale serve` config has one `/` handler, so registering the
// wrong port moves every Pi on the computer onto a port that stops listening.
// 55530 is the real one: an OS-assigned port a packaged-server run got, and the
// tailnet URL then served nothing.
test("only a launched port is worth the tailnet config, an OS-assigned one is not", () => {
  assert.equal(isAutoServePort(30141), true, "`npm run dev/start` pass -p 30141");
  assert.equal(isAutoServePort(38471), true, "the packaged app's preferred port");
  assert.equal(isAutoServePort(EPHEMERAL_PORT_MIN - 1), true, "the last registered port");
  assert.equal(isAutoServePort(EPHEMERAL_PORT_MIN), false, "the ephemeral range starts here");
  assert.equal(isAutoServePort(55530), false, "what this machine's app once got");
  assert.equal(
    isAutoServePort(resolveServePort({ PORT: "55530" }, [])),
    false,
    "PORT=<free port> resolves to that port, and the startup refuses it",
  );
  assert.equal(isAutoServePort(0), false);
  assert.equal(isAutoServePort(Number.NaN), false);
  assert.equal(isAutoServePort(70000), false, "out of range");
});

test("an OS-assigned port touches nothing: no `serve status`, no `serve --bg`", async () => {
  const outcome = await ensureTailscaleServe(55530);
  assert.equal(outcome.state, "ephemeral");
  assert.equal(outcome.status, "", "no CLI ran at all, so the serve config cannot be read or rewritten");
  assert.match(outcome.detail, /55530/);
  assert.match(outcome.detail, /tailscale serve --bg 55530/, "the line says how to register it by hand");
});

test("`tailscale serve status` is read for the ports it proxies", () => {
  assert.deepEqual(parseServeProxyPorts(SERVE_STATUS), [30141]);
  assert.equal(hasServeProxy(SERVE_STATUS, 30141), true);
  assert.equal(hasServeProxy(SERVE_STATUS, 30142), false, "a different port means serve --bg must run");
  assert.deepEqual(parseServeProxyPorts("https://mac.ts.net (tailnet only)"), [], "no proxy block");
  assert.deepEqual(
    parseServeProxyPorts("proxy http://localhost:30141\nproxy https://127.0.0.1:443\nproxy http://[::1]:8080"),
    [30141, 443, 8080],
  );
});

test("the status block prints green, one ANSI pair per line", () => {
  const printed = formatServeLog("a\nb\n");
  assert.ok(printed.includes("\x1b[32m"), "green");
  assert.ok(printed.includes("\x1b[0m"), "reset");
  assert.equal(printed.split("\n").length, 2, "the trailing newline of the CLI output is not an empty line");
  assert.equal(printed, "\x1b[32ma\x1b[0m\n\x1b[32mb\x1b[0m");
});

test("PI_WEB_DISABLE_TAILSCALE_SERVE=1 turns the startup work off", () => {
  assert.equal(tailscaleServeDisabled({}), false);
  assert.equal(tailscaleServeDisabled({ PI_WEB_DISABLE_TAILSCALE_SERVE: "1" }), true);
  assert.equal(tailscaleServeDisabled({ PI_WEB_DISABLE_TAILSCALE_SERVE: "true" }), true);
  assert.equal(tailscaleServeDisabled({ PI_WEB_DISABLE_TAILSCALE_SERVE: "0" }), false);
});

test("startTailscaleServeAtStartup is off for non-macOS and disabled, and never awaits", () => {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  try {
    assert.equal(startTailscaleServeAtStartup({}, () => assert.fail("must not log on linux")), undefined);
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  }
  assert.equal(startTailscaleServeAtStartup({ PI_WEB_DISABLE_TAILSCALE_SERVE: "1" }, () => assert.fail("must not log when disabled")), undefined);
  assert.equal(typeof ensureTailscaleServe, "function");
  void original;
});

test("the server boot hook starts it unawaited and keeps the other boot markers", () => {
  const source = readFileSync(new URL("../instrumentation-node.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ startTailscaleServeAtStartup \} from "@\/lib\/tailscale-serve";/);
  assert.match(source, /^\s*startTailscaleServeAtStartup\(\);$/m, "called bare: register() must not await the CLI");
  for (const marker of ["startScheduler", "restartRelayFromConfig()", "applyCodemodeWorkerDefault();", "configureHttpDispatcher("]) {
    assert.ok(source.includes(marker), `boot marker ${marker} stays (fork-extractions.test.mjs pins it)`);
  }
});

test("the startup says why an OS-assigned port was skipped, and adds nothing", async () => {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  const lines = [];
  try {
    startTailscaleServeAtStartup({ PORT: "55530" }, (line) => lines.push(line));
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  }
  assert.equal(lines.length, 1, `one line, got ${JSON.stringify(lines)}`);
  assert.match(lines[0], /not serving 55530/);
  assert.ok(!lines[0].includes("https://"), "no green serve status is printed for a refused port");
});

test("the e2e server env never opens a real tailnet listener", async () => {
  const { createE2EServerEnv } = await createJiti(import.meta.url, { interopDefault: true, moduleCache: false })
    .import("../scripts/e2e-server-env.mjs");
  const env = createE2EServerEnv({ PATH: "/usr/bin" }, "/tmp/agent-dir", "dev");
  assert.equal(env.PI_WEB_DISABLE_TAILSCALE_SERVE, "1");
});

test("the packaged-server verify run never opens a real tailnet listener", () => {
  // It boots the staged server on a free port (PORT=<free port>), the exact launch
  // shape that moved this machine's tailnet URL onto 55530.
  const source = readFileSync(new URL("../scripts/verify-packaged-codemode.mjs", import.meta.url), "utf8");
  assert.match(source, /PI_WEB_DISABLE_TAILSCALE_SERVE: "1"/);
});
