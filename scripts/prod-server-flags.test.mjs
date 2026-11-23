import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
  MAX_KEEP_ALIVE_TIMEOUT_MS,
  MIN_KEEP_ALIVE_TIMEOUT_MS,
  keepAliveArgs,
  keepAliveTimeoutMs,
} = require("../bin/keep-alive.js");

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

test("the keep-alive window outlasts a browser's socket reuse window", async () => {
  // Next's default is five seconds. A browser that reuses a socket the server retired at
  // that moment has its request refused, and the service worker answers a refused
  // navigation with a fallback page: a healthy local server shown as offline, fixed by a
  // second refresh. It has to be minutes.
  assert.ok(DEFAULT_KEEP_ALIVE_TIMEOUT_MS >= 30_000, "five seconds is the bug, not the fix");
  assert.ok(DEFAULT_KEEP_ALIVE_TIMEOUT_MS < MAX_KEEP_ALIVE_TIMEOUT_MS);
  assert.equal(keepAliveTimeoutMs({}), DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
  assert.equal(keepAliveTimeoutMs({ PI_WEB_KEEP_ALIVE_TIMEOUT_MS: "" }), DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
  assert.equal(keepAliveTimeoutMs({ PI_WEB_KEEP_ALIVE_TIMEOUT_MS: "nonsense" }), DEFAULT_KEEP_ALIVE_TIMEOUT_MS);
  assert.equal(keepAliveTimeoutMs({ PI_WEB_KEEP_ALIVE_TIMEOUT_MS: "120000" }), 120_000);
  assert.equal(keepAliveTimeoutMs({ PI_WEB_KEEP_ALIVE_TIMEOUT_MS: "1" }), MIN_KEEP_ALIVE_TIMEOUT_MS);
  assert.equal(keepAliveTimeoutMs({ PI_WEB_KEEP_ALIVE_TIMEOUT_MS: "99999999" }), MAX_KEEP_ALIVE_TIMEOUT_MS);
  assert.deepEqual(keepAliveArgs({ PI_WEB_KEEP_ALIVE_TIMEOUT_MS: "120000" }), ["--keepAliveTimeout", "120000"]);
});

test("every production entry point passes the flag to next start", async () => {
  const pkg = JSON.parse(await read("../package.json"));
  const flag = `--keepAliveTimeout ${DEFAULT_KEEP_ALIVE_TIMEOUT_MS}`;

  // `npm start`, `npm run start:lan`, and the published `pi-web` command are three
  // different ways to run the production server. The bug is only closed on all three.
  assert.match(pkg.scripts.start, new RegExp(flag.replace("$", "\\$")), "npm start");
  const lan = await read("./lan-server.mjs");
  assert.match(lan, /keepAliveArgs\(process\.env\)/, "npm run start:lan");
  assert.match(lan, /mode === "start" \? keepAliveArgs/, "the flag is a production-server flag");
  const bin = await read("../bin/pi-web.js");
  assert.match(bin, /nextArgs\.push\(\.\.\.keepAliveArgs\(process\.env\)\)/, "the published pi-web command");
  assert.match(bin, /require\("\.\/keep-alive"\)/, "the published pi-web command loads the module");
});

test("the published launcher keeps the flag pair intact", async () => {
  const args = keepAliveArgs({ PI_WEB_KEEP_ALIVE_TIMEOUT_MS: String(DEFAULT_KEEP_ALIVE_TIMEOUT_MS) });
  assert.deepEqual(args, ["--keepAliveTimeout", String(DEFAULT_KEEP_ALIVE_TIMEOUT_MS)]);
  // `next start` reads the flag as its own value: a single token would swallow the next.
  assert.equal(args.length, 2);
});
