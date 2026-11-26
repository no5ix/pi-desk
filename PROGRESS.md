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

## Next

P3 — the panel UI (`components/git/**`), then P4–P7 (editor), P8 (visual pass),
P9 (full test/lint/build + push). See PLAN.md.
