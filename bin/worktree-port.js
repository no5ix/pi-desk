"use strict";

const { createServer } = require("node:net");

const DEFAULT_PORT = 30141;
const MAX_PORT = 65535;
const MAX_PORT_PROBES = MAX_PORT - DEFAULT_PORT + 1;

function normalizePort(value) {
  const text = String(value);
  if (!/^\\d+$/.test(text)) {
    throw new Error("Port must be a non-negative integer.");
  }
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port > MAX_PORT) {
    throw new Error("Port must be between 0 and 65535.");
  }
  return String(port);
}

function readPortArgument(args = [], env = process.env) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--port" || arg === "-p") return args[index + 1];
    if (arg.startsWith("--port=")) return arg.slice("--port=".length);
    if (arg.startsWith("-p=")) return arg.slice("-p=".length);
    if (/^-p\\d+$/.test(arg)) return arg.slice(2);
  }

  // npm consumes options written as `npm run dev --port 30146` instead of
  // forwarding them in argv. It exposes those options to lifecycle scripts
  // as npm_config_* environment variables.
  return typeof env.npm_config_port === "string" && env.npm_config_port.trim()
    ? env.npm_config_port
    : undefined;
}

function getPortCandidates(startPort = DEFAULT_PORT) {
  const start = Number(normalizePort(startPort));
  if (start === 0) return [0];
  return Array.from(
    { length: MAX_PORT - start + 1 },
    (_, index) => start + index,
  );
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

  const candidates = getPortCandidates(DEFAULT_PORT);
  for (const candidate of candidates) {
    if (await canListen(candidate, host)) return String(candidate);
  }

  throw new Error(
    "No available Pi Web development port found from " + DEFAULT_PORT + " through " + MAX_PORT + ". Set PI_WEB_PORT to choose one explicitly.",
  );
}

module.exports = {
  DEFAULT_PORT,
  MAX_PORT,
  MAX_PORT_PROBES,
  normalizePort,
  readPortArgument,
  getPortCandidates,
  resolveDevPort,
};
