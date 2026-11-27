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


# PROGRESS — the task chip stops wearing a plate it was never clicked, and the task card stops being an empty rectangle

Branch `feat/background-tasks-header-popover`. The report (one screenshot of the
title row): (1) the Background Tasks chip was highlighted without being clicked;
(2) clicking it opened an empty rounded rectangle — a 500px strip of menu surface
with nothing in it.

**Implemented. `e2e/background-tasks-card.mjs` 29 checks pass; targeted unit set
111 pass / 0 fail (`lib/background-tasks/*`, `app/api/background-tasks/*`,
`components/BackgroundTasksPanel.test.mjs`, `scripts/ui-menu-consistency`,
`app/css-variables`); `e2e/agents-panel-card.mjs` and `e2e/panel-hover-wash.mjs`
pass; `eslint` clean on the touched files; `tsc --noEmit` reports only the three
stale `.next-desktop/types/**/composer-draft` errors left by an old desktop build
of a route this tree deleted.**

## The two causes

**The chip's plate.** `.bg-tasks-chip.is-running` filled the pill with
`color-mix(--accent 12%)` and painted the number in `--accent`, so a conversation
with a task running looked pressed before anything was touched (the report's
orange chip). The plate is the open state's: `.is-open` alone fills the pill, and
the pointer washes it, exactly as the row's subagent chip does. The state stays in
the head — green breathing glyph, warning glyph and warning triangle for an unread
failure, dim when idle — and the number is the row's own ink. `.is-running` and
`.is-running:hover` are gone.

**The card's box.** `.bg-tasks-page` is `position: absolute; inset: 0` (that is
the rule that stopped the slid-out page's long row text drawing inside the card's
padding), so `.bg-tasks-pages` has nothing in flow. The rule added with the
flex-column wrapper (`.top-panel-card:has(> .bg-tasks-panel)`) also set
`min-height: 0`, cancelling the card's own 224px floor. A box with nothing in flow
in a wrapper whose height is content-driven has no height: the surface painted a
500px strip about 18px tall. Fixed by making the **list page the box's content**
(`.bg-tasks-page.is-list { position: relative; flex: 1 1 auto; }`) while the detail
page keeps covering the box (`inset: 0`), and by taking the `min-height: 0` back,
so the card's height is the task list's height, floored at 224px and capped by the
shell's `--top-panel-max-height`. The clip rule is untouched: the pages box is
still `position: relative` + `overflow: hidden`, and the detail page is still the
absolute one, so the list page keeps its place — and its height — for the way back.

**Bonus, in scope.** `.bg-tasks-chip-mark` read `var(--font-sm)`, a token that has
never existed in the fork's scale (the tree's `app/css-variables.test.mjs` failed
on it at HEAD); it is `var(--fs-micro)`, the badge tier, and that test passes now.

## Files

- `app/native-theme.css` — the chip's plate rules, the list page in flow, the
  floor, the mark's token (all in the `.bg-tasks-*` block and its chip block).
- `components/BackgroundTasksPanel.test.mjs` — new test
  "the chip's plate is the card's, and the card's box is built by the page in
  flow": no `background`/accent ink on `.is-running`, plate on `.is-open`, warning
  mark, `.bg-tasks-page.is-list` relative + flex, the 224px floor, no rule that
  cancels it, the base page still `absolute; inset: 0`. Rules are read with CSS
  comments stripped, because the comments name the bug.
