// The keep-alive window of the production HTTP server (`next start`).
//
// Next retires an idle keep-alive connection five seconds after the last response. A
// browser keeps its idle sockets and reuses one, and when the server closes it at the same
// moment the request is refused. The service worker answers a refused navigation with a
// fallback page, so the user sees "Pi Web is offline" on a healthy server, and a second
// refresh works (e2e/offline-navigation.mjs). The server's window has to outlast the
// browser's reuse window, so it is minutes, not seconds.
//
// The same number is written into package.json's `start` script; scripts/prod-server-flags.test.mjs
// fails when the two drift.

const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 65000;
const MIN_KEEP_ALIVE_TIMEOUT_MS = 5000;
const MAX_KEEP_ALIVE_TIMEOUT_MS = 600000;

/** The flag pair for next's CLI, with PI_WEB_KEEP_ALIVE_TIMEOUT_MS honoured. */
function keepAliveArgs(env = process.env) {
  return ["--keepAliveTimeout", String(keepAliveTimeoutMs(env))];
}

function keepAliveTimeoutMs(env = process.env) {
  const raw = env.PI_WEB_KEEP_ALIVE_TIMEOUT_MS;
  if (raw === undefined || raw === "") return DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
  return Math.min(MAX_KEEP_ALIVE_TIMEOUT_MS, Math.max(MIN_KEEP_ALIVE_TIMEOUT_MS, Math.round(parsed)));
}

module.exports = {
  DEFAULT_KEEP_ALIVE_TIMEOUT_MS,
  MIN_KEEP_ALIVE_TIMEOUT_MS,
  MAX_KEEP_ALIVE_TIMEOUT_MS,
  keepAliveArgs,
  keepAliveTimeoutMs,
};
