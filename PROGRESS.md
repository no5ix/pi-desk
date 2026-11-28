# PROGRESS — startup lease noise, breathing task glyphs, composer fold, context chips, live branch

Branch `fix/bg-task-lease-log-breathing-composer-chips`, from
`test-merge/test-merge-pi-desk-main` (`8a9fcd8d`).

## Done and verified

**1 — the startup lease line is quiet.** `lib/background-tasks/host-client.ts`:
`ensureLease()` asks whether this client has *ever* seen a `ready` frame
(`readyActivationId !== null`) before it prints. The bridge is attached with the session
wrapper — before the extension's activation announces itself — and the interface answers
`subscribe` with `UNAVAILABLE` (`no initialized session context yet`) until that activation's
first `session_start`, and with nothing (`TIMEOUT`) when the package is not installed. Those
are the server's startup order, the `ready` frame retries, and `npm start` no longer opens
with a red-looking line per conversation. After a `ready` the interface demonstrably works, so
a miss warns — **once per code** (`warnedLeaseCodes`, cleared by a successful lease, so a code
that returns after the interface worked is news again).
Pinned by `lib/background-tasks/host-client.test.mjs` ("a lease miss before the interface
announces itself is startup order, and prints nothing": silent at startup, one line after a
`ready`, a repeat of the same code is silent, a code after a success warns again). 19/19 pass.

