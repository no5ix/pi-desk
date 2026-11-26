// `npm run dev:lan` / `npm run start:lan`: next on 0.0.0.0, with PI_WEB_HOSTNAME set so the
// server knows it is exposed (it switches off what must stay on this computer, such as a
// chat reading the user's files). Setting it from a script keeps it working on Windows.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { checkNetworkExposure } = require("../bin/network-exposure-warning.js");
const { keepAliveArgs } = require("../bin/keep-alive.js");
const { wireChildProcessLifecycle } = require("../bin/process-lifecycle.js");
const { applyDevEnvDefaults, applyServerMemoryEnv } = require("../bin/server-flags.js");

const HOSTNAME = "0.0.0.0";
const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node scripts/lan-server.mjs <dev|start>");
  process.exit(1);
}

const exposure = checkNetworkExposure(HOSTNAME);
if (exposure) console.warn(exposure.message);
if (exposure?.fatal) process.exit(1);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
// Next's production server retires an idle keep-alive connection after five seconds, and a
// browser happily reuses a socket the server closed at the same moment: the request is
// refused, and the service worker answers that with a fallback page (e2e/offline-navigation.mjs).
// The server's window has to outlast the browser's reuse window. See bin/keep-alive.js.
const keepAlive = mode === "start" ? keepAliveArgs(process.env) : [];
// One heap ceiling for every way of starting the server, dev included:
// `next dev` on its own gives the server child half of physical RAM.
const env = { ...process.env, PI_WEB_HOSTNAME: HOSTNAME };
applyServerMemoryEnv(env, mode);
if (mode === "dev") applyDevEnvDefaults(env);
const child = spawn(process.execPath, [nextBin, mode, "-H", HOSTNAME, "-p", "30141", ...keepAlive], {
  cwd: root,
  stdio: "inherit",
  env,
});
wireChildProcessLifecycle(child);
