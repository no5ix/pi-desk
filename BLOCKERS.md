# BLOCKERS

None open.

## Resolved

- **`git rebase --continue` hung (60s timeout).** git opened Vim for the commit
  message. The executor now sets `GIT_EDITOR=true`,
  `GIT_SEQUENCE_EDITOR=true`, `GIT_MERGE_AUTOEDIT=no` (test:
  "rebase continue through a conflict").
- **A successful rebase reported failure on a local-only branch.**
  `GitService.rebase` always pulled; with no remote, `git pull` failed after the
  rebase had finished. The pull is conditional on an upstream.
- **The branch list threw in detached HEAD.** `git branch` prints
  `(HEAD detached at <sha>)`; the ref parser rejected it. Entries without a
  `refs/` refname are skipped.
- **Merge conflicts reported "Git exited with code 1".** git writes the
  CONFLICT text to stdout, so the failure message fell back to stdout.
- **`next build` and a fresh `next dev` from this shell.** Per AGENTS.md,
  `__NEXT_PRIVATE_ORIGIN` / `__NEXT_PRIVATE_STANDALONE_CONFIG` and
  `NODE_ENV=production` come from the Pi desktop app's environment; they are
  unset for every build/e2e run here.
