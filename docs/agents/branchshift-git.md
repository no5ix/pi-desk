# The Git panel — Branchshift, ported into pi-desk

The right sidebar's Git panel is Branchshift (`github.com/no5ix/branchshift`, a VS
Code extension) ported into pi-desk. This note is the feature map: where each
Branchshift feature lives here, what was reused, what was rewritten, and why.

## Architecture

Branchshift's shape was:

```
webview React  →  postMessage bridge (webview/src/shared/bridge)
               →  MessageRouter (src/messages/messageRouter.ts)
               →  GitService + services (src/git/**)
               →  the repository
```

Here it is:

```
components/git/**  →  components/git/git-api.ts (fetch + SSE)
                   →  POST /api/git/execute  (app/api/git/execute/route.ts)
                   →  lib/git/commands.ts    (the command table)
                   →  lib/git/** (GitService + services)
                   →  the repository / worktree
```

| Branchshift | pi-desk | note |
| --- | --- | --- |
| `src/git/**` (pure Node, no VS Code imports) | `lib/git/**` | copied by `scripts/port-branchshift.mjs` with kebab-case file names; keep the transform idempotent so a later refresh can be diffed |
| `src/test/git/**` (mocha) | `lib/git/tests/**` + `lib/git/*.test.mjs` wrappers | `scripts/port-branchshift-tests.mjs`; the `.mjs` wrapper jiti-imports the TS suite, which is what `node --test` picks up |
| `src/messages/protocol.ts` command names | `lib/git/commands.ts` | the same names, so the ported UI keeps calling them |
| `src/messages/messageRouter.ts` | `lib/git/commands.ts` + the route | the router's repo gate becomes the allowed-root gate plus the workspace discovery check |
| `src/messages/logHandlers.ts` | `lib/git/log-queries.ts` | graph paging, ref availability probes |
| `src/watchers/gitWatcher.ts` | `lib/git/events.ts` + `lib/git/watch-stream.ts` | VS Code FileSystemWatcher → `fs.watch` + SSE |
| VS Code `Memento` (favourites, view prefs) | `lib/git/dashboard-store.ts` | JSON file at `<agentDir>/git-dashboard.json`, same key `branchshift.branchDashboard.v1` |
| `RepoRegistry` fed by workspace folders | `lib/git/workspace.ts` | repositories discovered from an authorized project cwd: its checkout, its sibling worktrees, its nested checkouts |
| webview `shared/bridge/vscode-bridge.ts` | `components/git/git-api.ts` | one `request(command, params, repoId)` → `POST /api/git/execute`, plus `EventSource` on `/api/git/events` |

## The repository boundary (read this before adding a command)

Every request carries a project `cwd`; the repository is resolved from it
(`resolveRepoRuntime`), and a browser-supplied `repoId` is honoured only when
discovery reached it from that cwd. A command therefore cannot aim at an
arbitrary path.

Inside a command, three validators stand between a parameter and `argv`:

- `refName` — a plain branch/tag name. Rejects option-shaped values (`--help`),
  ranges (`a..b`), placeholders (`@{u}`), and trailing `/`, `.`, `.lock`.
- `revisionArg` — a ref/hash plus git's ancestry suffixes (`HEAD^`, `<sha>~3`),
  which the commit-detail diff needs.
- `repoPath` — a file inside the checkout. Rejects absolute paths, `..`
  segments, and `.git`; it resolves symlinks through the nearest existing
  ancestor, because some path parameters are written with `fs` directly
  (`saveMergedContent`, `deleteFiles`) where git's own "outside repository"
  check does not run.
- `stashRef` — `stash@{n}` (or a bare index). A shell-ish string in that slot
  never reaches git.
- `shelfName` — one path segment. Idea Shelves are a directory under
  `.idea/shelf/`, and unshelving runs `git apply` on the patch found there.

Commands never build a shell string: the ported `GitExecutor` runs
`execFile("git", argv)` with `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`, a
per-process timeout (60s local, 300s for network commands), and
`GIT_EDITOR=true` / `GIT_SEQUENCE_EDITOR=true` / `GIT_MERGE_AUTOEDIT=no` —
a server has no terminal, and `git rebase --continue` opens Vim otherwise.

## Fork changes to the ported backend

Each one fixes something that only bites outside VS Code:

