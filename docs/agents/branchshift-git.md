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
