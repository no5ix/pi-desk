# PROGRESS — a finished task announces at once, even while other tasks are running
Branch `feat/branch-picker-header-worktrees`. The report: "when there's several task running,
and one of them was finished while other's still running, it should also pop out the
notifications, but now it didn't".
**Implemented; the full unit suite (`4737 pass / 0 fail`), `tsc --noEmit` and `eslint` pass.**
## What changed
| File | Now |
| --- | --- |
| `lib/rpc-manager.ts` | The announce fires on the run's own `agent_settled`, not on "session idle + empty outbox" |
| `lib/rpc-manager-shutdown.test.mjs` | A queued next task announces the finished one; a steer settling mid-run announces nothing |
| `lib/rpc-manager.test.mjs` | The subagent wrapper settles its turn at the run's settle, once |
| `docs/agents/fork-files-security.md`, `DECISIONS.md` | The rule and its reason |
## Implementation state
* **The gate was the wrong question.** `notifyAgentRunCompleteIfIdle()` returned while
  `isRunning()` was true **or** the composer outbox held a prompt — so tasks sent in a row
  announced only their **last** run, and a run that settled into an auto-compaction, a
  steering message, or a second running session stayed silent on the phone push, ntfy and
  the Mac's Notification Center row.
* **`agentRunNeedsCompletion` (set at `agent_start`) is now paired with `agentRunSettled`
  (set at `agent_settled`, where pi's SDK has already cleared `isStreaming`).**
  `notifyAgentRunComplete()` announces when both are set and clears both, so one
  `agent_start` announces exactly once and `finishPrompt()`'s call is a safety net.
* **`isRunning()` is out of the gate.** A `steer`/`followUp` prompt settles its promise in
  the middle of the run that is streaming; gating on the session's state announced *that*
  as a finished task. The `composerQueue.snapshot().length` term is gone — an outbox item
  is the next task, not this one.
* **The span is per run:** `runStartedAt` is cleared with the announce, so the queued run
  that follows reports how long the task it finished took.
* **Untouched on purpose:** the subagent rules (#1434 — a run that leaves subagents at work
  is silent, a report's own run is skipped by its mark), `suppressCompletionNotifications`,
  the per-run dedupe key, the 5-minute staleness window, the aborted/failed silence, and the
  shared per-session notification tag.
## Verification
* `node --experimental-strip-types --test …` (the whole `npm test` glob set) —
  **4737 pass, 0 fail, 1 skipped**.
* `node_modules/.bin/tsc --noEmit` clean; `eslint` clean on the three touched files.
* No e2e run: the change is server-side run bookkeeping, and the queue's own e2e
  (`e2e/composer-outbox.mjs`) drives the client outbox, which is untouched.
## Next
* Push the branch (the tree also holds the user's own in-progress pins work in
  `lib/app-prefs.ts`, `lib/session-ui-state-shared.ts`, `lib/sidebar-pins.ts` — not staged).
* If the user means the **phone**: two finished runs of the *same* session inside ten
  seconds share one push tag, so the second replaces the first quietly
  (`lib/notification-tags.ts`). Making the tag per run is a separate call.

---

# PROGRESS — the worktree glyph is the folder's, in all three places
Branch `feat/branch-picker-header-worktrees`. The task is the user's two screenshots
(`pic1`, `pic2`): clicking a branch that lives in a worktree (`main-bak` in
`auto-toc-worktrees/main-bak3-test-wt`) left every icon in the red frame on the plain
project folder.
**Implemented; `npm test`, `tsc --noEmit`, `npm run lint` and the three e2e checks that own
this UI (`e2e/branch-menu-rows.mjs`, `e2e/branch-menu-filter.mjs`,
`e2e/topbar-project-row.mjs`) pass.**
## What changed
| # | Icon the user circled | Now |
| --- | --- | --- |
| 1 | The header's project chip (`auto-toc`) | `WorktreeIcon` whenever the session's folder is a linked worktree |
| 2 | The composer's project chip (`auto-toc`) | the same rule, read from the same `isWorktree` |
| 3 | The branch list's current row (`main-bak`) | `WorktreeIcon` in a linked checkout, `ProjectFolderIcon` on the main checkout (`BranchRow.holderIsMain` says which) |
## Implementation state
* **The rule is one question, of the folder**: `ProjectInfo.isWorktree` /
  `SessionInfo.isWorktree` (lib/worktree.ts, lib/session-reader.ts). A linked worktree
  wearing a branch it did not create (`main-bak` in `…/main-bak3-test-wt`) is still a
  worktree — that is the case the old rule read as a plain folder.
* **`components/TopbarProjectChip.tsx`**: `{isWorktree ? <WorktreeIcon/> : <ProjectFolderIcon/>}`;
  the `branch` prop is gone (nothing asks it any more), and AppShell stopped passing it.
* **`components/ComposerProjectChip.tsx`**: `const showsWorktreeGlyph = isWorktree;` — the
  chip reads no branch and imports no naming rule, so the composer's git row asks once.
* **`components/ProjectContextMenu.tsx`**: `branchMark` / `branchTitle` split the `current`
  row on `row.holderIsMain`; new key `sidebar.currentWorktreeBranchTitle` ("This worktree is
  on {branch}") in en / zh-CN / zh-TW and in both branch-menu e2e fixtures.
* **`lib/worktree-folder.ts`** keeps only `worktreeDirNameForBranch` (the new-worktree form's
  folder hint, kept in parity with `sanitizeBranchForDir` by its test);
  `branchOwnsWorktreeFolder` is deleted, and `lib/worktree-folder.test.mjs` is the naming test.
* Docs: `docs/agents/fork-ui.md` (the branch-list glyph paragraph and the header row's glyph
  rule, with the reason the old one is gone) and the `AGENTS.md` topic line.
## Verification
* `npm test` (all unit suites) — exit 0.
* `node_modules/.bin/tsc --noEmit` — clean. `npm run lint` — 0 errors (5 pre-existing warnings).
* `node e2e/branch-menu-rows.mjs`, `node e2e/branch-menu-filter.mjs` (now asserts the current
  row's title *and* its glyph drawing), `node e2e/topbar-project-row.mjs` — all exit 0.

---

# PROGRESS — the composer's branch picker, its tree, and the adopted user stylesheet

Branch `wt/2wt-branch-picker-header-worktrees`. The task is the seven items in
PLAN.md (six from the user's screenshots of 2026-11-25, plus the user's
`custom-bak.css`); the reasoning is in DECISIONS.md.

**All seven items are implemented, verified, committed as `20729757` and pushed to
`origin/wt/2wt-branch-picker-header-worktrees`.**

## What is on the branch

| # | Item | State |
| --- | --- | --- |
| 1 | Every rule of `~/Desktop/custom-bak.css` adopted into `app/native-theme.css` | done — repo-root `custom.css` untouched (it is the user's own file, served by `/api/custom-css`) |
| 2 | A branch row's worktree button opens the **new-worktree form** | done — `openWorktreeForm` in `components/ComposerBranchMenu.tsx` sets `NEW_WORKTREE_VIEW` with the row's branch as base |
| 3 | The form: no back button, no "Switch worktree" title; the hint names the base branch **and** the destination folder | done — `sidebar.newWorktreeFrom` / `sidebar.newWorktreeInto`, path from `worktreePathForBranch()` |
| 4 | The header's branch chip always wears the **branch** glyph | done — `components/TopbarBranchChip.tsx`; the checkout glyph moved to the project chip |
| 5 | The branch page: no back row, no "Project actions"; the panel is as wide as its longest name | done — `width: max-content` (240px floor, `min(420px, 100vw - 16px)` cap), names break inside a word, tags never ellipsize |
| 6 | A foldable branch tree: current branch, worktree branches, then prefix groups | done — `lib/branch-tree.ts` + the panel; three glyphs in two voices |
| 7 | The "Worktrees…" menu item removed | done in the DOM panel; the native desktop popup keeps its page |

## Implementation state

* **`lib/branch-tree.ts`** (new, pure): `buildBranchRows` (current → worktree/project
  branches → the rest, each row with `holderPath` / `holderIsMain`), `buildBranchTree`
  (a tree of the `/` prefixes, remotes included), `flattenBranchTree` (the rows the panel
  paints, with the fold honoured and every group open while filtering),
  `worktreePathForBranch` (the client mirror of `lib/worktree.ts`'s `sanitizeBranchForDir`).
  `lib/branch-tree.test.mjs`: 7 tests.
* **`components/ProjectContextMenu.tsx`**: the branch page is the tree; the actions step,
  the back rows and the "Worktrees…" item are gone; a removal is confirmed in the row of
  the branch that owns the worktree; the new-worktree page is the form and nothing else,
  and Escape/Cancel close the menu. The native popup answers with the same row order.
* **`components/GitIcons.tsx`**: `ProjectFolderIcon` (the sidebar's folder shape) joined
  `BranchIcon` / `WorktreeIcon`, and `TopbarProjectChip` uses it.
* **`app/native-theme.css`**: the panel-width rules, the tree's indentation, the chevron,
  the mark's two voices, the folder hint's wrap — and a closing section that adopts the
  user stylesheet (composer border and shadow, topbar/panel edge removal, the folder
  window, focus rings, phone tweaks, sidebar/search).
* **i18n**: `sidebar.currentBranchTitle`, `sidebar.mainCheckoutBranchTitle`,
  `sidebar.branchGroupExpand/Collapse/Count`, `sidebar.newWorktreeFrom/Into` in en,
  zh-CN, zh-TW (`lib/i18n/locale-plugins.ts`).
* **Docs**: `docs/agents/fork-ui.md` (the chips' glyphs, the tree, the panel's width) and
  `docs/agents/files-and-access.md` (the form names the folder the server will create).

## Verification

* `node --test components/*.test.mjs lib/*.test.mjs lib/i18n/*.test.mjs scripts/*.test.mjs`
  → **3985 pass, 0 fail**.
* `node_modules/.bin/tsc --noEmit` → clean. `npx eslint app lib components hooks` →
  no new warning (the pre-existing SkillsConfig / project-skills ones remain).
* `node --test scripts/ui-menu-consistency.test.mjs` → 2/2.
* `node e2e/branch-menu-rows.mjs` → 7 rows at 360px (the panel grew to the longest name,
  capped at 420px), the longest name on one line with nothing cut, 2 prefix groups open
  with their arrows, no tag/icon overlap; the control pass (the four rules surgically
  removed) overlaps 5 of 7 rows.
* `node e2e/branch-menu-filter.mjs` → 12 branches as 6 prefix groups, the checkout's
  branch at the head, a fold hides 3 and puts them back, the filter box for the long
  project only (`fix/` → 3, `Settings` → 2, `zzz` → the sentence), Escape closes, the
  short project keeps none.
* `node e2e/topbar-project-row.mjs`, `node e2e/sidebar-menu-placement.mjs` → green.
* `npm run drift` → the 6 files that disagree with `scripts/fork-ownership.json` are
  files this task did not touch (pre-existing on the branch).

## Next

* Commit and push `wt/2wt-branch-picker-header-worktrees`.
* Open question for the user, not a blocker: the adopted stylesheet hides
  `.extension-status-line` and `.sidebar-search-input`, and squares `.agent-session-panel`
  (`components/AgentSessionPanel.test.mjs` was updated to pin that corner as the panel's
  own call). Those are the user's look, adopted on request; say the word and any one of
  them goes back.

## The merge into `feat/branch-picker-header-worktrees`

Both worktree branches are in `feat/branch-picker-header-worktrees`:
`2ce3bcdd` merges `wt/wt-branch-picker-header-worktrees` (the header/composer/Agents pass,
its ink checks, `lib/worktree-folder.ts`), `46518d67` merges this branch. Git merged both
with no textual conflict — the two lines had touched the same files (`app/native-theme.css`,
`components/ProjectContextMenu.tsx`, the header chips, `docs/agents/fork-ui.md`) in
disjoint regions — and only the composer needed a human.

**What the merge met, and what was done** (`f0c4945f`, `8cf4c3ca`):

* The header branch pinned the composer's **ink** (`justify-content: flex-start` on the
  `+`, a top-only textarea margin, `e2e/composer-geometry.mjs` measuring glyph and text
  edges); this branch restyled the same rules by hand (the glyph centered, `margin: 8px 0
  18px 8px`, 13px right padding, 15px in front of Send, the card's border removed for the
  shadow). The newer CSS is kept and the pins moved to what the layout is for:
  the text area's left margin is `calc(var(--composer-send-size) / 2 - 10px)`, so the
  prompt's first character stands on the glyph's left edge on the 36px tier *and* on the
  touch tier's 44px disc (4px off there, measured); the card's radius lost the border term
  the adopted section removes, so the arc and the Send disc share their center again; and
  the two width checks now count the text area's own horizontal margins, so they keep
  catching the overflow they were written for.
* `docs/agents/fork-ui.md` and the stylesheet's own comments say what the rules do now —
  the old wording ("the margin is vertical only", "left-aligning the glyph") described a
  layout that no longer exists, and that is how a hand-edit gets reverted.

**Verification** (all from the merged tip `8cf4c3ca`):

* `node_modules/.bin/tsc --noEmit` clean; `npm run lint` 0 errors (the 5 pre-existing
  warnings); `npm test` **4713 pass, 0 fail**.
* The 23 fixture-based scripts of `npm run test:e2e` are green, including
  `branch-menu-rows`, `branch-menu-filter`, `topbar-project-row`, `composer-outbox`,
  `option-controls`, `chat-appearance`, `composer-ios`.
* `e2e/title-feedback.mjs` and `e2e/run.mjs` spawn their own `next dev` **in the repo
  root**, so they must be run where no dev server holds that `.next`: from the main repo,
  with the app's dev server on 30141 up, the page reloads forever (the document is
  requested 300+ times, the server logs one `Compiled in 3ms` per request, and no app
  code is involved — no `window.location.reload`, no `router.replace` in the app's own
  frames). In a worktree with its own `.next`, both are green: title-feedback PASSes.

**Next**

* Push `feat/branch-picker-header-worktrees` (it tracks `origin/`).
* The two worktrees (`wt-…`, `wt-2wt-…`) still hold their branch checkouts; removing them
  is the user's call, as their branches are now inside the feature branch.

## Pins follow the user, not the browser

**What changed**
| File | Now |
| --- | --- |
| `lib/sidebar-pins.ts` (new) | The pure pin layer: the pinned sets read from the server's session UI state, and the requests that push a browser's retired `pi-web:pinned-*` pins onto the server once |
| `hooks/useSidebarPins.ts` (new) | The sidebar's pins as a hook: reads, optimistic toggles, the one-time migration, the visibility re-read, the failure reason for the notice |
| `hooks/useSessionUiState.ts` | `lastErrorRef` (the reason of the write that just failed, readable from its `.then`); a revision named while a GET is open is chased, so news is never lost behind a slow read |
| `components/SessionSidebar.tsx` | Chats, project sessions and projects pin through the server; the running frames' `sessionUiStateRevision` goes to `noteRevision()`; a refused pin raises `sidebar.uiStateFailed` |
| `lib/session-ui-state.ts`, `app/api/agent/running/events/route.ts` | `subscribeSessionUiStateChange()`; a write that lands pushes `{ type: "ui-state", sessionUiStateRevision }` on the running stream, and every running frame carries the revision |
| `lib/app-prefs.ts`, `lib/session-ui-state-shared.ts` | The three `pinned*` keys are migration-only plus `pinsMigratedToServer`; `MAX_PROJECT_STRING_LENGTH` is exported for the migration's filter |
| `docs/agents/sessions.md` | The pins section: the wiring, the migration, the push, and the archive state that is still per browser |

**Why**

Two sessions pinned in Safari were missing in Edge on the same machine, and a phone showed
none: the sidebar kept pins in `localStorage` while the repo already had the server's state
store (`<agentDir>/pi-web-session-state.json`, `revision`, `sessions`, `projects`).

**Verification**

* `node_modules/.bin/tsc --noEmit` clean; `eslint` on the touched files clean (the suite's
  1 pre-existing warning in `ChatInput.composer-row.test.mjs` is the composer task's, whose
  files are dirty in this tree).
* New: `lib/sidebar-pins.test.mjs` (4), `hooks/useSidebarPins.test.mjs` (7), the chase and
  listener tests in `hooks/useSessionUiState.test.mjs` / `lib/session-ui-state.test.mjs`.
* Full `node --test` over app/lib/scripts/components/hooks/relay/relay-shell/public:
  4748 pass, the only 2 failures are `components/ChatInput.composer-row.test.mjs`, which
  reads the composer files another in-flight edit has dirty in this worktree.
* Live against the app's dev server, two isolated Playwright browser contexts on one
  server: pin in A → the glyph in A; the untouched B shows the same pin with no click and
  no reload (frame `rev 17` → B's GET `rev 17`, 3 pinned); unpin in A → the glyph leaves B
  (frame `rev 18` → 2 pinned); A's `pi-web:pinned-*` keys are gone, `pinsMigratedToServer`
  is `1`. A real Safari window's two pins landed on the server on its first sync, which is
  what the check read as the starting state.

**Next**

* The archive (`archivedChats`, `archivedSessions`, `pi-web:archived-projects`) is still
  per browser; moving it onto the same store is the remaining half, and it would let the
  store's pin/archive exclusion work across windows.
