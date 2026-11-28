# PROGRESS — the live path stops carrying the transcript (memory Phases 5–8)

Branch `feat/complete-memory-optimization-phases`, from
`test-merge/test-merge-pi-desk-main` (`66455ffe`).

## Done and verified

**Phase 5 — the live append is a projection, not the transcript.**
`lib/deferred-message-content.ts` is the shared projection (`deferThinkingBlocks`,
`deferToolResultBase64Images`, `deferLiveMessageContent`); history
(`lib/session-reader.ts`) and the live path (`lib/agent-event-stream.ts`) call the
same rules. The stream gates `message_end` one microtask so `leafEntry()`
(`lib/rpc-manager.ts`, id/type/role only) can name the entry the message became,
and gates the events behind it so the producer's order survives. The reducer keeps
`entryIds` parallel to `messages` (`pendingEntryIdsRef` + one aligning effect,
`""` for a slot with no id). Retrieval is the collapsed card's existing routes,
plus `…/tool-result-content` for a payload-cut result. No entry id, no deferral —
the message goes through whole; `?liveDefer=off` is the escape hatch.
Verified: `lib/deferred-message-content.test.mjs` (9),
`lib/agent-event-stream-phases.test.mjs` (deferral, ordering, no-leaf, switch,
screenshot frame 4 MB → 0.6 KB).

**Phase 6 — the loaded window slides; a collapsed card gives its content back.**
`trimLoadedWindow`/`loadedWindowCap` (lib/chat-lazy-load.ts): eviction from the
head only, cap = the live window + slack, navigation targets protected,
`hasEarlierAfterPrepend` follows the server. The cursor is the **fetch
watermark**, not the kept head — the walk test caught a real bug here: a cursor
that followed the kept rows re-requested the same page forever once a protected
row pinned the head. `ChatWindow` clamps the rendered window to
`MAX_NAVIGATED_LOADED_MESSAGES` at both places that grow it, and passes a stable
`loadedWindow` to the reducer. `lib/content-retention.ts`:
`shouldReleaseOnCollapse` (16 KiB) on thinking, full bash output and a loaded
payload-cut text; `RetainedTextCache` bounds the thinking cache by bytes and
entries and registers with `announceContentPressure()`.
Verified: `lib/chat-lazy-load.test.mjs` (5 new: cap, head eviction, protection,
the 40-round walk, the sentinel), `components/memory-live-path.test.mjs`.

**Phase 7 — deltas and a per-event budget.** `lib/tool-update-delta.ts`:
per-connection baselines, `textAppend`/`contentAppend`/`callsAppend`/
`detailsReplace`, whole-frame fallback, `rev`/`base` guards on both sides
(a hole is refused, the card keeps its frame), invalidation on drop /
`tool_execution_end` / `agent_end`, LRU caps both sides, opt-in via
`?toolUpdates=delta`. `lib/event-payload-limit.ts`: 1 MiB per event
(`PI_WEB_MAX_EVENT_PAYLOAD_BYTES`, clamped ≥ 64 KiB, `0`/`off` off), structural
cutting (never a JSON string slice), `ESSENTIAL_KEYS` kept, a string keeps as much
head as the budget allows, images become counted notes, and the event carries
`payloadTruncated` (+ `contentUrl`) so a shortened value never renders as
complete; `ToolCallBlock` shows the notice and fetches the entry's real text.
Verified: `lib/tool-update-delta.test.mjs` (12), `lib/event-payload-limit.test.mjs`
(11), `lib/agent-event-stream-phases.test.mjs` (wire deltas, the 64 KiB cut with
its `contentUrl`, the budget off).

**Phase 8 — the live path is measured.** `scripts/memory-bench.mjs --wire` runs a
synthetic tool-heavy run through the app's own modules and prints `full`,
`phases`, `phases-64k`: wire MB, p50/p95/max frame bytes, delta/deferred/capped
counts, page-state and window bytes. Reference (120 calls): **132 MB → 51 MB on
the wire** (max frame 3.37 MB → 1.02 MB; 64 KB at the floor), **100 MB of page
state → 34 MB**, 240 appends projected, 0 deltas refused.

Two wiring details the tests forced into the open: the append flush hands the
entry id to the payload cap, so a live tool result the budget cut carries the
`contentUrl` of its own entry (the card offers the real text, not a silent
shortening); and `lib/rpc-manager-leaf-entry.test.mjs` drives a **real SDK
`SessionManager`** to prove `leafEntry()` answers in production — a descriptor of
id/type/role, never the entry's bytes — because a projection that never activates
is invisible to every other test here.
`PayloadCutNote` is the one component that says what fell off, used by the tool
card and by an assistant reply.

Docs: `docs/agents/fork-memory.md` gained the four sections and the file/test
lists; `AGENTS.md`'s fork-memory line names them.

## Notes for the next session

- The streaming bubble itself (`streaming.thinking`, the live reply text) is not
  deferred: a page cannot show a reply it has not received. It is released when
  the message ends, and the appended copy is the projected one.
- `scripts/check-installed-deps.test.mjs` and `scripts/upstream-css-baseline.test.mjs`
  fail at the base commit `66455ffe` too (worktree `node_modules` lag; the merge
  branch's CSS baseline). `npm ci` fixes the first; the second is merge bookkeeping.

---


Branch `fix/new-session-attachments-prompt-search-session-mention`, from
`test-merge/test-merge-pi-desk-main` (`742ae86e`). Pushed: `69f37468` (the
fixes), `3decabf7` (the docs), and the follow-up commit this file describes.

## Done and verified

**1. One mention label.** `sessionMentionTitle` (`lib/session-reference.ts`) is
the single rule: the session's name, else its first prompt in full (newlines to
spaces, `"` to `'`), else the id. The 50-character cut is gone.
`hooks/useSessionMentionPalette.ts` calls it, so a palette pick, a keyboard pick
and the sidebar's "Insert into chat" write the same text; `ChatInput`'s
`insertSessionMention` inserts it and registers the label → id target, which is
what lets the send path expand the mention.
Verified: `components/sidebar-insert-into-chat.test.mjs`,
`lib/session-reference.test.mjs`, `lib/session-title-search.test.mjs`,
`hooks/useSessionMentionPalette.test.mjs`.

