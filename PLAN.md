# PLAN — search prompts, one session mention, attachments across a reload

Branch `fix/new-session-attachments-prompt-search-session-mention`, from
`test-merge/test-merge-pi-desk-main` (`742ae86e`).

The ask, in the user's words (with screenshots):

1. On a new session page, refreshing the page makes the attachment disappear; it
   should survive the reload.
2. The sidebar's `Search titles…` box becomes `Search titles/prompts…`, and typing
   finds a session by its title **or by a prompt inside any session**.
3. A session row's "Insert into chat" inserts a title that is not the one the
   composer's own `#` autocomplete inserts; the menu must insert the same text.

## Phases

1. **One mention label** — `sessionMentionTitle` (`lib/session-reference.ts`) is the rule
   the composer's `#` palette already used: name, else the first prompt in full
   (newlines → spaces, `"` → `'`), else the id. The palette calls it; the row menu
   inserts through `ChatInput.insertSessionMention`, which registers the label → id
   target so the send path expands it. Done.
2. **The search box** — label in three locales; a query the tree cannot answer settles
   into `scope=prompts` (`lib/session-prompt-search.ts` on `cachedSessionPrompts`,
   `GET /api/sessions/search?scope=prompts`, `SessionSearch scope`); Enter keeps the
   transcript scan; Escape returns to the tree. Done.
3. **Attachments across a reload** — `lib/draft-attachment-store.ts` (IndexedDB,
   caps, eviction, write-skip by signature) wired into `lib/draft-store.ts`
   (`setDraft`/`clearDraft`/`clearSentDraft`/`clearStoredDrafts`,
   `loadStoredDraftAttachments`) and into the composer's mount effect. Done.
4. **Guards and docs** — unit tests for the byte store, the reload, the label rule and
   the sidebar pins; `e2e/search-draft-insert.mjs` for the three behaviours;
   `docs/agents/fork-ui.md`, `AGENTS.md` (file map, `SessionSearch` is mounted UI).
   Done.

## Guard rails (do not cross)

- localStorage stays **text only**; nothing about the byte store may make the prompt's
  survival depend on IndexedDB.
- An attachment list is never applied over a composer that already has attachments
  (the same rule that killed the composer-copy mirror: a late write must not repaint
  what the user is doing).
- A send, a cleared box and a sign-out remove the durable record; a composer that
  merely unmounted leaves the project's parked draft alone.
- The mention insert sends nothing: the prompt stays the user's.
- No per-keystroke transcript scan; no per-keystroke screenshot write.

---

# PLAN (carried) — memory release for the pi-desk server and page

Branch `fix/memory-release`, from `pi-desk-main` (`38d99e1a`).

The ask, in the user's words: release session memory as soon as sessions end;
release session A when switching to B; release the memory of collapsed thinking /
tool call / report blocks while streaming; find the rest. Server RSS had reached
10.6 GB (peak 18.62 GB).

## Phases

1. **Heap ceiling at every entry point** — `bin/server-flags.js`, `scripts/dev-server.mjs`,
   `scripts/web-dev.mjs`, `scripts/lan-server.mjs`, `bin/pi-web.js`,
   `desktop/server-launcher.cjs`, `next.config.ts` (`turbopackGc`). Done.
2. **Metering** — `lib/server-memory.ts` (process + buckets + budget),
   `lib/client-memory.ts` (page), `GET /api/agent/debug?memory=1`,
   `scripts/memory-bench.mjs`. Done.
3. **Idle caps and release on switch** — warm-session budget 256 → 64 MB with
   `PI_WEB_IDLE_CAP_BYTES`; grace 30 → 15 s; a session the page only *read*
   releases at `PI_WEB_VIEWER_RELEASE_MS` (10 s); `POST /api/agent/[id]/release`
   (the page says it left) shortens the countdown to `PI_WEB_RELEASE_GRACE_MS`
   (5 s); read-only view cache 12/256/64 MB → 8/96/32 MB. Done.
4. **The pressure valve** — `lib/cache-registry.ts` (a pruner per cache),
   `applyMemoryPressure()` / `maybeApplyPressure()` in `lib/server-memory.ts`,
   the sampler firing it over `PI_WEB_MEMORY_BUDGET_MB`, `?memory=1&pressure=1`
   and `?memory=1&gc=1` on the debug route. Done.
5. **Slim live append path** — the completed message the streaming run appends to
   client state keeps full thinking and base64 images (history loads use
   `deferThinking=1&deferMedia=1`). Not started.
6. **Collapse = release on the page** — `content-visibility`, a real cap on
   `visibleCount`, the prefetch cache. Not started.
7. **Wire deltas** — `tool_execution_update` payloads delta-only, a per-event
   payload cap. Not started.
8. **Measure** — `scripts/memory-bench.mjs` on a capped production build, before
   and after each phase. In progress.

## Guard rails (do not cross)

- Never evict a running wrapper (`lib/rpc-manager.ts` `isRunning()`).
- Never slim entries of a *persisting* `SessionManager`: pi's `_rewriteFile()`
  would write the slimmed entries over the real transcript (see DECISIONS.md).
