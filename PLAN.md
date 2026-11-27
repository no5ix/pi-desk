# Ayu Monokai theme — plan

## Architecture found (pi-desk / pi-web fork)

| Surface | Mechanism | Ink source |
|---|---|---|
| File panel source view (read) | `react-syntax-highlighter` PrismLight (`lib/syntax-highlighting.ts`) + `calmCodeTheme` (`lib/code-theme.ts`) | inline styles from `--code-accent`, `--code-warm`, `--code-comment`, `--text`, `--text-muted` |
| Markdown fence in chat + preview | same, through `CodeBlock` (`components/MermaidBlock.tsx`) | same |
| Markdown preview (file panel) | `ReactMarkdown` → `.markdown-body.markdown-file-preview` | `app/native-theme.css` 7078-7660, `--heading-1..6`, `--accent`, `--text*` |
| Chat Markdown | `components/MarkdownBody.tsx` → `.markdown-body` | same |
| Source editing | Monaco (`components/CodeEditor.tsx`) | generated `lib/editor/ayu-monokai.ts` from `vendor/ayu-monokai/Ayu Monokai-color-theme.json` |
| App chrome | `:root` (light, 1292) and `html.dark` (dark, 1405) in `app/native-theme.css` | literals, per theme |
| Diff view | inline styles (`rgba(0,200,80,.12)`, `rgba(240,60,60,.14)`) + `--success`/`--danger` | literals |
| File tree icons | `var(--md, #d2a6ff)` etc. per language | literals |
| Terminal panel | `--workspace-terminal-*` (Ayu: `#BFBDB6`/`#0b0e14`) | Ayu already |

Single palette source of truth in this fork = the vendored VS Code theme
(`vendor/ayu-monokai/Ayu Monokai-color-theme.json`) → `scripts/build-ayu-monokai.mjs`
→ `lib/editor/ayu-monokai.ts`. The task's table is exactly that theme's
`workbench.colorCustomizations` + `tokenColors`.

Markdown has **no** syntax-token highlighting in preview (it renders to HTML);
its look is `.markdown-body` CSS. In source it is Prism `markdown` tokens, which
`calmCodeTheme` collapses to 3 hues.

## Decisions

1. `app/native-theme.css` gains one **Ayu token block** (light + dark) that is the
   only place palette hex values are written: `--ayu-*` primitives, then the app
   roles (`--bg`, `--text`, `--accent`, …) and the syntax roles (`--code-*`,
   `--md-*`, `--diff-*`, `--editor-*`) derived from them. Dark = the requested
   palette; light = the same hues darkened for paper (documented derivations).
2. `lib/code-theme.ts` becomes a real Ayu Monokai Prism map (keyword `#FF8F40`,
   string `#AAD94C`, number `#D2A6FF`, function `#FFB454`, type `#59C2FF`,
   comment `#ACB6BF8C`, default `#BFBDB6`) expressed **only** as `var(--code-*)`,
   so light/dark is still a CSS change and the highlighter never re-renders.
3. Markdown preview styling is rewritten in the same palette: headings all
   `--md-heading` (`#FFB454`) with a size/weight/letter-spacing hierarchy, bold
   `--md-strong` (`#FF8F40`), italic default ink, links `--md-link` (`#59C2FF`),
   inline code `--md-inline-code` (`#AAD94C`), quote `--md-quote`
   (`#ACB6BF8C`), list markers `--md-list` (`#FFB454`), tables on
   `--md-table-border`, task checkboxes, hr, strikethrough.
4. Prism's `markdown` token classes get the same treatment in CSS (source view of
   `.md` files): heading / bold / italic / url / string / list / quote / punctuation.
5. The diff rows move onto palette tokens (`--diff-added`, `--diff-deleted` and
   their washes) and out of inline styles; the dead role tokens the palette
   carried (`--tree-icon-*`, `--code-accent`, `--code-warm`, `--code-tag`,
   `--code-invalid`, `--diff-modified`) are deleted, because a role nothing
   paints is a second source of truth.

## Verification (shipped state)

- `node --test lib/ayu-palette.test.mjs` — 6/6. Role tokens declared in both
  themes and painted; the Prism sheets colour only with `var(--…)`; the requested
  palette present verbatim on a dark page; `lib/editor/ayu-monokai.ts` generated
  and drawn from the vendored theme; Monaco's editor surface equal to the CSS
  tokens for the same roles; no component paints a literal.
- `node e2e/ayu-theme.mjs` — passes, and is in `npm run test:e2e`. A browser
  measures: Markdown preview (heading amber, keyword bold, string inline code,
  type links, the quote's tone and rule, list markers, table header, checked task
  box, the fenced block's page), Markdown source (the same constructs by the word
  they paint), the read view for TypeScript / JSON / CSS / HTML (comment, keyword,
  string, number, type, function, property, selector, attribute), the chat's
  fenced blocks through the real `CodeBlock` (surface, roles, line numbers),
  Monaco (page `rgb(11, 14, 20)`, ink, gutter `rgba(108, 115, 128, 0.6)` with the
  caret line at 0.9), and the light palette (paper, heading, keyword, string,
  link). Screenshots and `report.json` land in `test-results/e2e-theme/`.