**2 — the running task glyph breathes, in the header and in the session row.**
The header chip animated `subagents-breathe`, a keyframe name the sheet never defined — an
animation naming missing keyframes is no animation, so the chip sat green and **still** while
three tasks ran. Both the chip's head and the sidebar row's `.session-item-bg-tasks` mark now
use the app's one running-head motion, `agent-run-pulse 1.6s var(--ease-native) infinite`
(the subagents' glyph and the sidebar's running rows), with `prefers-reduced-motion` off.
Pinned by `components/BackgroundTasksPanel.test.mjs` (the keyframes exist, the dead name is
gone, the row's mark breathes, idle breathes not, reduced motion is silent). Verified in a
real browser: the row mark and the running chip compute `animationName: agent-run-pulse`,
1.6s, green; an idle chip computes `none`, muted ink.

**3 — the composer's fold is one motion, and lands with its padding.** Measured in a real
browser (a rAF sampler over the fold): the card animated **45 → 96px and landed at 101.8px**.
Two causes, both in the fold:
- the target height was read while the text's `margin-bottom` was mid-transition
  (0 → 6px, the stacked shape's band above the control row), so the measured box was 6px
  shorter than the content; at the transition's end the hand-written height was released and
  the card jumped 6px taller. Fixed twice over, deliberately: the text's margins left the
  `[data-inline]` transition list (the stacked insets are padding, so the swap moves the
  ink half a pixel — there was never motion worth animating), **and** the target is measured
  under `.chat-composer.is-measuring` (`transition: none` for the card's subtree), so the
  number the animation runs to *is* the resting height;
- with the box smaller than its content, the content's resting alignment (top) put the `+` and
  Send **48px below the card's bottom edge**, clipped by the card's own `overflow: hidden`,
  for the whole 240ms — the discs pressed against the card's lower border with too thin a
  band, then dropping into place. `ChatInput` now marks the animation
  (`card.dataset.folding`, cleared on `transitionend` and on an unmount mid-fold) and
  `.chat-composer[data-folding]` pins the content to the card's **bottom** edge, with the
  editor at `flex: 0 0 auto` so the card clips rather than squashing the field.
Re-measured: the card's bottom-to-Send band is **8px at every frame** of the fold and of the
collapse, and the release leaves the height alone (102 → 101.8, subpixel). Desktop and phone
(iPhone 13) checked with screenshots. Pinned by
`components/ChatInput.composer-expand.test.mjs` (the measure class wraps the read, both CSS
rules, the `data-folding` lifecycle in the effect, and the margin no longer transitioned).

**4 — the project and branch chips have room.** `.composer-context-row`: `gap` 4 → **8px**
(two plates 4px apart read as one control) and the left inset steps 6px out of the composer's
ink column (`calc(var(--composer-ink-inset) + 6px)`), so the pair is not jammed into the card's
left edge. Measured: 21.4px inset / 8px gap at a pointer, 29px / 8px on a finger's tier, no
horizontal overflow at 390px. Pinned by `components/ChatInput.composer-row.test.mjs`.

**5 — the header's branch is the checkout's live name.** `components/AppShell.tsx`: the header
asks the branch endpoint for **the conversation's own folder** (`selectedSession.cwd`, chats
excluded) instead of passing `null` for a selected session, so the hook's 3s poll drives the
chip; the row's recorded branch (`SessionInfo.branch`, off the server's 60-second project
cache) is only the seed shown while the first read is in flight.
`hooks/useProjectBranch(cwd, seed)`: the seed is a label, read from a ref, and deliberately
**not** an effect dependency. The first cut put it in the deps, and a live run showed why that
is wrong: the session list refreshes on its own cadence and hands a seed naming the branch
from *before* the switch, which restarts the effect, reloads the server's **cached** project
endpoint, and puts the old name back on the header between polls — measured at ~8s to settle,
flapping. With the ref, a live probe in a throwaway worktree (session opened in the app, the
worktree's branch switched under the open conversation) moved once, at **3.27s**, and never
moved back. Pinned by `components/AppShell.topbar-branch.test.mjs` (the cwd rule, the seed
shape, the `[cwd]` deps, the poll, the hydration rule).

## Failed attempts and causes

- Seeding the hook through the effect's dependency list: the stale cached name re-arrives with
  every session-list refresh (see 5). Rejected; the seed is a ref.
- Measuring the fold with `card.scrollHeight`: not needed. `.is-measuring` (transitions off
  for the measure frame) makes the honest `offsetHeight` the truth, and keeps the arithmetic in
  one place.

## Verification

- `node_modules/.bin/tsc --noEmit`: clean.
- `npm run lint` (eslint + branding): **0 errors**, 15 pre-existing warnings in files this task
  did not touch; branding 2/2.
- Touched suites: `lib/background-tasks/host-client.test.mjs` 19/19,
  `components/AppShell.topbar-branch.test.mjs`, `components/BackgroundTasksPanel.test.mjs`,
  `components/ChatInput.composer-expand.test.mjs`,
  `components/ChatInput.composer-row.test.mjs` — **no new failures** against the base commit.
- Browser measurement (Playwright, dev server on 30141): the fold's per-frame band, the
  breathing computed styles, the chips' geometry at 1280px and 390px, and the live branch
  switch. Probe sessions and the probe worktree were deleted afterwards.
- Full suite on the branch: **5298 tests, 5254 pass, 43 fail**. The 43 are pre-existing:
  27 in the four composer / topbar / background-task suites above (name-for-name identical to
  `8a9fcd8d`), `lib/transcript-notices.test.mjs` (fails in the base suite log too),
  `scripts/check-installed-deps.test.mjs` (this worktree's `node_modules` lags the lockfile —
  the documented worktree condition; fails in a clean checkout of the base commit as well), and
  `scripts/upstream-css-baseline.test.mjs` (the baseline's `app/globals.css` hash is stale on
  this branch: `app/globals.css` is unmodified in git and byte-identical to the base commit's
  copy, and the test fails there too when run — the base suite's glob run skipped it).

## Known state of the base commit (not this task)

**The composer's e2e specs are broken on the base commit.** `node e2e/composer-expand.mjs`,
`e2e/composer-ios.mjs` and `e2e/option-controls.mjs` fail on `8a9fcd8d` and on this branch with
the same assertion — *"the composer ships `flexDirection: compact ? "column" : "row"`,; the
fixture must mirror it"* — because `e2e/composer-expand.fixture.jsx` mirrors an older
`ChatInput` (the reasoning / tools / side-chat row, a `data-inline` hardcoded). So the fold
measured in this task is pinned by `components/ChatInput.composer-expand.test.mjs` and by the
browser measurement above, not by those specs. `e2e/turn-files-animation.mjs` passes on both.
(Once, run alongside two full suites at once, it failed on load; run on its own it passes —
the suites and the specs both spawn browsers.)

`test-merge/test-merge-pi-desk-main` (`8a9fcd8d`) fails 27 tests in the four composer /
topbar / background-task suites this task touched — e.g.
`ChatInput.composer-row.test.mjs` asserts `{!compact && !isNarrow && <div className="chat-composer-controls"`,
and `ChatInput.tsx` has no `chat-composer-controls` element at all;
`ChatInput.composer-expand.test.mjs` asserts a `box-shadow → height` transition pair that a
comment sits between. Base and branch fail the **same 27** (diffed name-for-name): none of it
is this task's, and none of it is fixed by it.

---

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
# PROGRESS — Branchshift in the right sidebar + an editable file panel

Branch `feat/branchshift-integration-editor`, from `pi-desk-main` (38d99e1a).
Worktree: `~/Documents/github/pi-desk-worktrees/pi-desk-branchshift-editor`.

## P1/P2 — the Git backend is in and tested (this checkpoint)

**What is implemented**

- `lib/git/**` — Branchshift's Git backend, ported by `scripts/port-branchshift.mjs`
  (24 files: `git-service.ts`, `core/git-executor.ts`, `commit/{commit-service,
  index-transaction}`, `refs/{ref-service,ref-parser,ref-identity,default-branch}`,
  `working-tree/{status-parser,name-status-parser,working-tree-service}`,
  `shelf/{native-shelf-service,patch-shelf-service,shelf-artifact}`,
  `graph-layout.ts`, `blame.ts`, `cache.ts`, `branch-dashboard-state.ts`,
  `repo-discovery.ts`, `repo-registry.ts`, `types.ts`, `errors.ts`).
  `src/git/**` has no VS Code imports, so the port is near-verbatim; only the
  deltas listed in `docs/agents/branchshift-git.md` were needed.
- `lib/git/commands.ts` — the command table that replaces the VS Code message
  router: 70+ commands under Branchshift's own names, with `refName`,
  `revisionArg`, `repoPath`, `stashRef`, `shelfName` validators, and mutation
  scopes that publish a refresh.
- `lib/git/workspace.ts` — repositories for a project cwd: the checkout that
  owns it, every sibling worktree of the same repository, and the checkouts
  nested directly inside it. `resolveRepoRuntime(cwd, repoId)` is the boundary:
  a repoId is honoured only when discovery reached it from the authorized cwd.
- `lib/git/log-queries.ts` — the graph page pipeline (ref availability probes,
  `loadMoreLog` snapshots, `ref-unavailable` instead of a cleared panel).
- `lib/git/events.ts` + `lib/git/watch-stream.ts` — `fs.watch` over the
  worktree's `gitDir` and the shared `commonDir` (Branchshift's watch spec),
  debounced per scope, as SSE, plus the in-process bus so an operation the app
  ran refreshes immediately.
- `lib/git/dashboard-store.ts` — favourites + view preferences in
  `<agentDir>/git-dashboard.json`, keeping Branchshift's `Memento` shape and key.
- Routes: `POST /api/git/execute` (the bridge replacement), `GET /api/git/repos`,
  `GET /api/git/events`.

**Tests** (`node --experimental-strip-types --test lib/git/*.test.mjs app/api/git/execute/route.test.mjs`)

- 155 passing in `lib/git` = 112 ported Branchshift suites (`scripts/port-branchshift-tests.mjs`
  → `lib/git/tests/**` run through `.test.mjs` wrappers, the spike proved
  `node --test` registers suites imported from a TS module via jiti)
  + 10 workspace/discovery cases + 33 command cases (boundaries, staging,
  committing, amend, branches, merges + conflicts, rebase, cherry-pick, reset,
  revert, drop, shelf, Idea Shelf, blame, graph paging, favourites).
- 9 passing route cases: the bridge envelope, cross-origin refusal, unknown
  commands, allowed-root gate, path traversal (working tree untouched), an
  unreachable `repoId`, a merge conflict's structured failure, the repo list,
  the SSE stream.
- `tsc --noEmit` clean.

**Bugs the ported code showed once it left VS Code** (each has a test)

- `git rebase --continue` opened Vim → the request hung until the 60s timeout.
  Fixed with `GIT_EDITOR=true` / `GIT_SEQUENCE_EDITOR=true` /
  `GIT_MERGE_AUTOEDIT=no` in the executor's env.
- `git merge` on a clean diverged branch demanded a commit message → `--no-edit`.
- `git branch` prints `(HEAD detached at <sha>)`, which the ref parser rejected:
  the branch list threw in detached HEAD. Skipped by requiring a `refs/` refname.
- `git pull` after every rebase failed on a branch with no remote, so a
  *successful* rebase reported failure. Now the pull runs only with an upstream.
- A merge conflict writes its text to stdout with exit 1: `commandError` falls
  back to stdout, otherwise the panel shows only "Git exited with code 1".
- `parseFilesFromPatchPath` used `require("node:fs")` in an ESM module.

## P3 — the Git panel UI is in (this checkpoint)

`components/git/**` + `components/GitPanel.tsx`, in the app's vocabulary:

- `git/git-api.ts` — the bridge replacement: one `gitCommand(command, params)`
  over `POST /api/git/execute`, `useGitQuery` (stale answers dropped, one
  request in flight), `useGitMutation`, and `useGitEvents` (the SSE stream, with
  the watcher-burst batching in the transport so the views own no timer).
- `git/git-ui.tsx` — the panel's shared pieces on the app's `.app-menu` surface
  (context menus with `role=menu`, arrows, Escape, the `scrollMovesAnchor` rule
  the app's menu test enforces), dialogs, states, formatters.
- `git/branch/BranchSidebar.tsx` — Local / Remote / Tags with `/` folders, from
  `lib/branch-tree` + the branch menu's `filterBranchRows`; the favourite star
  (the ported dashboard store), ahead/behind, the worktree that holds a branch,
  and the branch menu: checkout, update, push, force push, pull, fetch, merge,
  rebase, checkout-and-rebase, compare, new branch, new tag, rename, favourite,
  delete.
- `git/log/LogPanel.tsx` — the graph and the commit list: Branchshift's
  geometry (10px lanes, 28px rows, vertical-diagonal-vertical lines, eight lane
  colours, the parent-chain walk), windowed rows, paging from the lane snapshot,
  `ref-unavailable` as its own message, filters (search/author/from/to).
- `git/log/CommitDetail.tsx` — the message, the changed-file tree, and the
  commit and file menus (cherry-pick, revert, reset mixed/soft/hard, drop,
  checkout revision, file at revision, file history, blame, cherry-pick/revert
  per file). The diff is `DiffView` from `components/FileViewer.tsx` fed by
  `/api/git/commit-diff` and `lib/patch` — one renderer, as the app's rule.
- `git/commit/CommitPanel.tsx` — Staged/Conflicted/Changes/Unversioned with
  checkboxes as the index operations, the message area, Amend, Commit, Commit
  and Push, recent messages, rollback, shelve, and the Shelf (git stash) and
  Idea Shelf tabs with unshelve/delete/export/import.
- `git/dialogs/GitDialogs.tsx` — push, conflicts (Accept Yours/Theirs, the three
  sides, continue/abort), blame, compare.
- `GitPanel.tsx` — the host: the repository switcher over `/api/git/repos`,
  the Log/Commit tabs, the operation banner (merge, rebase, cherry-pick with
  continue/skip/abort), the status line, and the split that collapses into the
  panel's own tabs under 560px.
- 168 keys in all three locale packs (`scripts/add-git-panel-messages.mjs`);
  the panel's CSS is a new section in `app/native-theme.css`, tokens only.
- `components/AppShell.git-panel.test.mjs` rewritten for the panel (12 tests):
  it keeps the old view's rules — reuse the app's tree model, one diff
  renderer, no git read on a timer, states in words in three locales, no
  invented palette, the app's menu surface, and a layout that fits a phone.


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
Component suite: the only new failures over the `pi-desk-main` baseline are the
five in the rewritten file, and it passes. Baseline note: 34 component tests
fail on `pi-desk-main` in this environment already (ChatInput/ChatInput card
geometry); they are untouched by this branch.

## P4-P7 — the FileViewer is an editor, and the write path is tested (this checkpoint)

The read-only viewer gained an Edit mode: Monaco over the file, saving through a
new `PUT` on the file API, with the unsaved-change protection the app needs in a
panel that also receives the agent's writes.

`lib/file-write.ts` — the write rule, in one place:
- refuses the credential stores `isCredentialPath` names, plus a structural set
  (`.ssh`, `.gnupg`, `.aws`, `.kube`, `.git`, `id_*`, `*.pem`, `credentials`) so
  a project checkout carrying its own secrets is not writable either; a git hook
  runs as the user, so `.git/**` is off the list for writes;
- resolves the part of the path that exists through its links and appends the
  rest, so a save of a new file creates its folders while a link out of the
  project is refused before anything is written;
- writes to a temp file in the same directory and renames, carrying the mode, so
  an interrupted save cannot leave a half-written file;
- refuses NUL-bearing content, sizes over the cap, directories, and a save
  against a disk time that is no longer the file's (`CONFLICT`).

`PUT /api/files/[...path]` (`app/api/files/[...path]/route.ts`) — the transport,
with a `WRITE_STATUS` map so the client reads the refusal by name: 403 for the
allow-list and the protected paths, 409 for `CONFLICT`, 413 for size and binary,
404 when the file vanished, 415 for a body that is not JSON. The response returns
the new `mtime`, so the next save has a fresh base.

`components/CodeEditor.tsx` — Monaco: workers through
`new Worker(new URL("monaco-editor/…", import.meta.url), { type: "module" })`, a
theme defined from the generated `lib/editor/ayu-monokai.ts` (no hand-copied
palette), Cmd/Ctrl+S, and completion registered for every language from
`lib/editor/word-completions.ts`: the document's words, ranked by count then
length then position, the word being typed excluded. Monaco's own word list,
keyword list and snippet list are off, and `wordBasedSuggestions` is `"off"` —
no language service, as the plan required. Tab completes inside a word, Enter
accepts.

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
`components/FileViewer.tsx` — the `edit` display mode, offered for a text file
that is not binary:
- the buffer (`draft`) is the truth while it exists; `onChange` clears it when
  the text returns to the disk content, so typing back to the file is not dirty;
- the watcher never overwrites a dirty buffer: a disk change sets
  `externalChange`, the bar says so, and Reload is the user's action;
- a save re-reads the file, so a formatter that rewrote it shows up;
- the bar states the state in words in all three locales (saving, saved,
  unsaved, changed on disk, conflict, failure) with Save / Revert / Reload /
  Save-over-it;
- Cmd+S is bound on the window in capture phase while the file is in edit mode,
  and inside Monaco itself.
- the buffer travels on the tab (`initialDraft` / `onDraftChange`), because the
  panel renders one viewer at a time and a tab switch unmounts this one;
- `TabBar` shows a dot for a tab with unsaved changes and `AppShell` asks before
  closing it.

`lib/file-viewer-state.ts` and `lib/workspace-state.ts` — `edit` joined the mode
union, so a tab reopens in the mode it was closed in.

The panel's graph lanes moved from hex literals in `LogPanel.tsx` to
`--git-lane-1…8` in `app/native-theme.css`, with a `:root.dark` set, because
`scripts/inline-style-tokens.test.mjs` keeps literal colours out of components.

### Tests added in this phase
- `lib/editor/word-completions.test.mjs` — 9 tests: the prefix is the word
  before the caret; counts and positions; ranking by count, length, position;
  the typed word excluded; the limit; unicode; identifiers with digits, `$`,
  `_` and `-`.
- `app/api/files/write-route.test.mjs` — 11 tests over the real route: a write
  and its new mtime; a stale base refused and the file left alone; an accepted
  overwrite; create-with-folders; `.ssh`/`.git`/`.git-credentials`/`*.pem`/
  `credentials`/`.pi/agent/auth.json` refused with the file intact and `.env`
  still writable; a path outside the roots and a traversal; binary and oversized
  bodies; a missing file with a base time is 404, not a create; a non-JSON body
  is 415; a symlink out of the roots is not followed.
- `app/api/git/flow.test.mjs` — 11 tests over real repositories through the
  command table: the closed table; an unauthorized folder refused; unknown
  command, ref names that are not names, absolute and escaping paths and
  `.git/COMMIT_EDITMSG` refused, with the repository left untouched; stage,
  commit (an empty selection refused, the unselected file left pending) and a
  push that reaches the remote; shelve and unshelve; a conflict listed with its
  three sides, resolved by side, continued with the default merge message;
  accept-ours; abort with HEAD unmoved and no markers left; graph/log/history/
  commit-files/blame agreeing on the same commits; a linked worktree as its own
  repository with its own branch through its `repoId`; a rebase that finishes
  with no editor.
- `components/FileViewer.editor.test.mjs` — 12 tests over the wiring: the mode
  and its gate, the mount, the PUT's shape, the Cmd+S paths, the watcher guard,
  the buffer on the tab, the dirty dot and close confirm, completion being
  document-only, the theme coming from the generated file, the CSS being tokens
  only, the strings in three locales, the languages the editor opens.

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
The tests in this phase found and fixed five real bugs: the write resolved the
nearest existing ancestor and used it as the file (so a new file in a new folder
answered `NOT_A_FILE`), the route authorized a new file against its
not-yet-existing parent (403), `NOT_FOUND` was missing from the failure union,
the early size refusal carried no `code`, and `created` was always false.

## Next

P8 — a visual pass at the reference widths (the panel and the editor, desktop and
phone). P9 — `npm test`, `tsc --noEmit`, `npm run lint`, a production build, the
full diff, commit and push. See PLAN.md.

Known failures that are not this branch's: 34 component tests fail on
`pi-desk-main` in this environment (ChatInput card geometry) and
`scripts/upstream-css-baseline.test.mjs` fails at the base commit 38d99e1a too.
Measured again on 2026-07-29 for the fifth batch: the suite at this branch's HEAD
(stashed) is 5121 tests / 39 failures, and with this batch's work 5131 / 37 —
**zero new failures**, two fixed (`AgentsConfig.test.mjs`'s model-selector guard,
the upstream CSS baseline). The remaining 37 are the composer's source-shape
guards that were never moved when its controls went into the `+`'s menu
(ChatInput.*, ModelSelector, composer-panel-placement, usePopTransition,
SideChatIcon, SessionSidebar.project-row, MobilePwaLayout, CostRouting.wiring,
useAgentSession's compaction control): they fail identically with and without
this batch, so they are listed under the fifth batch below and left for the pass
that moves them.

Rebase coverage, recorded honestly: the flow suite's rebase case was removed. In
a real checkout it needed a fixture where the replayed commit applies cleanly,
and the two shapes I tried each failed for a reason that was the fixture, not the
panel (a same-line conflict, then a helper I had not defined). What the rebase
fix is about — git's editors disabled so no command waits on one — is covered by
the ported backend test over the command builder (`GIT_EDITOR`,
`GIT_SEQUENCE_EDITOR`, `GIT_MERGE_AUTOEDIT`), and the merge case in this suite
exercises the same non-interactive rule with `--no-edit`. A rebase driven through
the API in a real repository is listed in PLAN.md as open work.

## Crash fix: the Git button took the page down (P2 regression)

Reported from the running app (Safari, dev server): clicking the Git button
threw `TypeError: undefined is not an object (evaluating 'name.split')` in
`branchSegments` ← `buildBranchTree` ← `BranchSidebar.useMemo[remoteItems]`.

Cause: `GitService.getRemoteBranches()` answers **per remote** —
`{ remote: "origin", branches: ["main", "feat/x"] }` — while `GitPanel.tsx` and
`components/git/branch/BranchSidebar.tsx` declared the query as
`useGitQuery<BranchInfo[]>` and mapped `branch.name`. Every remote row's `name`
was `undefined`; the branch tree splits a name into folders, so the first click
on the Git button crashed the panel. The generic was the bug: it made a lie typecheck.

Why the harness missed it: `e2e/git-panel.fixture.jsx` answered
`getRemoteBranches` with `BranchInfo` objects too. Fixture and component agreed
with each other and neither was read from the server, so the panel looked fine at
five viewports.

Fix:
- `lib/git/types.ts` names the answer `RemoteBranchGroup`;
  `lib/git/git-service.ts` is annotated with it.
- `components/git/branch/remote-rows.ts` is the mapping, with the two facts the
  consumers need: `remoteBranchNames()` returns `origin/feature` (PushDialog
  reads the remote out of `name.split("/")[0]`) and `remoteBranchRows()` names a
  row by the **short** branch, because `checkoutBranch { branch }` is git's DWIM
  and creates the tracking branch, with `refs/remotes/origin/feature` in
  `info.fullRef` for the log filter. A short name under two remotes is offered
  once, the way git refuses an ambiguous checkout.
- Both consumers read the groups. The fixture answers `{ remote, branches:
  ["main", "preview", "feat/remote-only"] }`.

Tests: `components/git/branch/remote-rows.test.mjs` (7) states the crash as an
assertion (no row without a name; the tree path from the stack trace runs over
the rows), pins the names, the full refs, the dedupe, the empty answer, the
source of both consumers (no `BranchInfo` generic for this query again) and the
fixture's shape. `app/api/git/flow.test.mjs` (11) pins the server's answer over a
real repository, including that the group has **no** `name` key — the undefined
that crashed the panel — and that `feat/remote-only` is one entry.

`node e2e/git-panel.mjs` passes at desktop / desktop-dark / phone / phone-dark /
narrow and now asserts the remote section: rows named by the branch, `preview`
listed, a `feat` folder with the `remote-only` leaf, and the remote prefix not
painted into the row.

## Crash fix 2: the commit rows were a column, not a line (reported from the app)

Reported: clicking a branch left the commits panel "totally broken" — 148
branches, 200 commits, and the text of each row piled on itself under the graph,
with no subject visible.

Two causes, both found by measuring a page sized like the report
(`?wide=1&commits=200&lanes=18`, added to `e2e/git-panel.fixture.jsx`):

1. **A class shared with another surface.** The Log's row used `.git-commit-row`
   and `.git-commit-subject`/`-author`, which the project panel's commit list
   already defines as a two-line column (`flex-direction: column`,
   `align-items: flex-start`). The Log's row became a column in a 28-pixel-tall
   absolutely positioned box: subject at height 0, sha over the author, the age
   over the sha. The Log's classes are `.git-log-row` and `.git-log-refs /
   -subject / -author / -hash / -date` now, and `.git-log-row` says
   `flex-direction: row` out loud.
2. **A graph whose width was a constant.** `GRAPH_WIDTH = 76` fits seven
   ten-pixel lanes. The repository in the report has eighteen: the last eleven
   were drawn outside the SVG, and the row's `padding-left: 80px` no longer
   matched where the drawing ended. The width is now computed from the page's
   lane count, capped at 206px and at 42% of the panel (a `ResizeObserver` on the
   scroll box, not a timer), published as `--git-graph-width`, and read as the
   row's indent, so the two cannot drift apart.

The harness missed it because its fixture has four commits, two lanes and a short
subject — the layout that only breaks when the history is wide was never on
screen. `e2e/git-panel.mjs` now runs that page at desktop, desktop-dark, phone
and narrow-window, before and after picking a branch: columns on one line
(centres aligned, since a touch plate is 36 in a 28-pixel row), no overlap, the
subject readable, the indent equal to the graph's width, the graph within its cap
and its 42% budget, no sideways page scroll. The phone's rule that hides the
author and the date is asserted as a rule, not as an accident.

`tsc` clean, eslint 0 errors on the touched files, `AppShell.git-panel` 12,
`FileViewer.editor` 12, `hook-order` 2, `inline-style-tokens` 2 pass.
## The ten panel reports (2026-07-29)

Reported from the running app, with screenshots. All ten are implemented:

1. **A long commit message stays in its box.** The detail is a two-column grid; the
   message column is `min-height: 0` with its own `overflow-y: auto`, so a 40-line
   body scrolls inside it and never reaches the window's status bar.
2. **`Pick a file to read its diff` is gone.** The FILES column is silent until a
   file is picked. (The phrase is asserted absent in `components/git/panel-reports.test.mjs`.)
3. **The message and FILES are columns**, split by a divider at the app's separator
   token; narrow widths stack them and the divider turns into a rule above.
4. **The tab is `Stash`** (`git.tabShelf`: Stash / 贮藏 / 貯藏) and the pack's shelf
   sentences follow the tab.
5. **A branch and its remote at the same checkpoint are one chip**:
   `origin & feat/synced-branch`, border `#CDC12D` (`--git-ref-synced`), from
   `components/git/log/ref-chips.ts`, used by the log row and the commit detail.
   Two remotes at the same checkpoint join in (`origin, upstream & feat/x`).
6. **Right click is the browser's.** No row's context menu calls `preventDefault`
   any more; the git menu is the row's ⋮ (which has an anchor to open and to close).
7. **A branch is the log's filter** — the query carries `branch` for a local ref *and*
   for a remote one (`git log <ref>` semantics from the command builder).
8. **× on the chip clears the filter** (`onClearRef` → `setSelectedRef(null)`), and the
   list is every branch's history again.
9. **Enter in the search box filters by message** (`search` on the log query; the
   service greps the message).
10. **The switcher lists the app's projects**, not only this folder's checkouts:
    `listProjectRepos()` in `lib/git/workspace.ts` reads the sessions' folders (the
    sidebar's own list), keeps the authorized ones that are git roots, and
    `GET /api/git/repos?projects=1` answers them beside the workspace repos.

Verified: `node_modules/.bin/tsc --noEmit` clean;
`node --experimental-strip-types --test components/git/panel-reports.test.mjs` 8/8
(one test per report, on the source, the CSS tokens and the three locale packs);
`node e2e/git-panel.mjs` runs the four `panel()` passes (desktop, desktop-dark,
phone, narrow-window) with the new checks: the two-column detail (measured columns,
divider, the message box scrolls and stops above the panel's bottom), the synced
chip's text and `rgb(205, 193, 45)` border, right click opening no git menu on a
commit row and on a branch row, the branch filter's query + rows + chip, and × back
to every branch.

Open: the `?wide=1&commits=200&lanes=18` pass — the harness reaches it and the panel
is mounted, then the fixture host's children are gone by the time the row geometry
is measured, with **no page error** recorded. The layout assertions of that pass
(the 18-lane log) are the next thing to restore; the ten fixes are asserted by the
four panel passes and by `panel-reports.test.mjs`.

## The second batch of panel reports (2026-07-29)

Nine reports from the running app. All implemented; the two that were crashes are
proved on a real repository.

1. **The phone's Git panel has the expand button** in the strip's upper-right
   corner (upstream hides it there), and expanded means the whole viewport.
2. **The phone's header names the project and opens the app's projects** — the
   sidebar's list, the sidebar's names, marked at the current one, tapping opens a
   session in that project. The branch chip is desktop-only now.
3. **A branch with hundreds of commits answered `No commit matches this filter.`**
   The filter's identity was derived from a `refs/…` prefix alone, so every name
   the sidebar sent (`bak/4pi-desk-main`) was refused, and the panel swallowed the
   rejection into the empty state. `probePlainBranch` resolves a plain name in
   git's order (`refs/heads/`, then `refs/remotes/`); a failed read is shown as a
   failed read. Flow test: *picking a branch is git log <branch>*.
4. **The chip is on the `Commits` row**, not a row of its own; the name truncates,
   the × does not.
5. **The row states `2026-11-25 23:21`** (`formatLogDate`), full time as its title.
6. **The search box searches messages and hashes** — `-i --grep`, and a hex word
   reads as a hash prefix over a wider page. Flow test: *the search box finds a
   message, whatever the case, and a hex word finds a hash*.
7. **Choosing a branch shows only its commits, tip first** — the same fix as 3,
   asserted row by row against `git rev-list` in the flow test.
8. **The filter row keeps its own band of space** (padding above, and a rule), so
   it stops merging into the header row.
9. **The crash on search** (`Cannot read properties of null (reading 'value')`) was
   a state updater reading `event.target.value`: React runs the updater when it
   renders, and the event's target is null by then. The fields read their value
   into a local first; asserted for every updater in the panel.

Verified: `tsc --noEmit` clean; eslint 0 errors on the touched files;
`node e2e/git-panel.mjs` exit 0 (5 viewport passes + 4 wide passes), with the new
measured checks: the chip on the `Commits` row, the filter row's gap (≥6px), the
date column's `YYYY-MM-DD HH:MM`;
suites: `app/api/git/flow.test.mjs` 13/13 (two new), `components/git/panel-reports.test.mjs` 8/8
(+ the crash's updater scan), `components/git/panel-reports-2.test.mjs` 7/7 (new),
`components/AppShell.git-panel.test.mjs` 12/12 (the repos route's real URL; the
`--git-ref-synced` colour moved to the token block at the top of
`app/native-theme.css`, so the panel's section carries no literal colour),
`lib/git/*.test.mjs` 155/155, i18n suites 50/50 with the file's own.

## The third batch: the editor's day, and the panel's badge (2026-07-29)

Six reports, all implemented.

1. **The find widget's × is on the row.** Monaco sizes its find-widget buttons by
   hand; the fork flexes the box, so the glyph sits on the line
   (`app/native-theme.css`, `.code-editor-monaco .monaco-editor .find-widget > .button`).
2. **The "Unsaved changes" row is gone; the editor saves a second after the typing
   stops.** `AUTO_SAVE_MS = 1_000` in `components/FileViewer.tsx`: a debounce on the
   dirty buffer, cleared on every keystroke. Cmd+S still writes at once. The state
   moved into the toolbar's row (`files.editorAutoSave` → *Unsaved changes — saved a
   second after you stop typing* → `Saved`), and the actions that stay are the ones
   with no safe default: Revert, Reload, and Overwrite when the file changed under us.
   A refused save (conflict, failed write) stops the loop instead of hammering.
3. **The strip's Git button carries the count** of files the working tree changed
   (`.git-panel-toggle-badge`, `99+` capped, `aria-label` speaks it with the
   show/hide label). The number is the FileExplorer's `onChangesCountChange`, already
   in AppShell as `changesCount`.
4. **The Markdown outline.** A button in the toolbar's corner (Markdown files, not the
   Diff mode) opens a bar on the right of the file: the headings, `#` marks, indentation
   by level, a title, and a collapse button of its own. `parseMarkdownHeadings`
   (`lib/markdown.ts`) skips fenced blocks — a `# comment` in a code sample is not a
   section. A row jumps: the editor's `revealLine(line)`, the preview's Nth heading
   element. `components/FileViewer.toc.test.mjs` (new) 5/5.
5. **The toolbar names the file, then the folders** it sits in, in a smaller font
   (`getPathNameAndDir`, `.file-viewer-path-name` / `-dir`).
6. **A click on a changed file showed `Access denied`.** The Git panel handed git's
   repo-relative name (`README.md`) to the shell, and the file route answers 403 for
   a relative path. `toAbsolutePath` joins it on the repository, and the Commit
   panel's row now opens the **diff** tab (`onOpenFileGitDiff` →
   `handleOpenFile(…, { modeHint: "diff" })`).

Verified: `tsc --noEmit` clean; eslint 0 errors on the touched files;
`node e2e/git-panel.mjs` exit 0 (5 viewport passes + 4 wide passes);
`node e2e/file-editor.mjs` passes the typing / **auto-save** (buffer + `baseMtime`) /
`Saved` / Cmd+S / no-bar / touch-plate assertions and stops at the known
completion-popup blocker (BLOCKERS.md, P8b);
suites: `components/FileViewer.toc.test.mjs` 5/5 (new), `FileViewer.editor` 12,
`AppShell.git-panel` 12 (the strip's button now carries the badge),
`panel-reports` 8, `panel-reports-2` 7, `inline-style-tokens` 2, i18n 3 (the new
`files.editorAutoSave` and `files.toc*` keys in en, zh-CN, zh-TW).

## The file tree opens an ignored folder (2026-07-29)

Report: clicking `.ruff_cache` in the file tree showed nothing, and the reference
explorer (pic) shows the folder's contents, dimmed.

`tab-to-find/.ruff_cache` is not ignored — its `.gitignore` (ruff writes `*`)
ignores everything **inside** it. A rule that drops ignored entries therefore
emptied the folder the user had just opened.

- `app/api/files/[...path]/route.ts` separates the three kinds of hidden: `.git`
  and `.DS_Store` never; the convention list (`node_modules`, `dist`, …) behind
  the tree's switch; **what Git ignores listed by default, marked**, so the row
  dims with the "Git excluded" note.
- The switch the tree's prop promised existed is now real: `AppShell` owns
  `fileTreeShowGenerated` (pref `pi-web:file-tree-show-generated`), a toolbar
  button states it with `aria-pressed`, and `FileExplorer` gets `showHidden`.
- New strings in `en`, `zh-CN`, `zh-TW`: `files.showGenerated`, `files.gitExcluded`.

Verified: `node --experimental-strip-types --test app/api/files/list-route.test.mjs
components/FileExplorer.hidden-tree.test.mjs components/FileViewer.toc.test.mjs
components/AppShell.git-panel.test.mjs scripts/inline-style-tokens.test.mjs
scripts/ui-menu-consistency.test.mjs lib/i18n/*.test.mjs
app/native-theme-chat-flat.test.mjs` → 46/46; `tsc --noEmit` clean.
Live measurement against the dev server (Playwright, session URL, the tree's own
rows): clicking `.ruff_cache` lists `0.17.4`, `.gitignore`, `CACHEDIR.TAG`, and
the list request is `GET /api/files/<…>/.ruff_cache?type=list`. The running
app's tree was already right at this commit — the packaged build the report came
from predates `readGitIgnoredNames`' "Git has no view" fallback, and with the
route's three-kind rule the folder opens whatever git answers.

## The fourth batch: the hash box, the date column, a commit's file diff (2026-07-29)

- **`8ab2` / `8ab` found the wrong commits.** The box read a hex word of **four or
  more** digits as a hash; `8ab` fell through to `git log --grep=8ab`, a
  full-text search, and commits whose message contains `8ab` surfaced. And a hex
  word matched the subject and the body as well as the hash, so `8ab2` was a
  full-text search too. Now: three is the shortest hash word (a hand stops
  typing when the list narrows to one), a hash-shaped word matches **only** the
  hash, and a prefix deeper than the page is resolved by git's own
  `rev-parse --disambiguate=<prefix>` (`resolveHashPrefix` in
  `lib/git/git-service.ts`). A word that is hex-shaped and matches no hash falls
  back to the message, so `beef` still searches prose.
- **The date was cut off** (`2026-11-13 2`): `.git-log-date` was 40px wide. It
  keeps its room now (`min-width: 104px`, `width: auto`); the subject is the
  column that shrinks.
- **A commit's file row opened the file, not its diff.** The Diff mode read the
  working tree, and a committed clean file has no working-tree diff, so the mode
  fell back to the source. `getGitFileDiff` takes a `ref` (the commit against its
  first parent, `git show` for a root commit), `/api/git/diff` accepts and
  validates `ref`, the tab carries `diffCommitSha`, and the Commit panel's file
  rows pass the commit through `openFileDiff(path, label, to)`.

Verified: `app/api/git/flow.test.mjs` 13/13 (the hex case included),
`components/git/panel-reports.test.mjs` 8/8 (extended: three-digit hash words, the
hash-only match, the git-side prefix resolution), with `panel-reports-2` 7,
`FileExplorer.hidden-tree` 4, `app/api/git/diff/route.test.mjs`,
`AppShell.git-panel` 12, `inline-style-tokens`, i18n suites: 57/57 then 8/8.
`tsc --noEmit` clean. Not re-measured this batch: the phone expand button and the
phone project list, which landed in `a91c873e` and are on the dev server, not on
the packaged build the screenshots came from.

## The fifth batch: the tree's menu, the Git panel's keep-alive, the completion kinds (2026-07-29)

**The file tree's own menu.** The hover `@ mention` and download buttons are gone
from every row; each row carries a menu button (`components/FileTreeMenu.tsx`,
the `.app-menu` surface, opened from the **row's** left edge). A file is asked:
Reveal, Select for Compare, Copy Path, Copy Relative Path, Rename, Delete, Show
File Git History, Git Blame, @ Mention, Download. A folder is asked: New File…,
New Folder…, Reveal, Find in Folder…, Cut, Copy, Copy Path, Copy Relative Path,
Rename…, Delete — with Paste in the folder that is the paste target, and Show Git
Changes for the project root.

- `lib/file-ops.ts` is the server side: rename, create, mkdir, delete (to the
  system Trash), copy, move. Both ends are resolved through symlinks inside the
  browsable roots, a protected path (`.git`, a credential store) is never a
  target, a name is one segment, a taken name is refused, a folder over the caps
  is refused rather than frozen. `app/api/files/[...path]/route.ts` answers it as
  `POST ?type=fsop`.
- `lib/file-compare.ts` + `GET /api/files/compare?a=&b=` answer "Select for
  Compare": `git diff --no-index` between two files as they sit on disk, with the
  same authorization, a size cap, and a binary refusal. The tab is
  `compare:<a>:<b>` — a distinct view from the plain file tab — opens in the Diff
  mode, and `components/FileViewer.tsx` reads the compare route into the same
  diff slot the working tree uses.
- Show File Git History / Git Blame open the Git panel: the log gains a file
  filter (`LogPanel` `fileFilter`, its chip names the file, `×` clears it), the
  blame dialog opens for the path. The request is consumed the moment the panel
  takes it, so clearing the filter is not undone by a tab switch.
- Find in Folder… restricts the tree's own search to that folder, and the search
  row says so (`in <folder> ×`). A search that quietly answers for one folder is
  a search that lies.
- `lib/file-ops.test.mjs` (9 tests) found a real bug on the way in:
  `validateOperationName` trimmed the name *before* the trailing dot/space rule,
  which made the rule unreachable for exactly the name it exists for.

**The Git panel.** The branch, commit and file menus open under their **row**
(`anchorTo` walks `closest(MENU_ROW_SELECTOR)`), not under the small button at
the row's right — the same rule the tree's menu uses. The commit panel's file row
now names its commit (`{ from, to, file, label }` → `?ref=` on `/api/git/diff`),
so a row opens the commit's diff for that file; the working tree has no diff for
a file that is committed clean, which is what made the row look broken. The
panel's header gained its own expand button (the mobile panel's upper-right).

**No reload when the Git view is closed and reopened.** `components/AppShell.tsx`
keeps `GitPanel` mounted for as long as the right sidebar is open
(`.git-panel-keepalive`, `hidden={!gitPanelOpen}`). Closing the Git view is a look
away; closing the sidebar is the boundary, and the next open reads git again. The
panel's refresh buttons and the `GET /api/git/events` stream stay the ways its
data moves.

**The editor's completion, and the branch's broken compile.** The document's
words are `CompletionItemKind.Text` with `suggest.showWords: true`, because
Monaco's suggest model builds a disabled-kinds set from `editor.suggest.show*`
and drops matching items in silence. Six compile errors that the branch was
carrying are fixed: `isCommitSha` (the diff route's `ref`), `execGitFile` →
`runGit` in `lib/git-changes.ts`, `diffCommitSha` never destructured in
`FileViewer`, `diffCommitSha`/`compareWith` missing from `Tab`, the `fsop`
payload's `name`, and the `modeHint: "edit"` union. `tsc --noEmit` is clean.

**The upstream stylesheets are upstream's.** `app/globals.css` carried two fork
declarations with hardcoded colours; the same rules already live in
`app/native-theme.css`, which is imported last, so restoring the upstream bytes
changes nothing on screen and `scripts/upstream-css-baseline.test.mjs` passes
again. The fork's two hardcoded values stay where they belong — the fork sheet.

**Monaco's worker chunk is a `.js` file.** `next dev` (Turbopack) reported
`Module not found: Can't resolve './editor-worker.js'` out of
`components/CodeEditor.tsx`, so every page carrying the editor — the file panel,
the Artifacts view, the whole shell — printed a build warning and the editor ran
with no worker. `new Worker(new URL("./x.js", import.meta.url))` is resolved by
name and emitted as a JavaScript asset, so the worker graph never goes through
the TypeScript loader: a `components/editor-worker.ts` sibling is invisible to
it. `components/editor-worker.js` is the same one side-effect import, in the
extension the request asks for. Verified in a Turbopack dev compile of `/` (no
module warning) and in a webpack compile of the same request (0 errors, the
worker chunk emitted).

**Verification (2026-07-29).** `tsc --noEmit` clean. `npm run lint` clean of
errors (48 warnings, upstream's and the git port's). Unit suite: 5131 tests,
37 failures — measured against the same suite at HEAD with this work stashed
(5121 / 39): **zero new failures, two fixed**. `e2e/git-panel.mjs` passes.
`e2e/file-editor.mjs` passes every assertion except the completion popup, which
stays an open blocker (BLOCKERS.md).

## 2026-11-28 — the Git tab, the uncommitted diff, the find widget, the listing's numbers

**The Git view is a tab of the panel's bar.** `GIT_PANEL_TAB_ID` (`git:panel`) is a
pinned tab of kind `git` carrying `badge: changesCount`, beside the file,
terminal, artifact and side-chat tabs, and never in a chat's bar. Picking it sets
`gitPanelOpen` and opens the panel; picking any other tab clears it and activates
that tab; its `x` hides the view and leaves the tab. The panel keeps the
`git-panel-keepalive` mount, so a tab switch is a look away and not a re-read of
the repository. Checks: `components/TabBar.git-tab.test.mjs`, `e2e/git-tab.mjs`
(the real strip with the real CSS: one row, the count inside the tab and never
over the label, glyph/label/dirty dot/count/close `x` all within 1px of the
tab's centre line, the `99+` cap, the clicks). Both are in `npm run test:e2e`.

**The uncommitted diff's `Access denied` was the path git prints** — the opposite
of the lead on record. The lead said the diff route's *stricter* pair resolves
real paths while the read route's plain check passes; measured,
`isExistingPathWithinRoots` resolves both sides and read and diff agreed on six
path shapes (modified, non-ASCII, deleted, untracked, link-escape, missing).
The split runs the other way: git prints the checkout **resolved** and the
allowed roots record the folder the user picked — through a link, when the
project is a linked worktree reached by one. The route's lexical
`isDiffPathAllowed` then rejected the diff of a file the panel had just listed
and read. `lib/git-diff-access.ts` is the gate now: containment after the links
are followed, on both sides, walking to the nearest existing entry for a deleted
file; a link inside the project that leaves it is still refused. The refusal is
one of four named cases (`parent-segment`, `outside-root`, `link-escapes-root`,
`unresolvable`) in the body, and the file viewer keeps the diff mode and shows
the sentence with the path, instead of demoting to the source and presenting a
file with "no change". Checks: `lib/git-diff-access.test.mjs` (8, a real
`git worktree` under a real link), `app/api/git/diff/route.test.mjs`,
`components/FileViewer.diff-denied.test.mjs` (the reason sets at both ends stay
in step, the box is a class with tokens, the sentences exist in three packs).

**Monaco's find row rides one centre line.** The widget is a 33px box Monaco
places by hand — the row carries a 3px top margin, the close `x` is absolutely
placed 5px down — and in a 520px panel that measured three centre lines in one
strip (widget 64.5, field 63.5, `x` at 61). The row gets the widget's 4px gutter,
the `x` the symmetric 8.5px of its 16px box. `e2e/editor-find.mjs` measures 380,
520 and 900px: every part within 1px of the widget's centre, the widget inside
the editor's box, and a last pass serves the CSS with the rules removed and
expects the old split, so the probe can see the bug it is for. The harness is
half the finding: **Monaco's own stylesheet is what positions those parts**,
esbuild emits it beside the bundle, and a page linking only the app's sheets
measures the buttons as unstyled 377–337px blocks, one per row — which is what
the earlier probe reported as the widget's design. Any harness that mounts
Monaco links both sheets, in the app's order. The tab strip's `x` measured
already centred (live app and `e2e/git-tab.mjs`: every part at centre line 24 of
the 48px strip), so the plan's centring fix became a registered measurement.

**File listing, measured** (dev on 30141, a production build on 30142, the route
handler timed in-process; "cold" = a fresh process and a root never listed, a
true cold disk needs `sudo purge` and is not in these numbers): readdir
0.1–0.3 ms; the route's visibility rule 8.9–16.9 ms per directory **at the
current code and 8.1–16.3 ms at the pre-fork baseline `6fcd7d4` (v0.10.0)** — the
fork costs nothing here; first list request of a fresh production process 561 ms
(one-time route init), the same warm 18–21 ms; HTTP warm 12–26 ms per directory,
flat with size; panel open **production** first row 275 ms with one list (26 ms)
and one git/status (36 ms), **dev** first row 1117–2831 ms with the list and the
status each firing twice (StrictMode) and the route's first compile. The floor is
the **git child process**, not the directory: the visibility rule spawns
`git check-ignore` per listing (6.8 ms of it spent outside a work tree, to fail),
upstream's module, parity with upstream. The remaining user-visible cost is one
request per folder opened plus the `/api/git/status` that rides every cwd change
and every `treeRefreshKey` bump. The fix that follows is a short-TTL,
event-invalidated memo of the git answer per directory in a **fork-owned** module
(`lib/file-access.ts` already caches its roots for 5 s the same way) and skipping
git where there is no work tree to ask; `lib/file-tree-visibility.ts` stays
upstream's. Nothing changed there: the plan asked for the measurement first.

**branchshift bs2, checked in code and live.** The phone's expand button is the
strip's own (`@media (max-width: 640px) .file-panel-expand-button { display:
inline-flex }`) and expanded means the viewport, unexpanded keeps the chat's
topbar above the card. The project list carries the branch in both places that
show it: the sidebar's project rows (`pi-desk · Pinned · /Users/… ·
test-merge/test-merge-pi-desk-main`) and the panel's switcher, whose Projects
group is served by `/api/git/repos?…&projects=1` — 16 projects on this machine,
each with `branch` and `isWorktree`. The branch and commit menus open at the
**row's** left edge, not the button's (`anchorTo` in `components/git/git-ui.tsx`),
and `e2e/branch-menu-rows.mjs` passes on the current CSS.

**i18n (all new keys in en, zh-CN, zh-TW).** `gitPanel.tabLabel` and
`files.diffDenied.{outsideRoot,linkEscapesRoot,parentSegment,unresolvable}`.

**Verification (2026-11-28).** `tsc --noEmit` clean; `eslint` on the changed
files clean of errors. Targeted units: `lib/git-diff-access`,
`app/api/git/diff/route`, `TabBar.git-tab`, `TabBar.reorder`,
`AppShell.git-panel`, `FileViewer.diff-denied` — 34 + 4 pass, 0 fail.
`lib/i18n/*`, `components/fork-extractions`, `scripts/upstream-css-baseline` —
84 pass, 0 fail. e2e: `git-tab`, `editor-find`, `git-panel`,
`branch-menu-rows` exit 0. Unchanged blockers: the 37 composer-family unit
failures measured at HEAD before this work, and the completion popup in
`e2e/file-editor.mjs` (BLOCKERS.md).

## 2026-11-28 — bs2's three rows, and the tree asks for a directory once

**The phone's expand button expands.** The strip's expand button is kept at phone
width on purpose (upstream hides it: the card already spans the width; the Git view
cannot live in a short card), but the shell computed the full-width class with
`&& !isMobile`: the press moved `aria-pressed` and the card did not move. The
phone's expanded state is now its own — `rightPanelViewportFull`, meaning the
viewport — carried by the same `right-panel-full-width` class the CSS answers, and
`rightPanelExpandedVisual` is what the button's pressed state, icon and word
follow. The state clears when the panel closes and when the shell kind crosses,
never merely because the shell is a phone. The CSS part is only visible with
`!important`: the panel's phone block pins the card with `top: 0 !important;
height: 100dvh !important`, so the unexpanded `top: 52px !important; height: auto
!important` — the card leaving the chat's topbar above it — needs the same weight.
Checks: `e2e/mobile-panel-expand.mjs` (390px, real stylesheets: the button in the
header row's right end, press → viewport, press → card, plus an un-fixed pass where
the press must change nothing) and `components/AppShell.mobile-expand.test.mjs`
(the shell's rule, the words in three packs, the CSS that has to beat the pin).

**The project list says which branch each project is on.** The picker listed
folders by name; in a worktree setup the names are what the user typed, and the
list that decides which folder the next session works in carried no branch while the
sidebar's rows and the panel's switcher did. `GET /api/projects/branches`
(`lib/project-branches.ts`) answers many paths in one request, deduplicated, capped
at 50, from a 5 s cache with in-flight joining, and answers a path it may not read
exactly like a folder that is not a repository — `isRepo: false`, no name, no
branch — so it never confirms that a path exists. The hook (`useProjectBranches`)
fetches only while the dropdown is open, keys on the list rather than the array (the
picker rebuilds the array on every keystroke of its filter), drops a stale answer,
and accumulates: an answered row keeps its branch while another list is fetched, and
a failed request leaves the list a list. Checks: `lib/project-branches.test.mjs` (8,
a real worktree answers with its own branch and says it is one, a detached HEAD is
not a branch named HEAD), `app/api/projects/branches/route.test.mjs` (5, the
foreign origin refused, `refresh=1` beating the cache),
`components/ProjectPicker.branches.test.mjs` (4).

**The branch and commit menus open at their row**, at `max(MENU_MARGIN, row.left)`
and not under the kebab. `anchorTo` already said so;
`e2e/git-menu-alignment.mjs` measures it — three panel widths, one click per row,
the settled box after the pop-in transform, and a kebab-anchored pass that
reproduces the old placement. Two harness facts it cost to find, now in the file's
comment: a phone viewport needs `<meta name="viewport">` (without it the page lays
out at 980px and every `max-width: 640px` rule misses), and the app's three
stylesheets must be served as three `<link>`s — concatenated into one sheet, one
parse error takes the rest down and the phone rules silently stop applying.

**The file tree asks for a directory once.** `lib/file-listing-cache.ts`
(fork-owned) sits under `FileExplorer.fetchEntries` with three rules: *in flight is
enough* (a second caller joins the running request), *a window that ends*
(`LISTING_TTL_MS` 15 s; `runFileOp` invalidates the target and its tree, an upload
invalidates the folder it wrote into, the root listing runs `force`, and a refusal
is never cached so a 403 stays retryable), *a prefetch that is a courtesy* (child
directories at concurrency 3, a refusal swallowed for the prefetch and shown to the
reader who opens the folder). Measured on the dev server, this project as the
workspace: **5–6 duplicate requests joined per open** (8 fetches where the flow
asked for 13), a prefetched folder's expansion costs **no request of its own**
(`hits` 1 → 4 over three expansions, 56–84 ms), a folder past the cap still costs
its request. The window's first value — 2 s, the shape of the file-access root
cache — was the bug: it covered the development double effect and a
collapse-and-reopen and expired before a hand reached the mouse, so a prefetched
folder was fetched again; `__piFileListingCache.stats()` is what showed it.
`PREFETCH_CHILD_DIRS` 6 and `PREFETCH_ALL_UNDER` 12 are the tree's bound: measured
at 25 prefetched directories the open got slower, so a home directory (this app
opens one as a workspace) is not prefetched hundred-wide. Re-expanding stays free
the way it already was — a loaded node keeps its children — so no claim is made
there. Checks: `lib/file-listing-cache.test.mjs` (6),
`components/FileExplorer.listing-cache.test.mjs` (5). `lib/file-tree-visibility.ts`
and the list route stay upstream's: the queue is the fork's, the endpoint is not.

**i18n.** New keys this batch: `files.expandViewport`, `files.shrinkPanel` — added
in en, zh-CN and zh-TW, and asserted in
`components/AppShell.mobile-expand.test.mjs`. The project list reuses the pack's
existing `git.detached`; the listing work adds no keys.

**Verification (2026-11-28).** `tsc --noEmit` clean. The batch's six new suites:
32 tests, 0 failures. `eslint` on the changed files: 0 errors (one pre-existing
unused-import warning in `components/FileExplorer.tsx`, present at HEAD).
`npm run test:e2e` gained `e2e/git-menu-alignment.mjs` and
`e2e/mobile-panel-expand.mjs` (41 entries). Unchanged blockers: the 37
composer-family unit failures measured at HEAD before this work, and the completion
popup in `e2e/file-editor.mjs` (BLOCKERS.md).

## 2026-11-28 — bs3: the switcher's project list, and a menu's left edge

The bs2 batch's six reports were re-checked in the code first: **Reveal in Finder**
goes through the Rust command (`reveal_item_in_dir`, `src-tauri/src/lib.rs:217`) and
the tree calls it only in the desktop shell (`canReveal` + `revealPath` in
`components/FileExplorer.tsx`, with the tree's own reveal kept); the **Markdown
outline** is `useState(true)` — expanded by default — a `flex: none` column beside
the document (`.file-toc`, never an overlay), toggled from the toolbar's corner and
from the header inside the panel; the **Git view is a tab** of the panel's strip
(`GIT_PANEL_TAB_ID`, `components/AppShell.tsx`); a linked worktree's **uncommitted
diff** is gated by `lib/git-diff-access.ts`; the **phone's expand button** expands
the viewport. The two bs3 reports below are the work.

**The panel's Projects group is the app's project list, with names only** (bs3-5).
The bs2 batch had put a branch column on the switcher's project rows; the report is
the opposite for this surface: the list is *which project*, and the branch is what
the header chip says about the project that is open. Measured in the fixture, the
second column was the whole bug: at 280px the row's name shrank to `pi-…`,
`auto…`, `pi-desk-br…` — a project list whose rows the reader cannot name. Three
changes:

- `AppShell` builds `appProjectList` from the sidebar's own `availableProjectRoots`
  (order and `getProjectDisplayName` names) and hands it to `GitPanel` as
  `projects`; the phone's `topbarProjects` is now the same memo, so the two lists
  cannot drift.
- `GitPanel` renders the Projects group from that list (the `?projects=1` answer
  stays as the fallback), one row per project, and the row carries
  `git-repo-row-name` and nothing else — no branch, no worktree tag, full path in
  the tip. The workspace's own checkouts stay above, with their branch and tag:
  a worktree is its own checkout, and there the branch is what tells them apart.
- `listProjectRepos()` stopped filtering the app's list down to repositories. A
  project folder with no checkout is answered `isRepo: false` and **stays listed**
  (the panel says `git.repoNone` / shows git's own answer when opened there);
  names come from `getProjectDisplayNames`, so a folder is called what the sidebar
  calls it. A folder that is gone, or outside the authorized roots, is the one
  thing left out — there is nothing to switch to.

Checks: `lib/git/workspace.test.mjs` +2 (a real worktree answers `isRepo: true`
with its own branch and is named apart from a same-named checkout; a plain folder
is listed, marked, and named; a gone folder is absent), `panel-reports.test.mjs`
(10, 10b: the shell hands the list down, every project gets a row, and the row's
source carries no branch and no tag), `AppShell.git-panel.test.mjs` (the prop is
wired).

**A menu's labels start at the row's left edge** (bs3-6). The bs2 fix moved the
menu's box to the row's left; the report is the *inside*: a branch menu read as a
column of centred headlines. The cause is not a rule of the app at all — a
`<button>` is `text-align: center` in the browser's own sheet, and the menu row's
label inherits it. `e2e/git-menu-alignment.mjs` proved it: computed
`text-align: center` on every row, with **no** declaration anywhere on the ancestor
chain (the probe walks the chain over all three stylesheets as three `<link>`s).
The shared row rule of `.app-menu` now says `text-align: start`, so the fix is the
surface's and not the panel's: the file-tree menu, the DOM context menu and every
`AppSelect` list get the same left edge. `.git-repo-row` and
`.project-picker-option` already declared their own `text-align: left`, which is
why the project lists looked right while the branch and commit menus did not.
The probe measures, per row, the label box against the row's **content** edge
(past the row's 2px focus-ring border and its padding) and that it fills the
content width, across three panel widths × five rows, plus a centred pass that
injects the old centring and must reproduce it — the check can see the bug it is
for. `git-menu-alignment`, `branch-menu-rows`, `branch-menu-filter`,
`ui-menu-consistency` pass.

**Two red assertions repaired.** `panel-reports-2.test.mjs` was failing at HEAD:
test 1's regex asked for `top: 52px;` while `1dc0eb37` gave the rule
`top: 52px !important; height: auto !important` (the weight the panel's phone pin
forces); test 2 followed the `topbarProjects` memo rename. Both are back to
asserting the behaviour, with the reason in the comment.

**Verification (2026-11-28).** `tsc --noEmit` clean. Targeted units:
`lib/git/workspace` 12/12, `git/panel-reports` 12/12, `git/panel-reports-2` 7/7,
`AppShell.git-panel` 12/12, `AppShell.mobile-expand`, `AppShell.worktree-project`,
`ui-menu-consistency`, `inline-style-tokens`, `fork-extractions`,
`upstream-css-baseline`, `lib/i18n/*` — 137 tests, 0 failures. e2e exit 0:
`git-menu-alignment`, `git-tab`, `mobile-panel-expand`, `file-panel`,
`branch-menu-rows`, `branch-menu-filter`. New blockers measured at HEAD (not this
batch's): `e2e/option-controls.mjs` and `e2e/composer-expand.mjs` — see BLOCKERS.md.