- Keep assistant `content` arrays dense (`fillContentGaps`).
- No count cap on warm sessions — 0.8.1 had one, it broke switching, it is gone
  for good (`lib/idle-session-cap.ts` doc).
- `proxyClientMaxBodySize` stays > 100 MB.
- No `next build` while `npm run dev` holds `.next/dev/lock`; the desktop build
  (`PI_WEB_DESKTOP_BUILD=1`) is the isolated one.
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

- Nothing from the recorded list is open. The two that remained — branchshift bs2
  and the file-list load speed — are in the third batch below.

### Shipped and verified (2026-11-28, third batch)

- **branchshift bs2.** Three items, and the first and third turned out to be
  presses that did nothing.
  - *The phone's expand button expands.* The shell computed the panel's full-width
    class with `&& !isMobile`, so the button the fork keeps on a phone (the Git
    view cannot live in a short card) set a state the CSS never saw. The phone's
    expanded state is its own (`rightPanelViewportFull` — the viewport, not a
    wider column), carried by the same class the CSS answers, cleared when the
    panel closes and when the shell kind crosses, and the button says the screen
    and the card (`files.expandViewport` / `files.shrinkPanel`, three packs). The
    phone's CSS must carry `!important` to be seen: the panel's phone block pins
    the card with `top: 0 !important`, so the unexpanded `top: 52px` needs the same
    weight to leave the chat's topbar above the card.
    Checks: `e2e/mobile-panel-expand.mjs` (390px: the button in the header row's
    right end, press → viewport, press → card, and an un-fixed pass where the press
    must change nothing) and `components/AppShell.mobile-expand.test.mjs` (the
    shell's rule, the words in three packs, the CSS that has to beat the pin).
  - *The project list says which branch each project is on.* The picker listed
    folders by name; in a worktree setup the names are what the user typed. New
    `GET /api/projects/branches` answers many paths in one request from a 5 s cache,
    and answers a path it may not read exactly like a folder that is not a
    repository. Checks: `lib/project-branches.test.mjs` (8),
    `app/api/projects/branches/route.test.mjs` (5),
    `components/ProjectPicker.branches.test.mjs` (4).
  - *The branch and commit menus open at their row.* `anchorTo` already placed a
    menu at `max(MENU_MARGIN, row.left)`; `e2e/git-menu-alignment.mjs` now measures
    it — three panel widths, every row, the settled box after the pop-in transform,
    and a kebab-anchored pass that reproduces the old placement. Writing it found
    two harness facts: a phone viewport needs `<meta name="viewport">`, and the
    app's stylesheets must be served as three `<link>`s (concatenated, one parse
    error takes the rest down and the phone rules silently stop applying).
