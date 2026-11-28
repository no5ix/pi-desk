// Production server launcher with the same sequential port allocation as dev.
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { readPortArgument, resolveDevPort } = require("../bin/worktree-port.js");
const { wireChildProcessLifecycle } = require("../bin/process-lifecycle.js");

const pkgDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveNextBin() {
  try {
    return require.resolve("next/dist/bin/next", { paths: [pkgDir] });
  } catch {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    return path.join(path.dirname(nextPkg), "dist", "bin", "next");
  }
}

const args = process.argv.slice(2);
const port = await resolveDevPort({
  env: process.env,
  explicitPort: readPortArgument(args),
});
console.log(`[pi-web] production server port: ${port} · PI_WEB_PORT / --port override`);

const forwardedArgs = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--port" || arg === "-p") {
    index += 1;
    continue;
  }
  if (arg.startsWith("--port=") || arg.startsWith("-p=") || /^-p\d+$/.test(arg) || /^\d+$/.test(arg)) {
    continue;
  }
  forwardedArgs.push(arg);
}

const child = spawn(
  process.execPath,
  [resolveNextBin(), "start", "-H", "127.0.0.1", "--keepAliveTimeout", "65000", ...forwardedArgs, "-p", port],
  { cwd: pkgDir, stdio: "inherit", env: process.env },
);
wireChildProcessLifecycle(child);
