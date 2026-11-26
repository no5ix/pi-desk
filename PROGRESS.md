# PROGRESS — memory release (branch `fix/memory-release`)

Base: `pi-desk-main` @ `38d99e1a`. Commits so far: `1169c53f` (heap ceiling at
every entry point), `b7769253` (the meter), and the phase-3/4 work below.

## Done and verified

**1. The heap ceiling (`bin/server-flags.js`)** — dev 2048 MB, production and the
desktop sidecar 1536 MB, `PI_WEB_MAX_OLD_SPACE_SIZE` overrides, `0`/`off` leaves
V8 alone, an existing `NODE_OPTIONS` ceiling is respected. Applied at:
`package.json` `dev` → `scripts/dev-server.mjs`, `scripts/web-dev.mjs`,
`scripts/lan-server.mjs`, `bin/pi-web.js` (`NODE_OPTIONS` on re-exec),
`desktop/server-launcher.cjs` (`v8.setFlagsFromString`), plus
`experimental.turbopackGc: true` in `next.config.ts`. Dev also gets
`PI_WEB_IDLE_TIMEOUT_MS=120000`, `PI_WEB_MCP_IDLE_MS=120000`.
Cause: `next dev` forks its server child with `--max-old-space-size` = RAM/2
(64 GB here) — `next/dist/cli/next-dev.js:363-372`.

**2. Metering** — `lib/server-memory.ts` (rss, heap, ceiling, budget, peak, every
store bucket, page samples), `lib/client-memory.ts` (page heap, DOM nodes, loaded
messages, sent on the lease renewal), `GET /api/agent/debug?memory=1`
(+ `&pressure=1`, `&gc=1`), `scripts/memory-bench.mjs` (`npm run memory:bench`),
the sampler started from `instrumentation-node.ts`.

**3. Idle caps and release on switch**
- `lib/idle-session-cap.ts`: byte budget 256 → **64 MiB** (`PI_WEB_IDLE_CAP_BYTES`),
  grace 30 → **15 s** (`PI_WEB_IDLE_CAP_GRACE_MS`), `viewer` on the candidate.
- `lib/rpc-manager.ts`: `everPrompted` (a viewer releases at
  `PI_WEB_VIEWER_RELEASE_MS`, default 10 s), `idleReleaseGraceMs` +
  `releaseIdleTimer()` (shortens the countdown to `PI_WEB_RELEASE_GRACE_MS`,
  default 5 s; cleared by a lease renewal or a command; never shortens Stop's
  forced deadline), `hasEventListeners()`, `enforceIdleSessionCap` honours
  `limits.graceMs` and the resolved budget.
- `app/api/agent/[id]/release/route.ts` + the page's cleanup in
  `hooks/useAgentSession.ts` (`keepalive` POST when the session effect tears down).
- Read-only view cache: 12/256/64 MB → **8/96/32 MB** (`SM_CACHE_LIMITS`).
- MCP idle release 10 min → 3 min (`lib/mcp-host.ts`, docs, tests).

**4. The pressure valve** — `lib/cache-registry.ts` (name/bytes/prune); pruners
registered by the read-only view cache, the calendar prompt cache, the artifact
index, the composer queues, the terminals and the file listings.
`applyMemoryPressure()` releases in order (sessions at half the cap and no grace
→ each cache to half → `global.gc()` if present), the sampler fires it when RSS is
over `PI_WEB_MEMORY_BUDGET_MB` (default 1024, min gap 60 s), and the last run
rides in the meter's report.

## Verification

