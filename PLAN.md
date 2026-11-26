# PLAN — Branchshift in the right sidebar + an editable file panel

Branch `feat/branchshift-integration-editor` (from `pi-desk-main` @ 38d99e1a).

Two asks, one branch:

1. Port the Branchshift Git workflow (branch tree, commit graph, commit detail,
   commit/shelf/stash workflow, conflicts, compare, blame) into pi-desk's right
   sidebar, replacing the VS Code extension host with pi-desk's API routes.
2. Turn the read-only file viewer into a lightweight editor: edit + save,
   unsaved-change protection, document-local word completion (Sublime Text 2
   style, Tab accepts), and the Ayu Monokai theme.

## Phases

- [x] **P0 Setup.** Worktree + branch from `pi-desk-main`; deps
  (`zustand`, `@tanstack/react-virtual`, `monaco-editor`); read the
  Branchshift source, the 8 reference screenshots and the pi-desk sidebar shot.
- [x] **P1 Git backend.** `lib/git/**` (ported from `src/git/**`), command
  table `lib/git/commands.ts`, repository discovery + boundary
  (`lib/git/workspace.ts`), SSE refresh (`lib/git/events.ts`,
  `lib/git/watch-stream.ts`), dashboard store, routes
  `/api/git/execute|repos|events`.
- [x] **P2 Git backend tests.** The 112 ported Branchshift suites +
  `lib/git/workspace.test.mjs` (10) + `lib/git/commands.test.mjs` (33) +
  `app/api/git/execute/route.test.mjs` (9).
- [x] **P3 Git panel UI.** (done: `d97c45ab`, `7e783dd3`) `components/git/**`: Log (branch tree · graph +
  commit list · detail) and Commit (Commit · Shelf · Stash), context menus,
  push/rollback/conflict dialogs, compare, blame, repo switcher; mounted as a
  right-panel tab; CSS in `app/native-theme.css`; i18n in all three locales.
- [x] **P4 Editor.** (done: Monaco, `CodeEditor.tsx`, the `edit` mode, the `PUT`
  route with conflict + atomic write, Cmd+S, the dirty tab dot, the close
  confirm, and the watcher that never overwrites a dirty buffer.)
  `components/CodeEditor.tsx`, the `edit` display mode in `FileViewer`,
  `PUT /api/files/[...path]` with conflict detection + atomic write,
  Cmd+S, dirty tab indicator + close guards, external-change reload.
- [x] **P5 Ayu Monokai.** (done: vendored theme + `scripts/build-ayu-monokai.mjs`
  → `lib/editor/ayu-monokai.ts`; the editor paints from it. The read view keeps
  `calmCodeTheme` so a light theme is not given a dark palette — DECISIONS.) `themes/Ayu Monokai-color-theme.json`, generate
  the editor theme + the CSS token colours from it (no hand-copied palette).
- [x] **P6 Word completion.** (done: `lib/editor/word-completions.ts` +
  a provider registered for every language; Monaco's own word/keyword/snippet
  lists are off, `wordBasedSuggestions: "off"`; Tab completes, Enter accepts.) Document-local word index, prefix match, ranking,
  Tab accept, Esc dismiss, arrows, no Tab hijack when the list is closed.
- [x] **P7 Editor tests.** (done: `lib/editor/word-completions.test.mjs` 9,
  `app/api/files/write-route.test.mjs` 11, `app/api/git/flow.test.mjs` 11 on real
  repositories, `components/FileViewer.editor.test.mjs` 12. Five real write-path
  bugs found and fixed.) Editing, saving, reopen, dirty indicator, Cmd+S,
  external edits, save conflicts, binary protection, completion cases, tabs,
  highlighting, preview and diff modes.
- [x] **P8 Visual verification (partial).** `e2e/git-panel.mjs` passes and
  screenshots the panel at desktop / desktop-dark / phone / phone-dark / narrow
  (branch tree, graph rows, commit detail, working tree, touch plates, no
  sideways page scroll). `e2e/file-editor.mjs` mounts the real Monaco and
  screenshots the editor at four widths and both themes: it asserts the file is
  painted in the panel's box, the Ayu Monokai ink, the unsaved bar, Cmd/Ctrl+S
  writing the buffer against the read's `mtime`, `Saved`, and no sideways
  scroll — and its completion assertion fails, diagnosed in BLOCKERS.md, so the
  harness is not in `npm run test:e2e` yet.
- [ ] **P8b Finish the completion check.** Bisect the editor's suggest options in
  `e2e/file-editor.mjs` against the probe that works, fix, then add the harness
  to `npm run test:e2e`.
- [ ] **P8c Visual pass at the reference sizes.** (next) Compare
  `test-results/git-panel/*.png` and `test-results/file-editor/*.png` against the
  eight Branchshift screenshots at 1440/1280/900/760/390 and fix what differs.
- [ ] **P8f Rebase through the API in a real checkout.** (next) The flow suite's
  rebase case was removed (see PROGRESS.md): build a fixture where the replayed
  commit applies cleanly and assert `rebaseBranch` finishes with git's editors
  disabled, `getRebaseState().isRebasing === false`, a linear log.
- [ ] **P8d Reference-check the old panel harnesses.** (next) The eight
  file-workbench e2e harnesses (file-tabs, file-watch, file-markdown,
  file-image, file-html, file-preview-ui, file-viewer-ui, file-tree) have not
  been re-run since the editor CSS and the write route landed.
- [ ] **P8e Reference-check the desktop payload.** (next) `npm run desktop:prepare
  && npm run desktop:verify` — monaco-editor is a new dependency of the payload.
- [ ] **P8 Visual verification.** Dev server + Playwright at the reference
  viewport widths; compare with the screenshots; fix mismatches.
- [ ] **P9 Finish.** `npm test`, `tsc --noEmit`, `npm run lint`, production
  build, full-diff review, commits, push, final report.

## Standing decisions

- No VS Code, no code-server, no extension host, no language servers.
- Git runs server-side only, through `execFile("git", argv)`; the browser never
  names a repository, a path outside a checkout, an argv array, or a shell string.
- One Git state system: the panel reads `lib/git/**`; the file tree keeps its
  cwd-scoped projection (`lib/git-changes.ts`) and the live refresh that feeds
  both is the SSE stream.
- pi-desk's scope note (CONTRIBUTING.md) declines Git-client and file-editing
  features for upstream pi-web. This fork wants them; the user asked explicitly,
  so they are built here and recorded in DECISIONS.md.
- Fork CSS goes in `app/native-theme.css` only; `globals.css`/`settings.css`
  stay byte-identical to upstream.
