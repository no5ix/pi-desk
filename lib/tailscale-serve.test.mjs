import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const {
  DEFAULT_SERVE_PORT,
  resolveServePort,
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

test("the e2e server env never opens a real tailnet listener", async () => {
  const { createE2EServerEnv } = await createJiti(import.meta.url, { interopDefault: true, moduleCache: false })
    .import("../scripts/e2e-server-env.mjs");
  const env = createE2EServerEnv({ PATH: "/usr/bin" }, "/tmp/agent-dir", "dev");
  assert.equal(env.PI_WEB_DISABLE_TAILSCALE_SERVE, "1");
});