- `e2e/background-tasks-card.mjs` + `.fixture.jsx` — the real chip, the real card,
  the app's real CSS, `placeAgentsPanel(..., BACKGROUND_TASKS_PANEL_WIDTH)` and the
  panel's own client (the harness serves `/api/background-tasks*`: snapshot,
  detail, logs, the SSE hello; `?session=session-idle` answers an empty
  conversation). Measures in dark: no plate on a closed chip (with 2 running and 1
  unseen failure), plate on the open one, the card a box (floor, viewport cap, the
  shell's 500px width) with head, filters and real rows inside, a task's page at
  the same height with rows, log tail and the back control in the corner, the box
  centred under the header on a phone, the empty conversation a box that says so,
  closing takes the plate and the card away. Then it puts the two causing rules
  back and expects the box to collapse to an 18px strip — the assertion is not
  blind. Screenshots: `test-results/background-tasks-card/*.png`.
- `package.json` — `node e2e/background-tasks-card.mjs` in `test:e2e`, after the
  Agents card.
- `docs/agents/background-tasks.md` — the chip's plate rule, the pages' geometry
  (the list page in flow, the detail page covering, the floor), and the measured
  rows in the test table.

## Notes for the next session

- `scripts/upstream-css-baseline.test.mjs` still fails in this worktree (the
  globals/settings hashes are not re-baselined after the last upstream merge). Not
  this change; `node scripts/upstream-css-baseline.mjs update <upstream-ref>` is
  the documented repair, and it belongs to a merge, not to a CSS fix.
- `e2e/tmp-pop-check.mjs` is an untracked scratch file that lint warns about.

# PROGRESS — merging the header's task monitor into the integration branch

`feat/background-tasks-header-popover` (8 commits) into
`test-merge/test-merge-pi-desk-main`, which was 33 commits past the base `38d99e1a`.

## The five conflicts, and how each was resolved

- `AGENTS.md` — union: the target's `fork-memory.md` topic row and the feature's expanded
  `fork-chat-workspace.md` row (the second way a chat asks for the computer).
- `PROGRESS.md` — the target had replaced the log with its memory-release report; that report
  stays and the feature's entry is appended, so the base's 1165-line history stays deleted.
- `app/native-theme.css` — both sections kept: the target's `.chat-phase-stalled` block and the
  monitor's 838-line `.bg-tasks-*` block. Braces balanced (2449/2449), one `.bg-tasks-chip` rule.
- `components/AppShell.tsx` — the sidebar is wrapped in `BackgroundTasksRunningProvider` **and**
  keeps the target's `onInsertMention` prop.
- `lib/rpc-manager.ts` (four sites) — the run-liveness watchdog, the manual-compaction tracking,
  the task bridge and the conversation announcer all live in the same constructor and the same
  `agent_start` / tool-event path; every site is the union of both sides.

## Four source asserts the feature's shape broke, fixed in the merge

None is a resolution mistake: the feature tip's own text matches neither the chat-prompt regex nor
the Esc-chain regex the target's tests pin (`git show feat/…` checked directly).

- `chatWorkspacePrompt(chatFilesEnabled, { folder, unlocked })` gained `backgroundTasks`, written
  across five lines, so `lib/rpc-manager.test.mjs` and `lib/chat-workspace-policy.test.mjs` (the
  exact-prompt hard rule) stopped matching. The call is one line again with the new key, and both
  asserts now name the flag.
- The global Esc chain grew the task arm (`… : backgroundTasksRunning > 0 ?
  handleAbortBackgroundTasks : null`); `components/side-chat.test.mjs` pinned the three-arm chain,
  and its assert carries the fourth arm now.
- `lib/background-tasks/extension.test.mjs` "a checkout with no dependency of its own" asked for
  `not-installed` from an empty package resolver, whose fallback reads `process.cwd()`'s
  `node_modules`: a fully installed tree answers for every cwd. `resolveBackgroundTasksEntryForCwd`
  takes a `resolveShippedPackage` probe, and the test says the copy is absent. That is why the test
  passed in a worktree with a lagging `node_modules` and failed in a CI-shaped one.

## Verification

- `tsc --noEmit` clean; `eslint` 0 errors (11 pre-existing warnings).
- Unit suite over `app,lib,scripts,components,hooks,relay,relay-shell,public`:
  **5226 tests, 5186 pass, 39 fail**. The pre-merge target is **5098 / 5058 / 39**, and the two
  failure-name sets are equal (`comm`: nothing added, nothing removed) — the 39 are the target's
  own composer source asserts plus the upstream CSS baseline.
- `npm ci` was required in this worktree: the feature's `pi-background-tasks 2.6.10` was not
  installed, which is what `scripts/check-installed-deps.test.mjs` complains about.
- e2e: `background-tasks-card` (29 checks, including the pass that re-adds the two rules that made
  the empty rectangle), `agents-panel-card`, `panel-hover-wash` and `chat-prompt-anchor` pass.
  `topbar-project-row`, `composer-outbox` and `composer-device-copies` fail identically at HEAD and
  merged (same assertion, same measured box) — pre-existing on the target.