- `node --test` over `app/ lib/ scripts/ components/ hooks/` — 2 failures,
  `lib/composer-panel-placement.test.mjs` ("every composer menu goes through the
  helper", "a server render falls back to the plain anchoring"). Verified
  pre-existing: both fail on a clean `HEAD` (working tree stashed), and they
  concern the composer, which this task does not touch.
- `node e2e/file-editor.mjs` — the Monaco completion section fails here too, at
  the adjacent assertion on a clean `HEAD` ("the document's own word is offered",
  with the suggest widget reporting `Loading…`). Pre-existing, untouched by this
  change.
- `node_modules/.bin/tsc --noEmit` clean; `npx eslint .` reports 0 errors (41
  pre-existing warnings, none in the files this task touched);
  `scripts/upstream-css-baseline.test.mjs` confirms `app/globals.css` and
  `app/settings.css` stay byte-identical to upstream;
  `components/fork-extractions.test.mjs`, `scripts/ui-menu-consistency.test.mjs`,
  `scripts/release-workflows.test.mjs`, `lib/branding.test.mjs` pass (104 tests).
- Production build for the e2e server mode:
  `PI_WEB_DESKTOP_BUILD=1 node_modules/next/dist/bin/next build --webpack` → exit 0.

## Bug batch (2026-11-28, on top of `a2667c23`)

Reported from screenshots: the right sidebar (bugs3), the editor's chrome, and
branchshift (bs2). Each fix below carries a check that fails without it.

### Shipped and verified

- **Cmd+Z died after a save.** A save clears the draft; while the read that
  follows was in flight the editor's `value` was the older read-view text, so the
  value sync called `model.setValue`, which goes through
  `_setValueFromTextBuffer` and drops every undo item (`monaco-editor` 0.52.2,
  `textModel.js`). Two flushes per save, so the stack was empty.
  `saveDraft` now states the disk's content in the same pass the draft is
  cleared, and the value sync replaces the buffer with
  `model.applyEdits([...full range...])`, which keeps the history.
  Check: `e2e/editor-undo.mjs` (the parent replays the old ordering; the report
  disappears from the buffer with the fix, and Cmd+Z answers with nothing when
  `CodeEditor.tsx` is reverted) plus the save-flow assertions in
  `components/FileViewer.editor.test.mjs`.
- **Completion is Tab's, never Enter's.** `acceptSuggestionOnEnter: "off"`
  (Monaco's default commits a selected suggestion on Enter, so a finished line
  became a word from the list). `tabCompletion: "on"` stays.
  Check: `components/CodeEditor.completion.test.mjs`, and the Enter-breaks-the-line
  measurement in `e2e/editor-undo.mjs`.
- **Markdown preview images flashed and the panel scrolled.** ReactMarkdown
  renders through the *types* in its `components` map; the map was built in the
  render, so every panel tick (auto-save, watcher, save chip, outline) unmounted
  and remounted the document — a mounted `<img>` fetches again, and a replaced
  document moves. The renderers are module-level (`MARKDOWN_PREVIEW_COMPONENTS`)
  over a memoised scope context.
  Check: `e2e/markdown-preview-stability.mjs` measures node identity, the `src`,
  the reader's scroll offset and the outline's geometry; it fails on `HEAD`
  ("the same `<img>` node is on the page…").
- **The outline is a column, not a sheet, and starts open.** The file panel's
  body is a flex row (`.file-viewer-body`); the document is the flexible half
  (`min-width: 0`), `.file-toc` is a 268px column with no `position`, no
  `z-index`, and `tocOpen` defaults to true.
  Check: `components/FileViewer.toc.test.mjs` (rewritten to the sidebar
  contract) and the geometry assertion in `e2e/markdown-preview-stability.mjs`
  (the two boxes do not overlap).
- **A reveal answers in every shell.** The row menu's reveal now reveals in the
  app's tree — ancestors expanded, the row scrolled to the centre and flashed —
  and calls the native Finder reveal in the desktop shell. Before, the web shell
  only expanded (nothing visible when the tree was already open), which is what
  made the item look dead. Rows carry `data-file-path` for it.

### Open, not started

- File-list load speed (needs a measurement of `/api/file-tree` against the
  pre-fork behaviour before anything is changed).
- The Git view as a tab: mutual exclusion with the file/terminal tabs, the
  changed-file badge on the glyph, no reload when tabs are switched, and the
  broken diff for an uncommitted file (`Access denied` in the diff pane).
  Lead for the diff: `/api/git/diff` answers 403 from
  `isExistingFilePathAllowed(cwd)` / `isDiffPathAllowed(path)`
  (`app/api/git/diff/route.ts:47-53`), the stricter pair that resolves the
  real path, while the read route the panel uses to show the file gets past the
  plain `isFilePathAllowed` check. A branchshift linked worktree whose path
  resolves through a symlink (a home under a link, `/tmp`, a case-differing
  volume) is the case that splits the two. Reproduce it in a unit test over
  `lib/file-access.ts` with a linked root before changing either check.
- Editor chrome: the tab's `x` centred on its row, the Monaco find widget's
  alignment. A probe measured the widget in the app's stylesheet (419px wide,
  the actions centred on the second row); the fix needs the real panel's DOM.
- branchshift bs2: the mobile expand button, the project list without branch
  info, left-aligned branch/commit menus.
