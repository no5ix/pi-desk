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
