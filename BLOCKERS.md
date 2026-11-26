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

## The completion popup does not open in the bundled harness (open)

`e2e/file-editor.mjs` mounts Monaco as the app does and measures it: the file
painted in the panel's box, the Ayu Monokai ink, the unsaved bar, Cmd/Ctrl+S
writing the buffer against the read's `mtime`, no sideways page scroll, at four
widths and both themes. All of that passes. The one assertion that does not:

    desktop: the document's own word is offered ()

Typing a prefix opens no `.suggest-widget` at all, in the harness and in the
dev-build probe. What has been ruled out, each by a probe:

- the provider is registered for `*` and its shape is right (a standalone probe
  bundle with the same provider and Monaco's default options opens the widget and
  lists rows);
- Monaco's language services are not in the bundle (`editor.api` + `editor.all`
  + `basic-languages`, no TS/CSS/HTML/JSON services), so no provider is waiting
  on a language worker;
- the editor worker is a literal `new URL(..., import.meta.url)` and the harness
  serves the emitted chunk, so the word context is not the silent stub;
- the worker factory returns a Blob worker for non-editor labels and never
  throws (an earlier shape threw out of the completion path, which is what the
  `toUrl` page error was).

Remaining suspects, in order: the `suggest: { showWords: false, … }` option
object, `triggerCharacters: []` with `quickSuggestions: { other: true }`, and the
options Monaco validates and drops. The next step is to bisect the options in
`e2e/file-editor.mjs` against the probe (which uses none of them), starting with
the `suggest` block.

Consequence, stated plainly: the completion *logic* is tested
(`lib/editor/word-completions.test.mjs`, 9 tests) and its wiring is asserted at
the source level (`components/FileViewer.editor.test.mjs`), and the editor's
saving, dirty state and theme are tested in a browser. That the popup appears in
the app's own webpack build is not yet shown. `e2e/file-editor.mjs` is not in
`npm run test:e2e` until it passes; the file says so at the top.
