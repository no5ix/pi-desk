// The V8 heap ceiling of the pi-web server, for every way of running it.
//
// `next dev` forks the real server as a child and, when nothing else set a heap
// ceiling, gives it HALF OF PHYSICAL RAM (node_modules/next/dist/cli/next-dev.js
// reads `getMaxOldSpaceSize()` from NODE_OPTIONS and falls back to
// `totalmem() * 0.5`). On a 128 GB machine that is a 65 536 MB heap: V8 has no
// reason to compact, so the heap walks up to whatever the workload touched —
// measured 18.6 GB peak / 10.6 GB steady while a few agent sessions ran — and
// macOS never gets those pages back, so the number stays there after every
// session has finished.
//
// The server holds every loaded session's full transcript in the heap, so an
// explicit ceiling is what turns "unbounded" into "GC at a budget". It is the
// load-bearing half of the memory fix; releasing sessions (lib/idle-session-cap.ts,
// lib/rpc-manager.ts) only pays off under one.
//
// Dev gets the larger budget: a dev session browses large transcripts, runs
// subagents, and Turbopack lives in the same process. Production gets a smaller
// one, because the caches are already byte-capped (lib/session-reader.ts's
// SessionManager cache caps 256 MiB of transcripts, lib/idle-session-cap.ts caps
// 64 MiB of idle wrappers) and a lower ceiling makes V8 return pages.
//
// `next start` runs the server in the process the CLI launched, and the desktop
// sidecar requires the server in-process, so this is written into NODE_OPTIONS
// (the one place a forked child inherits and Next itself honours) rather than
// into a child's execArgv.
//
// The same number is asserted for every entry point by
// scripts/server-flags.test.mjs, the way scripts/prod-server-flags.test.mjs
// pins --keepAliveTimeout.

const DEFAULT_DEV_MAX_OLD_SPACE_MB = 2048;
const DEFAULT_PROD_MAX_OLD_SPACE_MB = 1536;
// Below this the server cannot hold one large transcript, and V8 spends its
// time collecting. Above 64 GiB the flag stops being a budget at all.
const MIN_MAX_OLD_SPACE_MB = 512;
const MAX_MAX_OLD_SPACE_MB = 64 * 1024;
// `PI_WEB_MAX_OLD_SPACE_SIZE=0` (or `off`/`none`): pass nothing, so Next's and
// V8's own defaults apply. Kept for anyone measuring with the default ceiling.
const DISABLED_VALUES = new Set(["0", "off", "none", "default"]);

/** The heap ceiling in MB for a mode, 0 when the flag is switched off. */
function maxOldSpaceMb(mode, env = process.env) {
  const fallback = mode === "dev" ? DEFAULT_DEV_MAX_OLD_SPACE_MB : DEFAULT_PROD_MAX_OLD_SPACE_MB;
  const raw = (env.PI_WEB_MAX_OLD_SPACE_SIZE ?? "").trim();
  if (raw === "") return fallback;
  if (DISABLED_VALUES.has(raw.toLowerCase())) return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[pi-web] invalid PI_WEB_MAX_OLD_SPACE_SIZE "${raw}", using ${fallback} MB`);
    return fallback;
  }
  const clamped = Math.min(MAX_MAX_OLD_SPACE_MB, Math.max(MIN_MAX_OLD_SPACE_MB, Math.round(parsed)));
  if (clamped !== Math.round(parsed)) {
    console.warn(`[pi-web] PI_WEB_MAX_OLD_SPACE_SIZE ${parsed} MB clamped to ${clamped} MB`);
  }
  return clamped;
}

/** Whether NODE_OPTIONS already sets a heap ceiling, in either spelling. */
function hasMaxOldSpaceOption(nodeOptions) {
  return /--max[-_]old[-_]space[-_]size(=|\s)/.test(nodeOptions);
}

/**
 * NODE_OPTIONS with the heap ceiling appended. An existing `--max-old-space-size`
 * (a shell's own NODE_OPTIONS, or a debugger wrapper) always wins: two values
 * for one flag make Node refuse to start, and the operator's explicit number is
 * the one to keep.
 */
function nodeOptionsWithServerMemory(env = process.env, mode = "start") {
  const current = env.NODE_OPTIONS ?? "";
  const mb = maxOldSpaceMb(mode, env);
  if (mb === 0 || hasMaxOldSpaceOption(current)) return current;
  return current ? `${current} --max-old-space-size=${mb}` : `--max-old-space-size=${mb}`;
}

/**
 * Apply the ceiling to a spawn env in place and return it. Every launcher that
 * starts the server calls this, so no entry point runs without a ceiling.
 */
function applyServerMemoryEnv(env = process.env, mode = "start") {
  const nodeOptions = nodeOptionsWithServerMemory(env, mode);
  if (nodeOptions) env.NODE_OPTIONS = nodeOptions;
  return env;
}

/**
 * Dev-only session defaults, applied to a dev server's env when the operator
 * set nothing. A dev process is opened for hours at a time and browsed, and the
 * production defaults (a wrapper stays warm ten minutes to make switching back
 * instant; MCP servers idle out after ten minutes) are tuned for a server that
 * restarts. Under a capped heap they pin transcripts that are no longer looked
 * at, so dev releases them minutes after the page leaves.
 */
const DEV_ENV_DEFAULTS = {
  PI_WEB_IDLE_TIMEOUT_MS: "120000",
  PI_WEB_MCP_IDLE_MS: "120000",
  // The budget is the server's *managed* memory — the V8 heap plus the external
  // stores bound to JS, what releasing and collecting can act on — and not RSS.
  // RSS counts the read-only library mappings (the dyld shared cache, resident)
  // and Turbopack's mmap'd module graph, so a budget built on it had a healthy
  // dev server over budget from its first minute: measured 2.9 GB of RSS against
  // 0.55 GB of heap and external stores, and a valve releasing 1 MB a minute.
  // Set at the dev heap ceiling: managed memory above the ceiling is growth
  // outside the heap (external buffers, native stores), which is the signal in
  // dev that the valve exists for.
  PI_WEB_MEMORY_BUDGET_MB: "2048",
};

function applyDevEnvDefaults(env = process.env) {
  for (const [key, value] of Object.entries(DEV_ENV_DEFAULTS)) {
    if (env[key] === undefined || String(env[key]).trim() === "") env[key] = value;
  }
  return env;
}

module.exports = {
  DEFAULT_DEV_MAX_OLD_SPACE_MB,
  DEFAULT_PROD_MAX_OLD_SPACE_MB,
  DEV_ENV_DEFAULTS,
  MAX_MAX_OLD_SPACE_MB,
  MIN_MAX_OLD_SPACE_MB,
  applyDevEnvDefaults,
  applyServerMemoryEnv,
  hasMaxOldSpaceOption,
  maxOldSpaceMb,
  nodeOptionsWithServerMemory,
};
