# PLAN — memory release for the pi-desk server and page

Branch `fix/memory-release`, from `pi-desk-main` (`38d99e1a`).

The ask, in the user's words: release session memory as soon as sessions end;
release session A when switching to B; release the memory of collapsed thinking /
tool call / report blocks while streaming; find the rest. Server RSS had reached
10.6 GB (peak 18.62 GB).

## Phases

1. **Heap ceiling at every entry point** — `bin/server-flags.js`, `scripts/dev-server.mjs`,
   `scripts/web-dev.mjs`, `scripts/lan-server.mjs`, `bin/pi-web.js`,
   `desktop/server-launcher.cjs`, `next.config.ts` (`turbopackGc`). Done.
2. **Metering** — `lib/server-memory.ts` (process + buckets + budget),
   `lib/client-memory.ts` (page), `GET /api/agent/debug?memory=1`,
   `scripts/memory-bench.mjs`. Done.
3. **Idle caps and release on switch** — warm-session budget 256 → 64 MB with
   `PI_WEB_IDLE_CAP_BYTES`; grace 30 → 15 s; a session the page only *read*
   releases at `PI_WEB_VIEWER_RELEASE_MS` (10 s); `POST /api/agent/[id]/release`
   (the page says it left) shortens the countdown to `PI_WEB_RELEASE_GRACE_MS`
   (5 s); read-only view cache 12/256/64 MB → 8/96/32 MB. Done.
4. **The pressure valve** — `lib/cache-registry.ts` (a pruner per cache),
   `applyMemoryPressure()` / `maybeApplyPressure()` in `lib/server-memory.ts`,
   the sampler firing it over `PI_WEB_MEMORY_BUDGET_MB`, `?memory=1&pressure=1`
   and `?memory=1&gc=1` on the debug route. Done.
5. **Slim live append path** — the completed message the streaming run appends to
   client state keeps full thinking and base64 images (history loads use
   `deferThinking=1&deferMedia=1`). Not started.
6. **Collapse = release on the page** — `content-visibility`, a real cap on
   `visibleCount`, the prefetch cache. Not started.
7. **Wire deltas** — `tool_execution_update` payloads delta-only, a per-event
   payload cap. Not started.
8. **Measure** — `scripts/memory-bench.mjs` on a capped production build, before
   and after each phase. In progress.

## Guard rails (do not cross)

- Never evict a running wrapper (`lib/rpc-manager.ts` `isRunning()`).
- Never slim entries of a *persisting* `SessionManager`: pi's `_rewriteFile()`
  would write the slimmed entries over the real transcript (see DECISIONS.md).
- Keep assistant `content` arrays dense (`fillContentGaps`).
- No count cap on warm sessions — 0.8.1 had one, it broke switching, it is gone
  for good (`lib/idle-session-cap.ts` doc).
- `proxyClientMaxBodySize` stays > 100 MB.
- No `next build` while `npm run dev` holds `.next/dev/lock`; the desktop build
  (`PI_WEB_DESKTOP_BUILD=1`) is the isolated one.