- `GitService.rebase` pulls the upstream **only when the branch has one**.
  Branchshift always pulled; on a local-only branch the rebase had already
  succeeded and the command still reported failure.
- `GitService.merge` passes `--no-edit`.
- `RefService.parseBranchOutput` skips the `(HEAD detached at <sha>)` line
  `git branch` prints when HEAD is detached — it has no refname, and the old
  code fed it to the ref parser, so the branch list threw in detached HEAD.
- `GitExecutor.commandError` falls back to stdout when stderr is empty: git
  reports a merge conflict on stdout with exit code 1, and the panel needs that
  text to explain why a merge stopped.
- `parseFilesFromPatchPath` is async (`require()` in an ESM module).

## Feature map

Status: **ported** = present and tested; **adapted** = present, with the UI
shape changed for the sidebar; **client** = Branchshift asked the extension
host, the browser does it here.

### Git Log panel

| Feature | Branchshift | pi-desk | Status |
| --- | --- | --- | --- |
| Branch tree (Local / Remote / Tags), folders for `/`-separated names | `panel/branches/BranchTree.tsx`, `model/branchTreeModel.ts` | `components/git/branch/*` | adapted (same tree, sidebar width) |
| Search branches, expand/collapse, favourite star | `BranchSidebar.tsx`, `branchTreeState.ts` | `components/git/branch/BranchSidebar.tsx` | ported |
| Current branch, ahead/behind, upstream, checked-out-in-worktree | `gitService.getBranches` (`%(upstream:track)`) | same, `lib/git/refs/ref-service.ts` | ported |
| Checkout, update, push, force push, pull, fetch | branch context menu → `checkoutBranch`, `updateBranch`, `pushBranch`, `pullBranch`, `fetchBranch` | same commands | ported |
| New / rename / delete branch, new branch from a branch, delete remote | `createBranch`, `renameBranch`, `deleteBranch` | same | ported |
| Merge into current, rebase current onto, checkout and rebase, compare with current | `mergeBranch`, `rebaseBranch`, `checkoutAndRebase`, `openCompareWithCurrent` | same; compare is a panel section | ported |
| Mark as favourite | `setFavorite` + `BranchDashboardStateStore` | `lib/git/dashboard-store.ts` | ported |
| Graph, commit list, columns, filters (search / author / date / branch chip) | `GitGraphPanel.tsx`, `GitGraphSvg.tsx`, `CommitList.tsx`, `Toolbar.tsx` | `components/git/log/*` | ported |
| Commit detail (message, author, date, refs) and its changed-file tree | `CommitDetail.tsx`, `FileChangeTree.tsx`, `shared/components/CommitInfo.tsx` | `components/git/log/*` | ported |
| Commit context menu: copy revision, cherry-pick, checkout revision, reset mixed/soft/hard, revert, drop, new branch, new tag | `CommitContextMenu.tsx` | `components/git/log/CommitContextMenu.tsx` | ported |
| Changed-file context menu: diff, file at revision, history, copy path/name, revert/cherry-pick selected changes | `FileContextMenu.tsx` | `components/git/log/CommitFileContextMenu.tsx`; diff/history open in the panel's file tabs | adapted |
| Repo switching | `shared/components/RepoSwitcher.tsx` | `components/git/GitRepoSwitcher.tsx` over `/api/git/repos` | adapted |
| Refresh on external git change | `gitWatcher.ts` → `gitStateChanged` | `/api/git/events` SSE + the in-process bus | ported |

### Commit panel

