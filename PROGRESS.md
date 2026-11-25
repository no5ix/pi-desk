# PROGRESS — the status line and a tool card show a command's output as text, not ANSI boxes
Branch `feat/branch-picker-header-worktrees`. The report: the running status read
`Running bash... [0m[33m[1m[22m[39m[0m`, and the same escape-code boxes filled the
`bash` card's output under it.
**Implemented; `4243 pass / 0 fail` over `lib`, `components`, `hooks`, `tsc --noEmit` and `eslint` clean.**
## What changed
| File | Now |
| --- | --- |
| `lib/tool-execution-progress.ts` | The progress line is read by what it shows: ANSI stripped first, `\r` is a line break, an invisible line loses to the text above it |
| `components/MessageView.tsx` | A tool card's plain result pane strips the escapes (`stripAnsi`), and an escape-only result is "no output" |
| `lib/tool-execution-progress.test.mjs`, `components/MessageView.test.mjs` | The coloured eslint summary, the colour-only line, the `\r` bar, the card with no boxes |
| `docs/agents/sessions.md`, `AGENTS.md` | The rule beside the running-phase note, the two files in the map |
## Implementation state
* **The cause.** pi streams a running tool's raw output, and `getToolExecutionProgress()`
  quoted its last line into the status line, which renders as a **plain string**. eslint
  ends a run by painting colours (`\x1b[0m\x1b[33m\x1b[1m…`), so the newest "line" was
  nothing but escapes — the boxes the screenshot shows, and no progress at all.
* **`stripAnsi` (`lib/ansi.ts`) is the fork's existing answer** for surfaces that show
  plain text (extension dialogs, notices, the page title). The status line and the tool
  card's result pane now go through it; `components/ChatWindow.tsx`'s interactive bash
  pane stays the one place that paints them, with `AnsiText`.
* **`\r` joined `\n` as a line break** in the progress read: a bar that redraws one line
  ("10%\r50%\r100%") used to report the whole run-on, and now reports its latest frame.
* **Truncation is unchanged** (500 chars, keeping the tail), applied to the visible text.
* **Untouched on purpose:** the interactive bash pane's colours, the codemode progress
  (built from call args, no escapes), a card's input JSON and diffs (kept verbatim),
  `demo/` (a snapshot copy that lags by design).
## Verification
* `node --experimental-strip-types --test --test-concurrency=4 "lib/**/*.test.mjs"
  "components/**/*.test.mjs" "hooks/**/*.test.mjs"` — **4243 pass, 0 fail**.
* `node_modules/.bin/tsc --noEmit` clean; `eslint` clean on the four touched files.
* No e2e run: the change is text rendering in two display helpers, with unit coverage
  of both.
## Next
* Push `feat/branch-picker-header-worktrees`.
* The tree keeps the user's own in-progress work (`ChatInput.tsx`, `ChatInput.composer-row.test.mjs`,
  `app/native-theme.css`, `ModelSelector.tsx`, `tmp-*.mjs`) — not staged here.
