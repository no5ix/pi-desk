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

## The completion popup is not proven in a browser (open)

`e2e/file-editor.mjs` mounts Monaco the way the app does and measures it: the
file painted in the panel's box, the Ayu Monokai ink, the auto-save writing the
buffer against the read's `mtime`, Cmd/Ctrl+S answering at once, Tab accepting a
completion, no sideways page scroll, at four widths and both themes. Every
assertion passes except one:

    desktop: typing a prefix opens the completion list

No `.suggest-widget` exists in the page after the prefix is typed and
`Control+Space` is pressed.

**An earlier reading of this blocker was wrong, and is recorded so it is not
repeated.** The probes reported a widget node classed
`editor-widget sw visible shows-details` and rows reading
`formatCommitTime / in this document`. That node is the **sticky-scroll** widget
(`sw`), and the rows were the editor's own `.view-lines` text. In Monaco 0.52.2
the suggest widget is classed `editor-widget suggest-widget`
(`suggestWidget.js:105`), so the harness's selector is right and no probe ever
showed the popup opening. The probes' provider log is the honest signal: only a
formatting participant was called — `provideCompletionItems` was never reached.

Ruled out, each by inspection of the installed Monaco (0.52.2) and of the built
harness bundle:

- the selector: `.suggest-widget` is the class Monaco adds;
- two Monacos in the bundle: `editor.widget.suggestWidget` appears once, and
  `registerWordCompletion` is in the bundle (definition + call) — one instance,
  our provider registered on it for `"*"`;
- the trigger's own rules (`suggestModel.js`): `_onCursorChange` →
  `_doTriggerQuickSuggest` → `LineContext.shouldAutoTrigger` needs a word at the
  caret, the caret at the word's end, and a non-numeric word. Typing `format`
  satisfies all three, and `quickSuggestions: { other: true }` is on;
- the kind filter: the items are `CompletionItemKind.Text` and
  `suggest.showWords` is `true`, so `SuggestModel`'s disabled-kinds set does not
  drop them (this was a real defect and is fixed);
- the worker: `components/editor-worker.ts` is reached through the literal
  `new URL("./editor-worker.js", import.meta.url)`, and the harness serves the
  whole output directory, so the chunk resolves.

The next step, in the harness and not in the app: log from inside the provider in
`e2e/file-editor.fixture.jsx`, drive the manual command
(`editor.trigger("keyboard", "editor.action.triggerSuggest")`), and read
`_languageFeaturesService.completionProvider.has(model)` — the branch between
`_doTriggerQuickSuggest` and a provider call is `hasModel() && hasWidgetFocus()
&& completionProvider.has(model)`, and that last term is the one no probe has
looked at.

Consequence, stated plainly: the completion *logic* is tested
(`lib/editor/word-completions.test.mjs`, 9 tests) and its wiring is asserted at
the source level (`components/FileViewer.editor.test.mjs`, which pins
`wordBasedSuggestions: "off"`, `showWords: true`, `CompletionItemKind.Text`, the
provider for `"*"`, `tabCompletion: "on"`). That the popup appears in the app's
own build is not shown. `e2e/file-editor.mjs` is not in `npm run test:e2e` until
it passes; the file says so at the top.

## The composer's source-shape guards (pre-existing, listed so they are not mistaken for this batch's)

37 unit tests fail at this branch's HEAD and the same 37 with the fifth batch
applied (5121/39 → 5131/37 at HEAD/work). They are guards over `ChatInput.tsx`
and friends, and they broke when the composer's model, reasoning, tools and
session-automation controls moved into the `+`'s menu (`ComposerPlusMenu.tsx`)
and when the popups were routed through `usePopTransition`. `AgentsConfig.test.mjs`,
`SessionSidebar.file-search.test.mjs` and `FileViewer.editor.test.mjs` were
updated with the fifth batch because this batch's work moved under them; the rest
are the same one-line-of-source moves, unmade:

- `ChatInput.composer-row` (10), `ChatInput.automation` (2),
  `ChatInput.compaction` (2), `ChatInput.composer-expand` (3),
  `ChatInput.streaming-thinking` (2), `ChatInput.mobile-thinking-menu` (1),
  `ChatInput.test` (6), `CostRouting.wiring` (1) — the controls the guards look
  for are now in `ComposerPlusMenu.tsx` / `ComposerReasoningRows.tsx`;
- `ModelSelector` (1), `lib/composer-panel-placement` (2), `usePopTransition` (1),
  `SideChatIcon` (1), `MobilePwaLayout` (2), `SessionSidebar.project-row` (1),
  `SessionSidebar.test` (1), `useAgentSession` (1) — same family: a moved import,
  a renamed helper, a host element that changed.

The rule that applies to them is the one in DECISIONS.md: follow the behaviour to
the file that carries it, and keep the assertion able to fail.
