# Memory: what the server holds, and when it gives it back

pi-web runs the agent **in the server process**: a loaded session is a parsed
transcript, an SDK `AgentSession` with its extensions and MCP host, the SSE
backlog of every stream, and the caches that make browsing instant. This fork
runs that process for hours — desktop sidecar, dev server, a phone's tunnel to
the same server — so the question is not "can it be smaller" but "who releases
what, and when". Every rule below came from a measured leak.

## The heap ceiling is a policy, not a flag in a script

`bin/server-flags.js` decides the old-space ceiling and every entry point asks it:

| Entry point | How it applies |
| --- | --- |
| `npm run dev` (`scripts/dev-server.mjs`) | child argv `--max-old-space-size` |
| `scripts/web-dev.mjs`, `scripts/lan-server.mjs` | `NODE_OPTIONS` |
| `bin/pi-web.js` (`next start`) | `NODE_OPTIONS` on re-exec |
| `desktop/server-launcher.cjs` | `v8.setFlagsFromString` (its own worker) |

Defaults: **2048 MB dev, 1536 MB production and desktop**.
`PI_WEB_MAX_OLD_SPACE_SIZE` sets it in MB; `0`, `off`, `none`, `default` leave V8
alone; a ceiling already in `NODE_OPTIONS` wins; absurd values are clamped
(256 MB – 32 GB) and warned about. `scripts/server-flags.test.mjs` and
`scripts/prod-server-flags.test.mjs` pin the policy against every entry point,
so a new launcher that forgets it fails.

The reason it exists: `next dev` forks its server child with
`--max-old-space-size` = half of physical RAM (`next/dist/cli/next-dev.js`). On a
128 GB machine that is a 64 GB licence to grow, and the server grew to an 18.62 GB
peak. `next start` and the sidecar get V8's default (~4 GB), which is why
production never looked as bad as development while being just as unreleased.

A ceiling is a **collection trigger**, not a fix: V8 returns pages to the OS only
when its heap is tight. Measured, with a 1 GB ceiling and a 268 MB live set, the
process gave back **0 MB** of RSS when idle. So the ceiling travels together with
the budgets below: a ceiling far above the live set is a licence to keep pages.

## Metering, so a report names a store

`lib/server-memory.ts` samples the process (`rss`, heap, `heap_size_limit` from
`v8.getHeapStatistics`, peak RSS) and every long-lived store in the order that
answers "where": live wrappers, the read-only `SessionManager` cache, SSE
backlogs, MCP servers, the artifact index, file listings, the calendar prompt
cache, the session scan, composer queues, terminals. It reads `globalThis`
directly — no import cycle, no app-module side effects — and bounds its walks.

- `GET /api/agent/debug?memory=1` answers with it (kept off the debug panel's
  two-second poll; the panel's default snapshot stays small).
- `&pressure=1` runs the valve first, `&gc=1` collects (only with `--expose-gc`).
  The route is local-only, so the knobs are not a remote control.
- The page reports itself: `lib/client-memory.ts` samples the browser heap,
  DOM nodes and loaded messages, sent on the lease renewal the page already makes
  every 30 s (`app/api/agent/[id]/lease/route.ts` coerces it, never trusts it).
- `scripts/memory-bench.mjs` (`npm run memory:bench`) drives the browsing path of
  a running server over the largest sessions on disk and samples the process the
  whole run: peak, retained, **given back**.

`PI_WEB_MEMORY_BUDGET_MB` (default 1024, clamped 256–32768, `0` off) is the RSS
the valve works against.

## What releases, and when

| Store | Release | Tunable |
| --- | --- | --- |
| Wrapper with no page, no run | idle timeout, default 10 min (dev: 2 min) | `PI_WEB_IDLE_TIMEOUT_MS` |
| Page leaves the session | `POST /api/agent/[id]/release` → grace, default 5 s | `PI_WEB_RELEASE_GRACE_MS` |
| Wrapper the page only read | viewer release, default 10 s | `PI_WEB_VIEWER_RELEASE_MS` |
| Warm unwatched wrappers, summed | byte budget, default 64 MiB of session files | `PI_WEB_IDLE_CAP_BYTES` |
| Read-only view cache | 8 entries / 96 MiB / 32 MiB per file | `SM_CACHE_LIMITS` (tests shrink it) |
| Every cache, under pressure | the valve: each to half | `PI_WEB_MEMORY_BUDGET_MB` |
| MCP host per session | 3 min idle | `PI_WEB_MCP_IDLE_MS` |

Invariants, each of which undoes a regression if dropped:

- **A running session is never evicted.** `isRunning()` (with `inner.isIdle ===
  false`) gates every path; the idle timer re-arms while a session runs, so a
  release shortens the countdown of an idle wrapper and does nothing to a run.
- **Stop's forced deadline is never shortened** (`forceShutdownOnIdle` +
  `forcedIdleTimerArmed`): a release is a page leaving, not permission to reap a
  run Stop cannot unwind.