- **The file tree asks for a directory once.** `lib/file-listing-cache.ts`
  (fork-owned) puts the tree's listings behind three rules — in flight is enough
  (a second caller joins the running request), a window that ends (15 s, and the
  app invalidates the moment it writes, renames or deletes in a folder; a refusal is
  never cached), a prefetch that is a courtesy (child directories, concurrency 3).
  `FileExplorer.fetchEntries` goes through it, the root listing runs `force` so the
  refresh is never answered from the window, `runFileOp` invalidates the target and
  its tree, an upload invalidates the folder it wrote into, and `__piFileListingCache.stats()`
  tells a probe what was saved.
  Measured on the dev server (Turbopack, this project as the workspace, one open and
  three expansions): **5–6 duplicate requests joined** per open — the development
  double effect and the prefetch's pair, 8 real fetches where the flow asked for 13;
  a prefetched folder's expansion costs **no request of its own** (`hits` 1 → 4
  across three expansions, 56–84 ms); a folder past the prefetch's cap still costs
  its request. The window's first value, 2 s, was the bug: it covered the burst and
  expired before a hand reached the mouse, so a prefetched folder was fetched again.
  The prefetch's caps are the tree's (`PREFETCH_CHILD_DIRS` 6, `PREFETCH_ALL_UNDER`
  12): measured at 25 prefetched requests the open got slower, which is why a home
  directory is not prefetched hundred-wide. Re-expanding stays free the way it was
  (the tree keeps a loaded node's children).
  Checks: `lib/file-listing-cache.test.mjs` (6), `components/FileExplorer.listing-cache.test.mjs` (5).
  `lib/file-tree-visibility.ts` and the list route stay upstream's — the queue is
  the fork's.

### Shipped and verified (2026-11-28, second batch)

- **The Git view is a tab of the right panel's bar.** `GIT_PANEL_TAB_ID` is a
  pinned tab (`kind: "git"`, `badge: changesCount`) beside the file, terminal,
  artifact and side-chat tabs; a chat's bar never gets it. Picking it opens the
  view, picking any other tab hands the content area back, and its `x` hides the
  view without removing the tab. The view stays mounted behind the tab switch
  (the keepalive), so switching tabs is a look away, not a re-read.
  Checks: `components/TabBar.git-tab.test.mjs` (the tab, the count, both
  directions of the exclusion, the keepalive, the badge's ink, the three packs)
  and `e2e/git-tab.mjs` (the real strip with the real CSS: four tabs on one row,
  the count inside the tab and never over the label, every part of every tab —
  glyph, label, dirty dot, count, close `x` — within 1px of the tab's centre
  line, `99+` cap, the click answers). Both are in `npm run test:e2e`.
- **The uncommitted diff's `Access denied` was the path git prints.** The lead
  on record ("the stricter pair resolves real paths while the plain lexical
  check passes") is **not** what splits: `isExistingPathWithinRoots` resolves
  both sides (`resolveRealRoots`), and a live probe of the route over six path
  shapes (modified, non-ASCII, deleted, untracked, link-escape, missing) showed
  read and diff agreeing everywhere. The split is the opposite direction: git
  prints the checkout **resolved** (`git rev-parse --show-toplevel`), the
  allowed roots record the folder the user picked — through a link when the
  project is a linked worktree reached by one. The lexical check the route ran
  first rejected the file the panel had just listed and read.
  `lib/git-diff-access.ts` is now the gate: containment after the links are
  followed, on both sides, walking up to the nearest existing entry for a
  deleted file, and the refusal is one of four named cases
  (`parent-segment`, `outside-root`, `link-escapes-root`, `unresolvable`) so the
  pane can say which. A link inside the project that leaves it is still refused.
  Checks: `lib/git-diff-access.test.mjs` (8 tests, a real `git worktree` under a
  real link), `app/api/git/diff/route.test.mjs` (the linked-worktree request
  answers with its patch; the junction refusal carries its reason),
  `components/FileViewer.diff-denied.test.mjs` (the refusal keeps the diff mode,
  shows the sentence and the path, and the reason sets at both ends stay in
  step). Four sentences, three packs each.
- **Monaco's find widget: one centre line.** The widget is a 33px box Monaco
  lays out by hand — the row carries a 3px top margin, the close `x` is
  absolutely placed 5px down — so a 520px panel measured **three** centre lines
  in one strip (widget 64.5, field 63.5, `x` 61). The row gets the widget's 4px
  gutter, the `x` the symmetric 8.5px of its 16px box. Check:
  `e2e/editor-find.mjs` at 380/520/900px — every part within 1px of the widget's
  centre, the widget inside the editor's box, and a second pass with the rules
  removed that measures the old split, so the probe can see the bug it is for.
  The harness is part of the finding: **Monaco's own stylesheet is what positions
  those parts.** esbuild emits it beside the bundle (`fixture.css`) and a page
  that links only the app's sheets measures the buttons as unstyled 337px blocks,
  one per row — which is what the earlier probe reported as "419px wide, actions
  centred on the second row". Any harness that mounts Monaco must link both
  sheets, in the app's order.
- **The tab's `x` is centred, measured.** The plan asked for the fix; the probe
  says the tab row already centres. The real panel's strip (48px) puts its tab
  bar, every tab, and each tab's glyph, label, dot, count and `x` at centre
  line 24 — in the live app and in `e2e/git-tab.mjs`. That check is now
  registered, so the centring is pinned instead of assumed.

### File listing: the measurement (was "needs a live measurement")

Dev server on 30141, a production build served on 30142 (`PI_WEB_DESKTOP_BUILD`),
and the route handler timed in-process. "Cold" is a fresh server process and a
root never listed before; a true cold *disk* needs `purge` (sudo) and is not in
these numbers.

| what | number |
| --- | --- |
| readdir of a directory (no git) | 0.1–0.3 ms |
| the route's visibility rule, one directory (current) | p50 8.9–16.9 ms |
| the same at the pre-fork baseline `6fcd7d4` (v0.10.0) | p50 8.1–16.3 ms — **the fork costs nothing here** |
| first list request of a fresh production process | 561 ms (one-time route init) |
| the same request, warm | 18–21 ms |
| HTTP, warm, production | 12–26 ms per directory, flat with size |
| panel open, **production** | first tree row 275 ms; 1 list (26 ms) + 1 git/status (36 ms) |
| panel open, **dev** | first tree row 1117–2831 ms; the list and the status each fire **twice** |

Readings, in order of what they cost:

1. The floor is the **git child process**, not the directory: the visibility
   rule runs `git check-ignore` (and `git ls-files` when a name comes back
   ignored) per listing, `lib/file-tree-visibility.ts`. It is ~7 ms per spawn,
   so a listing is 8–17 ms whatever it holds, and 6.8 ms of that is spent
   spawning git **outside a work tree** just to fail. Upstream owns this module
   and the fork's list handler is at parity with the baseline.
2. Dev-mode's **double effect** (React StrictMode) doubles the panel's opening
   pair, and the first request pays the route's first-compile. Production pays
   neither: 275 ms and one request.
3. The remaining user-visible cost is **one request per folder opened**, each
   with its own git spawn, plus the `/api/git/status` that rides every cwd
   change and every `treeRefreshKey` bump.

The fix that follows from the table is a short-TTL, event-invalidated memo of the
git answer per directory in a fork-owned module (the file `lib/file-access.ts`
already caches its roots for 5 s the same way), plus skipping git where there is
no work tree to ask. That keeps `lib/file-tree-visibility.ts` upstream's.
