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
- [ ] **P3 Git panel UI.** `components/git/**`: Log (branch tree · graph +
  commit list · detail) and Commit (Commit · Shelf · Stash), context menus,
  push/rollback/conflict dialogs, compare, blame, repo switcher; mounted as a
  right-panel tab; CSS in `app/native-theme.css`; i18n in all three locales.
- [ ] **P4 Editor.** Decide CodeMirror 6 vs Monaco (measure both),
  `components/CodeEditor.tsx`, the `edit` display mode in `FileViewer`,
  `PUT /api/files/[...path]` with conflict detection + atomic write,
  Cmd+S, dirty tab indicator + close guards, external-change reload.
- [ ] **P5 Ayu Monokai.** Vendor `themes/Ayu Monokai-color-theme.json`, generate
  the editor theme + the CSS token colours from it (no hand-copied palette).
- [ ] **P6 Word completion.** Document-local word index, prefix match, ranking,
  Tab accept, Esc dismiss, arrows, no Tab hijack when the list is closed.
- [ ] **P7 Editor tests.** Editing, saving, reopen, dirty indicator, Cmd+S,
  external edits, save conflicts, binary protection, completion cases, tabs,
  highlighting, preview and diff modes.
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
