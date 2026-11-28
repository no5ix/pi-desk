import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const { isVerboseLogging } = require("../bin/pi-web-options.js");
const { attachReadyHandoff } = require("../lib/browser-open.js");

// The fixture below spawns the real launchers out of a temp tree, so every
// module a launcher requires has to be copied into that tree. `bin/worktree-port.js`
// joined this list when the dev launchers started resolving a worktree-aware
// port: without it the spawn dies with MODULE_NOT_FOUND and the assertion that
// follows reports a status code, which reads like a launcher bug.
const FIXTURE_FILES = [
  "bin/pi-web-options.js",
  "bin/pi-web-node-args.js",
  "bin/worktree-port.js",
  "bin/process-lifecycle.js",
  "bin/pi-web.js",
  "bin/rotate-preview-secrets.js",
  "bin/node-version.js",
  "bin/network-exposure-warning.js",
  "bin/keep-alive.js",
  "bin/server-flags.js",
  "lib/browser-open.js",
  "scripts/web-dev.mjs",
  "next.config.ts",
];
const FIXTURE_LAUNCHERS = ["scripts/web-dev.mjs", "bin/pi-web.js"];

test("the launcher fixture copies every module the launched scripts require", async () => {
  const copied = new Set(FIXTURE_FILES);
  for (const launcher of FIXTURE_LAUNCHERS) {
    const source = await readFile(new URL(`../${launcher}`, import.meta.url), "utf8");
    for (const spec of source.matchAll(/require\("(\.\.?\/[^"]+)"\)/g)) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(launcher), spec[1]));
      const resolved = copied.has(base) || copied.has(`${base}.js`) ? (copied.has(base) ? base : `${base}.js`) : null;
      assert.ok(
        resolved,
        `${launcher} requires ${spec[1]}, which the fixture does not copy. Add the file to FIXTURE_FILES.`,
      );
    }
  }
});

test("Next's native request logging is opt-in and excludes query values", async () => {
  const previous = process.env.PI_WEB_VERBOSE;
  try {
    for (const value of [undefined, "0", "false", "1", "TRUE", " on "]) {
      if (value === undefined) delete process.env.PI_WEB_VERBOSE;
      else process.env.PI_WEB_VERBOSE = value;
      const { default: config } = await import(`../next.config.ts?logging-test=${encodeURIComponent(String(value))}`);
      const verbose = isVerboseLogging();
      const incoming = config.logging.incomingRequests;
      if (!verbose) assert.equal(incoming, false);
      else {
        assert.equal(incoming.ignore.some(pattern => pattern.test("/api/models")), false);
        for (const url of ["/api/files/private?type=read", "/api/web-auth?password=secret", "/?token=secret"]) {
          assert.equal(incoming.ignore.some(pattern => pattern.test(url)), true);
        }
      }
      assert.equal(config.logging.browserToTerminal, "warn");
      assert.equal(config.logging.serverFunctions, false);
      assert.equal(config.logging.fetches, undefined);
    }
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_VERBOSE;
    else process.env.PI_WEB_VERBOSE = previous;
  }
});

test("the existing handoff immediately preserves unknown, multiline and partial output", () => {
  const stdout = new PassThrough();
  let output = "";
  attachReadyHandoff(stdout, { port: "0", wantOpen: false, forward: text => { output += text; } });
  const chunks = ["Warning: diagnostic example\n", " GET /example 200 in 1ms\n    at example.js:1:1\n", "partial warning without a newline"];
  for (const chunk of chunks) {
    const before = output;
    stdout.write(chunk);
    assert.equal(output, before + chunk);
  }
  stdout.end();
});

// Real npm/production launchers and handoff, with a deterministic Next stand-in.
// This verifies wiring, not a real Next server or real file/tool response paths.
test("launchers propagate verbosity and retain startup, diagnostics and unknown stdout", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-web-logging-"));
  try {
    for (const directory of ["bin", "lib", "scripts", ".next", "node_modules/next/dist/bin"]) await mkdir(path.join(dir, directory), { recursive: true });
    for (const file of FIXTURE_FILES) {
      await cp(new URL(`../${file}`, import.meta.url), path.join(dir, file));
    }
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { web: "node scripts/web-dev.mjs" } }));
    await writeFile(path.join(dir, "node_modules/next/package.json"), JSON.stringify({ name: "next", version: "0.0.0" }));
    await writeFile(path.join(dir, "node_modules/next/dist/bin/next.js"), `
      (async () => {
        const { default: config } = await import(require("node:url").pathToFileURL(require("node:path").join(process.cwd(), "next.config.ts")));
        const incoming = config.logging.incomingRequests;
        console.log("✓ Ready in 1s");
        if (incoming && !incoming.ignore.some(pattern => pattern.test("/api/models"))) console.log(" GET /api/models 200 in 1ms");
        if (incoming && !incoming.ignore.some(pattern => pattern.test("/?token=fixture-secret"))) console.log(" GET /?token=fixture-secret 200 in 1ms");
        console.log("Warning: diagnostic example\\n GET /example 200 in 1ms\\n    at example.js:1:1");
        process.stdout.write("partial warning without a newline");
        console.warn("fixture warning"); console.error("fixture error");
        process.exitCode = 7;
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `);
    for (const mode of ["quiet", "flag", "short", "env", "production-quiet", "production-verbose"]) {
      const verbose = !["quiet", "production-quiet"].includes(mode);
      const production = mode.startsWith("production");
      const flags = ["--no-open", "-p", "0", ...(["flag", "production-verbose"].includes(mode) ? ["--verbose"] : mode === "short" ? ["-v"] : [])];
      const command = production ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
      const args = production ? ["bin/pi-web.js", ...flags] : ["run", "web", "--", ...flags];
      const result = spawnSync(command, args, {
        cwd: dir, encoding: "utf8", timeout: 15000,
        env: { ...process.env, PI_WEB_VERBOSE: mode === "env" ? "true" : "0", PI_WEB_HOSTNAME: "127.0.0.1", PI_WEB_NO_OPEN: "1" },
        shell: !production && process.platform === "win32",
      });
      assert.equal(result.status, 7, result.stderr);
      assert.match(result.stdout, /Ready in 1s/);
      const printedPort = result.stdout.match(/pi-web: http:\/\/127\.0\.0\.1:(\d+)/);
      assert.ok(
        printedPort,
        `the handoff must print the canonical URL. stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
      if (production) {
        // The production launcher forwards the requested port verbatim.
        assert.equal(printedPort[1], "0", `production forwarded port: ${result.stdout}`);
      } else {
        // The dev launchers resolve the port before Next starts, so `-p 0` means
        // "give me an OS-assigned ephemeral port" and the printed URL names the
        // port the server was actually told to use, never the literal 0.
        const resolved = Number(printedPort[1]);
        assert.ok(
          Number.isInteger(resolved) && resolved > 0 && resolved <= 65535,
          `the dev launcher must resolve -p 0 to a real ephemeral port, printed ${printedPort[1]}`,
        );
      }
      assert.equal(result.stdout.includes("GET /api/models"), verbose);
      assert.match(result.stdout, /Warning: diagnostic example\n GET \/example 200 in 1ms\n    at example.js:1:1/);
      assert.match(result.stdout, /partial warning without a newline/);
      assert.match(result.stderr, /fixture warning/);
      assert.match(result.stderr, /fixture error/);
      assert.match(result.stderr, /exited unexpectedly \(code 7\)/);
      assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