- **A release with an event stream attached is not a release.** Another tab, a
  phone, an open panel is a reason to stay loaded (`hasEventListeners()`).
- **The newest session is always kept** by the byte cap, so the session you just
  left is instant; a session you *ran* keeps the long grace, a session you only
  read goes at the viewer release (the read-only view cache makes its reopen a
  map hit).
- **No count cap on warm sessions.** 0.8.1 capped the count at 4 and every switch
  back cold-started a wrapper. Bytes is the axis that measures a 5 MB and a
  135 MB transcript alike (`lib/idle-session-cap.ts`).
- **A live wrapper is never built from slimmed entries.** `lib/session-slim-load.ts`
  is `persist=false` on purpose: pi's `_rewriteFile()` (version migration, session
  replacement) writes the manager's entries over the file, so slimmed entries
  would silently delete payloads from the real transcript.

## A cache that cannot name its bytes cannot be released

`lib/cache-registry.ts` is the contract: a pruner is `{ name, bytes(),
prune(targetBytes) }`, registered by the module that owns the store
(session views, calendar prompts, artifact index, composer queues, terminals,
file listings). `applyMemoryPressure()` runs the stores in order — sessions
first (a read from disk is the refetch), then each cache to half of what it
holds, then `global.gc()` if the process has it — at most once a minute, from
the sampler when RSS is over budget, or on request.

Halving is deliberate: emptying the artifact index forces a rescan of every
session file on the next Artifacts page, and emptying the listings forces a
`git ls-files` per project. `lib/cache-registry.test.mjs` fails when a store the
debug meter names has no pruner, so a new cache is noticed at the moment it is
added.

A pruner drops **whole entries, coldest first**, and never a running resource:
the terminal pruner removes exited shells and trims a live shell's scrollback, it
does not kill a shell a person is typing into.

## Files

`bin/server-flags.js`, `scripts/dev-server.mjs`, `scripts/web-dev.mjs`,
`scripts/lan-server.mjs`, `bin/pi-web.js`, `desktop/server-launcher.cjs`,
`next.config.ts`, `lib/server-memory.ts`, `lib/client-memory.ts`,
`lib/cache-registry.ts`, `lib/idle-session-cap.ts`, `lib/rpc-manager.ts`
(`everPrompted`, `releaseIdleTimer`, `idleCapCandidate`, `enforceIdleSessionCap`),
`lib/session-reader.ts` (`SM_CACHE_LIMITS`, `shrinkSessionManagerCache`),
`lib/session-prompts.ts`, `lib/artifact-index.ts`, `lib/composer-queue.ts`,
`lib/terminal-manager.ts`, `app/api/file-index/route.ts`,
`app/api/agent/debug/route.ts`, `app/api/agent/[id]/lease/route.ts`,
`app/api/agent/[id]/release/route.ts`, `hooks/useAgentSession.ts`,
`instrumentation-node.ts`, `scripts/memory-bench.mjs`.
Tests: `scripts/server-flags.test.mjs`, `scripts/prod-server-flags.test.mjs`,
`lib/server-memory.test.mjs`, `lib/cache-registry.test.mjs`,
`lib/idle-session-cap.test.mjs`, `lib/rpc-manager-idle-timeout.test.mjs`,
`app/api/agent/release-route.integration.test.mjs`,
`app/api/agent/debug-route.integration.test.mjs`, `lib/next-config.test.mjs`.
