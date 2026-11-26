// `npm run dev`: `next dev` with the server's heap ceiling set.
//
// This launcher exists for one line of Next. When nothing set a heap ceiling,
// `next dev` forks the real server as a child with `--max-old-space-size` set to
// HALF OF PHYSICAL RAM (node_modules/next/dist/cli/next-dev.js). On a 128 GB
// machine that is a 64 GiB heap for a process that keeps every loaded session's
// full transcript in memory: the heap walks up to whatever the workload touched
// (measured 18.6 GB peak, 10.6 GB steady with a few agent sessions running) and
// macOS never gets those pages back, so the number stays after every session
// ends. `next-dev.js` honours a ceiling already in NODE_OPTIONS, so setting it
// there is both the fix and the only place a forked child inherits it.
// bin/server-flags.js holds the numbers and the reasoning.
//
// Dev also keeps sessions warm for less time (DEV_ENV_DEFAULTS): a dev process
// lives for hours and is browsed, while the production defaults keep a wrapper
// ten minutes to make switching back instant.
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getNextNodeArgs } = require("../bin/pi-web-node-args.js");
const { wireChildProcessLifecycle } = require("../bin/process-lifecycle.js");
const { applyDevEnvDefaults, applyServerMemoryEnv, maxOldSpaceMb } = require("../bin/server-flags.js");

const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveNextBin() {
  try {
    return require.resolve("next/dist/bin/next", { paths: [pkgDir] });
  } catch {
    try {
      const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
      return path.join(path.dirname(nextPkg), "dist", "bin", "next");
    } catch {
      return path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
    }
  }
}

const env = applyDevEnvDefaults(applyServerMemoryEnv({ ...process.env }, "dev"));
const heapMb = maxOldSpaceMb("dev", env);
// The line is the only place a developer sees which ceiling is live: a report of
// "the server ate 10 GB" has to name the number it ran under.
console.log(
  `[pi-web] dev server heap ceiling: ${heapMb > 0 ? `${heapMb} MB` : "Next's own default"}`
  + ` · idle sessions released after ${env.PI_WEB_IDLE_TIMEOUT_MS} ms`
  + " · PI_WEB_MAX_OLD_SPACE_SIZE / PI_WEB_IDLE_TIMEOUT_MS override",
);

const child = spawn(
  process.execPath,
  getNextNodeArgs(resolveNextBin(), ["dev", "-H", "127.0.0.1", "-p", "30141", ...process.argv.slice(2)]),
  {
    cwd: pkgDir,
    // Inherited, not piped: `next dev` writes its ready line, its progress and
    // its notices to a terminal, and nothing here has to read them.
    stdio: "inherit",
    env,
  },
);
wireChildProcessLifecycle(child);