- `node_modules/.bin/tsc --noEmit` clean.
- eslint clean on every touched file.
- `node --experimental-strip-types --test` green: `lib/idle-session-cap.test.mjs`
  (incl. the new env/grace/default asserts), `lib/rpc-manager-idle-timeout.test.mjs`
  (20 tests, 4 new: release, renew-restores, Stop-not-moved, viewer-vs-used
  candidate), `lib/cache-registry.test.mjs` (3 new, incl. "every metered cache has
  a pruner"), `lib/server-memory.test.mjs` (10, 3 new valve tests),
  `lib/debug-snapshot.test.mjs`, `lib/session-reader.test.mjs`,
  `lib/session-data-cache.test.mjs`, `lib/composer-queue*.test.mjs`,
  `lib/session-prompts.test.mjs`, `lib/artifact-index.test.mjs`,
  `lib/terminal-manager.test.mjs`, `app/api/agent/debug-route.integration.test.mjs`,
  `app/api/agent/lease-route.integration.test.mjs`,
  `app/api/agent/release-route.integration.test.mjs` (2 new),
  `app/api/agent/state-route.integration.test.mjs`, `scripts/server-flags.test.mjs`,
  `scripts/prod-server-flags.test.mjs`, `lib/next-config.test.mjs`,
  `lib/mcp-host.test.mjs`, `lib/browser-open.test.mjs`, `scripts/web-logging.test.mjs`.
- Known pre-existing failures (reproduced at HEAD in a detached worktree):
  `scripts/upstream-css-baseline.test.mjs` (globals.css baseline) and
  `hooks/useAgentSession.test.mjs` → "keeps the compaction control reachable…".

## Measured (capped production build, 127.0.0.1:30199)

Same command, six of the largest sessions (21-47 MB), 3 rounds, 45 s idle:

| phase | peak RSS | peak heap | SM cache |
| --- | --- | --- | --- |
| baseline | 181.0 MB | 71.2 MB | 0 |
| round 1 | 484.7 | 169.8 | 91.7 |
| round 3 | 595.0 | 191.7 | 91.7 |
| idle | 579.3 | 165.0 | 88.3 |

Peak RSS **595 MB**, final **309.1 MB**, **285.8 MB (48 %) given back** after the
peak, ceiling 1216 MB, `sessions.live` 0 (every browsed wrapper released),
`caches.sessionManager` 88.3 MB — the 96 MB cap, not the 158.9 MB the same run
pinned before. The valve never fired: RSS stayed under the 768 MB budget, so the
release is the caps and V8 with a ceiling, and the valve stays a backstop.

Forcing it once (`?memory=1&pressure=1`) proves the backstop on a live server:
`read-only session views -46 MB, garbage collected`, RSS 309 → **267 MB** in one
request, cache 88.3 → 42.0 MB (halved, as designed).

Before this branch, the identical run on an uncapped-ish server: peak 512.8 MB,
final 512.8 MB, **0 MB given back**, cache 158.9 MB.

## Next

1. Phase 7: delta-only `tool_execution_update` payloads and a per-event payload
   cap in `lib/agent-event-stream.ts` (the SSE backlog is 16 MB per stream by
   default; a shell streaming megabytes per second is what fills it).
2. Phase 6: real collapse for the fold that keeps its DOM — `.markdown-code-body
   .is-folded` renders the whole highlighted document behind a 26 em clip; render
   a preview while folded, the full text on Expand. The thinking card is already
   preview-only (`components/MessageView.tsx`), so a collapsed thinking block
   costs state, not DOM. `content-visibility` on chat rows was rejected: it
   implies `contain: paint`, which clips the menus a row opens.
3. Phase 5, the client append path, is blocked on an identifier, not on effort:
   history loads send `deferThinking=1&deferMedia=1` and `MessageView` loads the
   deferred block by `sessionId + entryId + blockIndex`. The streaming path has no
   entry id for the message it appends (`setEntryIds` runs on the reload), so
   deferring at append time shows "thinking unavailable" for the reply the person
   is reading. Design first: the live message needs its entry id from the run
   events, or the page needs a session-local cache that serves deferred content
   for messages the file has not been re-read for.
4. Dev-side follow-up: confirm on a real `npm run dev` session that the 2 GB
   ceiling does not thrash a heavy multi-session run (the ceiling is
   `PI_WEB_MAX_OLD_SPACE_SIZE`, so a person can raise it per project).
5. The two pre-existing failures listed in BLOCKERS.md are worth fixing on
   `pi-desk-main` (the CSS baseline, and the ChatInput source assert).