| Feature | Branchshift | pi-desk | Status |
| --- | --- | --- | --- |
| Commit / Shelf / Stash tabs | `commit/App.tsx`, `CommitTab`, `ShelfTab` | `components/git/commit/*` | ported |
| Changes / Staged / Unversioned groups with checkboxes, directory grouping, `N files` counts, status letters | `FileItem.tsx`, `commit-store` selection slices | `components/git/commit/*` | ported |
| Stage, unstage, stage all, unstage all, per-file and directory selection | `stageFile`, `unstageFile`, `stageAll`, `unstageAll` | same | ported |
| Commit, Amend, Commit and Push…, `Cmd/Ctrl+Enter` | `commitChanges`, `commitAndPush`, `CommitMessageArea.tsx` | same | ported |
| Partial commit of the selected files | `CommitService.commitSelected` + `IndexTransaction` | same (index is prepared and restored around the commit) | ported |
| Selected-hunk commit | Branchshift rejects it (`PARTIAL_FILE_SELECTION_UNSUPPORTED`); hunks are shown in the diff and committed per file | same | ported (same limit) |
| Rollback a file / the selected files | `rollbackFile`, `rollbackFiles` + `openRollbackPanel` | same command; the rollback panel is a dialog | adapted |
| Shelve Changes, shelf list, unshelve, unshelve one file, delete, patch export, import from clipboard | `NativeShelfService` (git stash) | same | ported |
| Idea Shelf (`.idea/shelf`, patch files, XML descriptors) | `PatchShelfService` | same, kept on disk in the same format | ported |
| Toolbar (refresh, rollback, shelve, stage all, unstage all, expand all, view menu) | `commit/components/Toolbar.tsx` | same | ported |
| Operation error banner with git's message and the recovery hint | `OperationErrorBanner.tsx` | same | ported |

### Operation panels and dialogs

| Feature | Branchshift | pi-desk | Status |
| --- | --- | --- | --- |
| Push dialog: remote, target branch, force, ahead list, draggable divider | `push/App.tsx`, `RemoteBranchSelector.tsx` | `components/git/dialogs/PushDialog.tsx` (modal; the divider is the same idea) | adapted |
| Merge conflicts: list, open, Accept Yours / Theirs, three-way editor, continue, abort | `conflicts/App.tsx`, `MergeStandaloneApp.tsx`, `mergeEditorManager.ts` | `components/git/dialogs/ConflictDashboard.tsx` (list + accept + continue/abort) with the diff shown in the file panel | adapted |
| Three-way merge editor | `conflicts/MergeColumn/Gutter/Container.tsx` | declined as a standalone editor: the sidebar has no room for three columns, and the file panel's editor covers manual merging. Accept Yours / Theirs, the conflict list, base/ours/theirs content and continue/abort are all present | declined in favour of the sidebar layout |
| Rebase: state, continue, skip, abort; cherry-pick: state, continue, skip, abort | `getRebaseState`, `rebaseAction`, `getCherryPickState`, `cherryPickAction` | same, surfaced as an operation banner with its buttons | ported |
| Rollback panel (files, working/index states, checkout from) | `rollback/App.tsx` | rollback dialog over `rollbackFiles` | adapted |
| Compare panel (a range, its commits and files) | `compare/App.tsx`, `CompareSurface.tsx` | `components/git/panels/ComparePanel.tsx` | ported |
| Blame panel (blocks, age, syntax colour) | `blame/App.tsx`, `BlameBlock.tsx` | `components/git/panels/BlamePanel.tsx` over `getGitBlame` | ported |
| File history to a commit | `revealFileHistory`, `getLog({file})` | `getFileHistory` + the file panel | ported |
| `showInputBox`, `showConfirmMessage`, `copyToClipboard`, `revealInSystemExplorer`, `openFile`, `openDiffEditor` | extension host (`logHandlers.ts`, views) | the client: pi-desk dialogs, `navigator.clipboard`, `lib/desktop-native.ts`, the panel's file tabs | client |

## Conventions this panel follows

- The panel is a right-panel tab (`git:<cwd>`), beside the file tabs, and keeps
  Branchshift's two surfaces: **Log** (branch tree · graph and commit list ·
  commit detail) and **Commit** (Commit · Shelf · Stash). Its sub-columns are
  resizable with pi-desk's `panel-resize-handle`, and they stack in a
  single-pane layout when the panel is too narrow, so nothing overflows.
- Styling is in `app/native-theme.css` under `.git-panel`, using pi-desk's
  tokens. Branchshift's own CSS reads `--vscode-*` variables; the panel scope
  defines those from pi-desk tokens, so the ported components keep their
  structure without inventing a second palette, and the app's own theme system
  stays untouched.