**2. `Search titles/prompts…`.** The label in three locales; a query the project
tree answers keeps the tree (one keystroke never scans); a query the tree cannot
answer settles, after half a second and at two characters, into
`GET /api/sessions/search?scope=prompts` — `lib/session-prompt-search.ts` over
`cachedSessionPrompts`, the Tasks calendar's fingerprint cache, so a query costs
nothing warm and one bounded pass cold. Typing until the tree has a row again
closes the results; Enter is the explicit way to the transcript scan; Escape
returns to the tree.
Verified: `components/SessionSidebar.session-search.test.mjs` and against the
running app: a phrase no title carries (`morething`) returned the session that
said it — 138 ms cold, 22 ms warm; the same query at full-transcript scope
scanned for 1.7 s and reported `truncated: true`, which is why the box runs on
the prompts.

**3. Attachments survive a reload.** `lib/draft-attachment-store.ts`: IndexedDB
`pi-web:draft-attachments`, 10 images / 4 MB each / 8 MB per composer / 10
composers, eviction along the `at` index, a write skipped when the attachments
have not changed (typing never carries a screenshot), and one key's operations
serialized — a reload rekeys the parked draft onto the composer's key, which
clears and writes the same record in one breath, and a delete that lands last is
a picture lost. `lib/draft-store.ts` owns the durable key: a session's id, or
`parked-new:<cwd>` for a fresh composer whose own key changes on every reload.
The composer restores images and files only while it is still empty.
Verified: `lib/draft-attachment-store.test.mjs`, `lib/draft-store.test.mjs`
(a reload, a send, a removal, a keystroke, a rekey).

**4. E2E.** `e2e/search-draft-insert.mjs` drives the dev server: the placeholder,
the title fragment, case-insensitivity, a query the tree answers (no scan, no
results list), a word only a prompt says (the box finds that session), Escape,
the row menu's mention equal to the composer's rule (computed from the app's own
session list, not the row's ellipsised text), nothing sent, focus in the composer,
and a New Session prompt with a pasted PNG that survives a reload — and stays
gone once the user clears it. **Passes end to end.**

## Verification

- `node_modules/.bin/tsc --noEmit` — clean.
- Targeted suites (drafts, byte store, mentions, search, sidebar, chat window, app shell,
  composer copies, mention palette): **81 tests, 81 pass**. The same list on a pristine base
  worktree (`742ae86e` at `/tmp/pi-desk-base`) is 73 tests, 73 pass — this branch adds 8 tests
  and nothing that passed at HEAD fails here.
- The composer layout pins (`ChatInput.automation`, `ChatInput.compaction`,
  `ChatInput.composer-expand`, `ChatInput.composer-row`): 32 tests, 15 pass, 17 fail —
  **byte-for-byte identical on the base worktree**, so these are pre-existing, not from this work.
- Full suite, same commands on both trees: `app/components/hooks/lib/relay/relay-shell/public`
  → 1591 tests, 1447 pass, 144 fail on base and the same 144 on this branch (the same top files,
  e.g. `scripts/upstream-css-baseline.test.mjs` on the byte-identical `app/globals.css`, already
  recorded in `BLOCKERS.md`); `scripts/*.test.mjs` → 130 tests, 129 pass, 1 fail on both.
- `E2E_BASE_URL=http://127.0.0.1:30199 node e2e/search-draft-insert.mjs` against a dev server
  started from this tree — **ok**, end to end. The dev server on 30141 belongs to another
  worktree (`pi-desk-branchshift-editor`); that is why the e2e takes `E2E_BASE_URL`.
- Live-app checks along the way (Playwright against this tree): a 1×1 PNG attached to a New
  Session prompt survives a reload; the record in `pi-web:draft-attachments` is the project's
  `parked-new:<cwd>`; removing the picture clears the record, and the next reload offers neither
  the words nor the picture.

## Notes for the next person

- The composer's key is not durable; `parked-new:<cwd>` is. Any new durable
  feature for a fresh composer goes through `durableAttachmentsKey`, and any
  deletion through `dropDurableRecord` (ownership: a page may delete bytes it
  wrote or opened, never bytes it has not read).
- `parkedKeyForFreshComposerKey` matches a cwd suffix against the parked keys the
  page knows. Do not go back to splitting `new:<id>:<cwd>` on a colon: a restored
  composer's id is `initial:<cwd>` and a Windows cwd has a colon of its own.
- A `rekeyDraft` merges one draft (`mergeRekeyedDraft`) and keeps the durable
  attachments; a page moving a draft between its own keys passes
  `keepDurableAttachmentsWhenEmpty`.
- `cachedSessionPrompts` answers from its fingerprint cache only after the calendar route has
  built it; the search route uses it directly, so its first pass on a cold machine is bounded
  (300 files, 4 s) and reports `truncated`.
- The e2e reads the machine's own sessions: it picks a row long enough to
  fragment and a prompt word no title carries, and warms the prompt cache
  through the same route the box uses before asserting.

---

## Notes carried from the merged branch (`test-merge/test-merge-pi-desk-main`)

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
