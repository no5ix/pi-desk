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

## Measured

Capped production (desktop) build on `127.0.0.1:30199`, six of the largest
sessions, 3 rounds, 45 s idle: heap 71 → 268 MB, `caches.sessionManager` 158.9 MB,
peak RSS 512.8 MB, **0 MB given back** (ceiling 1024 ≫ live set). That run is the
reason for the lower caps and the valve, and the same command is the "after"
measurement:

```
PI_WEB_DESKTOP_BUILD=1 node_modules/next/dist/bin/next build --webpack
E2E_SERVER_MODE=start PI_WEB_DESKTOP_BUILD=1 \
  PI_WEB_MEMORY_BUDGET_MB=768 node scripts/memory-bench.mjs \
  --url http://127.0.0.1:30199 --sessions 6 --rounds 3 --idle 45 --sample 2500
```

## Next

1. Re-run the bench with the new caps + valve; record peak, retained, given back.
2. Phase 5: the slim live append path (`hooks/useAgentSession.ts` appends the
   completed message with full thinking and base64 images while history loads use
   `deferThinking=1&deferMedia=1`).
3. Phase 6: real collapse (`content-visibility` on chat rows, cap
   `visibleCount` growth in `components/ChatWindow.tsx`, cap the prefetch cache).
4. Phase 7: delta-only `tool_execution_update` + a per-event payload cap in
   `lib/agent-event-stream.ts`.
5. `docs/agents/fork-memory.md` + the AGENTS.md topic line; push after each green
   pass.