- Menus use the shared `.app-menu` surface (see AGENTS.md's UI rule); a context
  menu on a branch, commit, shelf row or file row is a DOM menu, not a native one.
- Every string goes through `useI18n`/`translate` with `en`, `zh-CN`, `zh-TW`.

## The Log's commit row: one line, and a graph the width of its lanes

`components/git/log/LogPanel.tsx` draws the graph as one absolutely placed SVG
and the rows as absolutely placed rows in `.git-log-rows`, so a row is indented
by the graph's width. Two rules keep that honest, and both came from a panel that
shipped broken:

- **The row's classes are the Log's own**: `.git-log-row`, `.git-log-refs`,
  `.git-log-subject`, `.git-log-author`, `.git-log-hash`, `.git-log-date`.
  `.git-commit-row` and `.git-commit-subject`/`-author` belong to the project
  panel's commit list, which is a **two-line column** (`flex-direction: column`,
  `align-items: flex-start`). Sharing the name made the Log's row a column: the
  subject at zero height, the sha on top of the author, no message on screen.
  `.git-log-row` writes `flex-direction: row` out for that reason.
- **The graph is as wide as the page's lanes**: `GRAPH_PADDING * 2 + columns *
  COLUMN_WIDTH`, capped at `GRAPH_MAX_WIDTH` and at 42% of the panel
  (`GRAPH_PANEL_FRACTION`, measured with a `ResizeObserver` on the scroll box —
  no timer). The same number is set on the scroll box as `--git-graph-width` and
  read as the row's `padding-left`, so the drawing and the indent cannot drift.
  A fixed 76px box drew eighteen lanes outside itself: lines arriving from
  nowhere.

`e2e/git-panel.mjs` measures both, on a `?wide=1&commits=200&lanes=18` page
(`e2e/git-panel.fixture.jsx`): columns on one line (centres aligned), no
overlap, the subject readable, the indent equal to the graph's width, the graph
within its cap and budget, no sideways page scroll — before and after picking a
branch, which is how the breakage was reported.

## The branch filter, the search box, and the row's date

**A branch row's filter is the name git takes.** The panel sends `branch:
"bak/4pi-desk-main"` — the same string a person would type after `git log`. The
service resolves a plain name in git's own order (`refs/heads/`, then
`refs/remotes/`) before answering, in `probePlainBranch`
(`lib/git/log-queries.ts`), because the availability probe speaks in full refs
(`resolveCommitRef` refuses anything that is not `refs/…`). Deriving the identity
from a `refs/…` prefix alone threw `Invalid Git branch ref: bak/4pi-desk-main`,
and the panel answered *"No commit matches this filter."* for a branch with
hundreds of commits. A slash in a name does **not** mean "remote": a local branch
is allowed to have one. The query itself runs on the plain name, validated by
`check-ref-format --branch` in the service.

A failed read is shown as a failed read. The Log used to swallow the rejection
and paint the empty state, which sent the reader hunting for a filter they had
not set.

**The search box searches messages and hashes.** git's `--grep` matches the
message, case-insensitively (`-i`, because `Memory` and `memory` are one search).
A word made of 4–40 hex digits is also the short hash the reader just read in the
row, and `--grep` says nothing about hashes: `getLog` reads a wider page and picks
the rows whose hash starts with the word or whose message contains it, then cuts
back to the page (`lib/git/git-service.ts`). The field says so: *Search the
message or the hash*.

**The date column states the moment.** `formatLogDate` (`components/git/git-ui.tsx`)
renders `2026-11-25 23:21`, local time, zero padded, so the column sorts as it
reads; the full time stays as the cell's title. The relative form (`14h`) belongs
to a feed, not to a list read across a week.

**The filter chip is on the row that names the view** (`.git-panel-section-header`),
not in a row of its own: a row under the title cost the log a line of commits, and
the chip is the title's state. Its name truncates (`.git-chip-label`), its × does
not.

## The panel on a phone

Upstream's mobile CSS hides the strip's expand button (the panel already spans the
width). The fork shows it again (`app/native-theme.css`, phone media query) because
the Git panel is the view that wants the whole screen, and the top-right corner of
the mobile panel was empty: **expanded** is the full viewport, **not expanded**
leaves the chat's topbar above it, so the button changes what you see.

The header's project chip is a **project switcher on the phone**: it lists the
projects the sidebar lists (`availableProjectRoots`, named by
`getProjectDisplayName`), marks the one this session works in, and opens a session
in the one you tap (`components/TopbarProjectChip.tsx`, wired in
`components/AppShell.tsx`). The desktop keeps the path tip — its sidebar is open.
The branch chip is desktop-only: on a phone it is the first thing cut and the last
thing a reader needs, with the Git panel one tap away.

## The panel's geometry on a phone, and the row menus (bs2)
- **The phone's expand button expands.** The strip's expand button is kept at phone width (upstream hides it: the card already spans the width) because the Git view — a branch tree, a commit list, a diff — cannot live in a short card. On a phone "expanded" is the viewport, so `AppShell` computes `rightPanelViewportFull = rightPanelOpen && rightPanelExpanded && isMobile` and the same `right-panel-full-width` class carries it; `rightPanelExpandedVisual` is what the button's pressed state, icon and word follow (`files.expandViewport` / `files.shrinkPanel`, three packs). The state is cleared when the panel closes and when the shell kind crosses, never merely because the shell is a phone — clearing it on every phone render is what made the press do nothing.
- The phone's CSS must carry `!important` to be seen at all: the panel's phone block pins the card with `top: 0 !important; height: 100dvh !important`, so the unexpanded card's `top: 52px !important; height: auto !important` (which leaves the chat's topbar above it) needs the same weight. `components/AppShell.mobile-expand.test.mjs` pins that; `e2e/mobile-panel-expand.mjs` measures the boxes at 390px (button in the header row's right end, press → viewport, press → card) and includes an un-fixed pass where the press must change nothing.
- Two harness facts that cost hours once: a phone viewport needs `<meta name="viewport">` (without it the page lays out at 980px and every `max-width: 640px` rule misses), and the app's three stylesheets must be served as three `<link>`s — concatenated into one sheet, one parse error takes the rest down and the phone rules silently stop applying.
- **Row menus open at their row.** `anchorTo` (`components/git/git-ui.tsx`, exported for the check) places a branch/commit menu at `max(MENU_MARGIN, row.left)`, from the row's left edge and not the kebab's; the pop-in transform means a browser check measures the settled box, after the animation. `e2e/git-menu-alignment.mjs` measures three panel widths × every row, and a kebab-anchored pass shows the old placement so the check can see the bug.
- **A menu's labels start at the row's left edge, not its middle.** A `<button>` is `text-align: center` in the browser's own sheet, and a menu row's label inherits that: the branch menu read as a column of centred headlines whose left edges line up with nothing, widest in the widest menu. The shared row rule in `app/native-theme.css` (`.app-menu :is(button[role="menuitem" | menuitemcheckbox | menuitemradio | option])`) says `text-align: start`, so every menu in the app is a list. It is a rule of the shared surface, not of the Git panel: `.git-repo-row` and `.project-picker-option` had already declared their own `text-align: left`, which is why those lists looked right while the branch and commit menus did not. `e2e/git-menu-alignment.mjs` measures every label box against its row's content edge (past the row's 2px focus-ring border and its padding) and fills its content width, and a centred pass reproduces the old look so the check can see it.

## The repo switcher's Projects group

The header's repo button opens one menu: the checkouts this folder can reach (its
worktrees — a worktree is its own checkout, so each is a row with its branch and
its `worktree` tag), and below them the **Projects** group, which is the app's own
project list.

- **The list is the sidebar's list.** `AppShell` builds `appProjectList` from
  `availableProjectRoots` (the sidebar's roots, in the sidebar's order, named by
  `getProjectDisplayName`) and hands it to `GitPanel` as `projects`. The panel's
  `?projects=1` answer is the same list read on the server
  (`listProjectRepos()` in `lib/git/workspace.ts`) and stays as the fallback for a
  surface with no sidebar to ask. The two must not drift: the phone's project chip
  (`topbarProjects`) is built from the same memo.
- **A project row carries its name and nothing else** — no branch, no worktree
  tag. The group answers *which project*; the branch is the header chip's job for
  the project that is open. With a second column, the names were cut to four
  characters (`pi-…`, `auto…`) and a list whose rows the reader cannot name is not
  a project list.
- **All of it, including the projects with no repository.** `listProjectRepos()`
  answers `isRepo: false` for a project folder that is not a checkout and leaves it
  in; dropping those folders made the panel's list disagree with the sidebar's. A
  project whose folder is gone, or that the app is not allowed to read, is left
  out — there is nothing to switch to. Opening a project with no repository is a
  real answer: the panel says `git.repoNone` / shows git's own error, rather than
  hiding the project.
  `lib/git/workspace.test.mjs` measures both shapes against a real worktree and a
  plain folder, and `components/git/panel-reports.test.mjs` (10, 10b) pins the
  names-only row and the shell handing the list down.

