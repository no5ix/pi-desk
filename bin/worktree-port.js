"use strict";

const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { createServer } = require("node:net");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PORT = 30141;
const WORKTREE_PORT_START = 30200;
const WORKTREE_PORT_COUNT = 800;
const MAX_PORT_PROBES = 64;

function normalizePort(value) {
  const text = String(value);
  if (!/^\d+$/.test(text)) {
    throw new Error("Port must be a non-negative integer.");
  }
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port > 65535) {
    throw new Error("Port must be between 0 and 65535.");
  }
  return String(port);
}

function readPortArgument(args = []) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port" || arg === "-p") return args[index + 1];
    if (arg.startsWith("--port=")) return arg.slice("--port=".length);
    if (arg.startsWith("-p=")) return arg.slice("-p=".length);
    if (/^-p\d+$/.test(arg)) return arg.slice(2);
  }
  return undefined;
}

function findGitRoot(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

function isLinkedWorktreeRoot(root) {
  try {
    return fs.statSync(path.join(root, ".git")).isFile();
  } catch {
    return false;
  }
}

function worktreePortForPath(root) {
  const digest = createHash("sha256").update(path.resolve(root)).digest();
  return WORKTREE_PORT_START + (digest.readUInt32BE(0) % WORKTREE_PORT_COUNT);
}

function getPortCandidates(preferredPort) {
  const candidates = [Number(preferredPort)];
  const startOffset = Number(preferredPort) >= WORKTREE_PORT_START
    && Number(preferredPort) < WORKTREE_PORT_START + WORKTREE_PORT_COUNT
    ? Number(preferredPort) - WORKTREE_PORT_START
    : 0;
  for (let offset = 0; offset < WORKTREE_PORT_COUNT; offset += 1) {
    const candidate = WORKTREE_PORT_START + ((startOffset + offset) % WORKTREE_PORT_COUNT);
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function canListen(port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
      } else {
        reject(error);
      }
    });
    server.listen({ port: Number(port), host, exclusive: true }, () => {
      server.close((error) => error ? reject(error) : resolve(true));
    });
  });
}

function reserveEphemeralPort(host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen({ port: 0, host, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not determine the allocated development port.")));
        return;
      }
      const selectedPort = String(address.port);
      server.close((error) => error ? reject(error) : resolve(selectedPort));
    });
  });
}


async function resolveDevPort({
  cwd = process.cwd(),
  env = process.env,
  explicitPort,
  host = "127.0.0.1",
} = {}) {
  const envPort = typeof env.PI_WEB_PORT === "string" && env.PI_WEB_PORT.trim()
    ? env.PI_WEB_PORT
    : typeof env.PORT === "string" && env.PORT.trim()
      ? env.PORT
      : undefined;
  const requested = explicitPort ?? envPort;

  if (requested !== undefined && requested !== null) {
    const port = normalizePort(requested);
    if (port === "0") return reserveEphemeralPort(host);
    if (!(await canListen(port, host))) {
      throw new Error(
        "Requested port " + port + " is already in use. Choose another with --port or PI_WEB_PORT.",
      );
    }
    return port;
  }

  const root = findGitRoot(cwd);
  const preferredPort = root && isLinkedWorktreeRoot(root)
    ? worktreePortForPath(root)
    : DEFAULT_PORT;
  const candidates = getPortCandidates(preferredPort).slice(0, MAX_PORT_PROBES);

  for (const candidate of candidates) {
    if (await canListen(candidate, host)) return String(candidate);
  }

  throw new Error(
    "No available Pi Web development port found after checking " + candidates.length + " candidates. Set PI_WEB_PORT to choose one explicitly.",
  );
}

module.exports = {
  DEFAULT_PORT,
  WORKTREE_PORT_START,
  WORKTREE_PORT_COUNT,
  MAX_PORT_PROBES,
  normalizePort,
  readPortArgument,
  findGitRoot,
  isLinkedWorktreeRoot,
  worktreePortForPath,
  getPortCandidates,
  resolveDevPort,
};
