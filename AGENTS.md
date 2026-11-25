# Pi Web - Development Notes

## Autonomous Execution and Context Management

You are an autonomous senior software engineer. Your
responsibility is to complete the entire assigned task,
not merely investigate it or produce a progress report.

### 1. Never stop because of context pressure

- Never voluntarily terminate a task merely because you
  estimate that your remaining context is low.
- Do not interpret context pressure as task completion.
- Use Pi's native automatic compaction mechanism.
- Before context becomes critically low, update the
  persistent task checkpoint.
- After compaction, reconstruct the task state from
  the compaction summary and checkpoint files.
- Resume from the exact next unfinished step.
- Do not repeat completed work unnecessarily.

### 2. Maintain continuous execution

- Work through all remaining phases independently.
- Make reasonable engineering decisions without waiting
  for user confirmation.
- If one approach fails, investigate alternatives.
- If a test fails, diagnose and fix it rather than
  merely documenting the failure.
- Do not stop after producing an analysis or plan.
- Do not stop after completing only the easiest phases.

### 3. Use durable checkpoints

Maintain:
- PLAN.md
- PROGRESS.md
- DECISIONS.md
- BLOCKERS.md

Update PROGRESS.md after every significant milestone.

Record:
- Completed tasks
- Current implementation state
- Failed attempts and their causes
- Outstanding work
- Exact next actions
- Verification results

### 4. Handle blockers intelligently

Do not classify low context, a failed approach, or a
temporary tool error as a reason to abandon the task.

Try alternative implementations and verification methods.

Only stop when:
- The task is genuinely complete;
- An external dependency makes further progress impossible;
- A security or safety restriction prevents continuation;
- Or an explicit user decision is genuinely required.

When blocked, complete all independent work first.

### 5. Completion requirements

Do not declare success based on partial test results.

Run the relevant verification suite, inspect the final
Git diff, and verify the working tree.

Continue until all achievable acceptance criteria are met.

Do not substitute a progress report for implementation.

The task is complete only when its acceptance criteria
have been satisfied and verified.

Your goal is to finish the task, even if it requires
multiple context compactions and many execution cycles.

### 6. Commit and push the verified work

Verification is not the end of a task. Once the relevant
suite passes:

- `git add` the files this task changed, and only those.
  Never stage a file the task did not touch (a user's own
  uncommitted edits, generated `.next/`, screenshots), and
  never `git add -A` in a tree you did not author fully.
- Commit with a message that names the behavior fixed and
  the cause, in the repo's `fix: …` style.
- Push the branch the task named:
  `git push -u origin <branch>`. Push after every
  verification pass, so a compaction or a closed window
  never leaves the work uncommitted.
- Never force-push over a branch you did not author, and
  never push `main` / `master` directly.
- Report the commit and the pushed ref, with the working
  tree clean (`git status --short` empty apart from files
  that were already dirty).

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit` · Lint: `npm run lint`

**Never run `next build` during dev**: it pollutes `.next/` and breaks `npm run dev`.

---

## Local environment traps

- **Building (or starting a fresh `next dev`) from inside the Pi desktop app's shell
  fails.** The app exports `NODE_ENV=production`, `__NEXT_PRIVATE_ORIGIN` and
  `__NEXT_PRIVATE_STANDALONE_CONFIG` (its own serialized Next config, from which function
  values are gone). Next's CLI prefers that serialized config over `next.config.ts`, so
  `next build` dies with `TypeError: generate is not a function` and a fresh `next dev`
  with `Missing field turbopackMemoryEviction` — while a dev server that was already
  running keeps working, which makes it look like a repo bug. `scripts/prepare-desktop.mjs`
  deletes both `__NEXT_PRIVATE_*` vars for this exact reason; do the same (or run from a
  normal terminal) before any `next build` / `npm run test:e2e`.
- **The Pi desktop app's shell exports the model provider's environment**
  (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`,
  `ANTHROPIC_DEFAULT_*_MODEL`, `PI_MODEL`, `PI_PROVIDER`, …). A test that assumes
  "no provider has credentials, so the session has no usable model" passes in CI
  and fails from this shell, because pi-web's runtime sees a working built-in
  model. Tests in that class clear the provider variables around their own body
  and restore them (`lib/rpc-manager-chat-only.integration.test.mjs` is the
  pattern); never "fix" such a failure by weakening the assertion.
- The `node` on `PATH` may not be the one the project runs on: the Pi app bundles its own
  runtime, while a dev server started from a terminal uses another install. Check with
  `ps -o command= -p $(lsof -nP -iTCP:30141 -sTCP:LISTEN -t)`.
- `npm run test:e2e` refuses to start while a dev server holds `.next/dev/lock`, and
  `E2E_SERVER_MODE=start` (the mode CI uses) needs a production build. Both can be
  satisfied without touching the dev state by building into the isolated desktop dir and
  pointing the harness at it:
  `PI_WEB_DESKTOP_BUILD=1 node_modules/next/dist/bin/next build --webpack` then
  `E2E_SERVER_MODE=start PI_WEB_DESKTOP_BUILD=1 node e2e/run.mjs` (`next.config.ts` swaps
  `distDir` to `.next-desktop`, which is gitignored).
- **npm 11 blocks dependency install scripts by default.** `npm ci` then prints
  "N packages have install scripts not yet covered by allowScripts" and silently skips
  them, so a fresh install leaves `node-pty` (the desktop terminals), `esbuild`,
  `unrs-resolver` and `protobufjs` unstaged and the app fails in ways that look like repo
  bugs. The approvals are pinned per version in `package.json`'s `allowScripts`
  (`npm install-scripts approve <pkg>` writes them; `npm install-scripts ls` lists the
  gaps). Keep that field in the tree, review it when dependencies move, and never blanket
  `approve --all`. Run `npm ci` only with the dev server stopped: it removes
  `node_modules` under the running server, and a first `npm run dev` from this shell hits
  the `__NEXT_PRIVATE_*` trap above.
- A worktree's `node_modules` can lag the lockfile (created before an SDK bump), which
  fails tests that pin newer SDK behaviour. `npm test` runs `npm run check:deps` first and
  stops with the mismatched packages; `npm ci` fixes it.
- Windows test fixtures use `scripts/test-platform.mjs`: directory links are junctions,
  unavailable file links skip only their own subtests, and POSIX mode checks remain
  active on POSIX hosts. Shell-command fixtures select native Git Bash inside the
  test process; trust fixtures must not inherit the user's ancestor skills. Await
  session shutdown before deleting MCP working directories. Real PTY integration
  runs in a child process; fake-clock tests use a controlled PTY.
- **`next dev` rewrites `AGENTS.md`**: it appends a "This is NOT the Next.js you know" block
  to this file on every start. Preserve the project and user instructions here; review generated
  additions separately and never reset the entire file to discard development output.

### Upgrading pi

pi's packages up to 1.2.0 depend on each other with `^` ranges (1.3.0 pins them exactly), and the published pi-web's dependencies resolve afresh on install (no lockfile ships). Install every `@earendil-works/*` package the tree holds, the SDK's own dependencies included (`pi-codemode`, `pi-mcp`, `pi-telemetry`, …), with `npm install --save-exact`, so npm reuses those exact versions for the SDK's ranges. `lib/pi-packages.test.mjs` fails on any pi package that is not pinned that way; pi-web 0.12.0 pinned four, and installs after pi 1.2.0 paired pi-coding-agent 1.1.0 with pi-codemode 1.2.0.

---

## Architecture

- **Browsing** (read-only, no AgentSession): `GET /api/sessions` lists `~/.pi/agent/sessions/`; `GET /api/sessions/[id]` reads the `.jsonl` through SDK `SessionManager` helpers and `lib/session-reader.ts`, or an open wrapper's in-memory `SessionManager`. `GET /api/agent/running` snapshots the running ids.
- **Sending**: `POST /api/agent/[id]` → `startRpcSession()` (`lib/rpc-manager.ts`) creates the AgentSession in-process (`createAgentSessionFromServices()`); `session.send(cmd)` → `session.prompt()`.
- **Events**: `GET /api/agent/[id]/events` streams SSE `data: {...}` from `session.onEvent()`, fed by `session.subscribe()`.
- **Product scope**: a light web wrapper around pi, not an IDE or a platform of its own. Before adding a feature, check the out-of-scope list in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Extension compatibility (principle)**: extensions written for the pi CLI must behave the same here. Fix display problems in the web client; never add pi-web-only options or fields to the extension API (`ctx.ui.*` options, `extension_ui_request`). pi's TUI (`node_modules/@earendil-works/pi-tui`) is the reference for what an extension asking for something means.

---

## File Map

```
app/api/
  sessions/route.ts               GET  list all sessions
  sessions/[id]/route.ts          GET/PATCH/DELETE session
  sessions/[id]/context/route.ts  GET ?leafId= — context for a specific leaf
  sessions/[id]/file-diff/route.ts GET ?path= — the diff one session's write/edit/apply_patch calls made to a file
  sessions/[id]/last-run/route.ts GET — the last run's start and end, for the completion notice's sentence
  sessions/[id]/export/route.ts   GET exported HTML for a session
  agent/new/route.ts              POST { cwd, message, toolNames?, provider?, modelId? }
  agent/[id]/route.ts             GET state | POST any command
  agent/[id]/events/route.ts      GET SSE stream
  agent/running/route.ts          GET currently-running session ids
  agent/running/events/route.ts   GET SSE stream of currently-running session ids
  agent/tasks/route.ts            GET live task snapshots (running step, waiting dialogs, last outcome) for the Tasks page
  calendar/route.ts               GET ?from=&to= (ms) prompts per session, scheduled runs and planned slots for the Tasks calendar
  remote-access/route.ts          GET/PUT Tailscale remote-access setting (PUT only from loopback)
  network-proxy/route.ts          GET/PUT the app's HTTP proxy setting (PUT only from this computer); test/route.ts POST a connection test
  push/{config,subscribe,unsubscribe,test}/route.ts  Web Push key, device subscriptions, test send
  relay/route.ts                  GET/PUT encrypted relay status and config (PUT local-only)
  relay/pairing/**                POST pairing QR ticket, POST [id] approve/deny (local-only)
  relay/devices/[id]/route.ts     DELETE revoke a paired phone (local-only)
  auth/all-providers/route.ts     GET API-key provider list
  auth/api-key/[provider]/route.ts GET/POST/DELETE provider API key status/storage
  auth/login/[provider]/route.ts  GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts POST OAuth logout
  auth/providers/route.ts         GET OAuth provider list
  cwd/validate/route.ts           POST validate/select a cwd
  default-cwd/route.ts            POST create ~/pi-cwd-YYYYMMDD
  files/[...path]/route.ts        GET file contents for viewer
  home/route.ts                   GET user home directory
  models/route.ts                 GET { models, modelList, defaultModel }
  models/enabled/route.ts         GET/PUT enabledModels switches for the Models panel
  models/refresh/route.ts         POST fetch provider catalogs from pi.dev on demand
  models/nonchat/route.ts         GET classifier + image models (with sign-in state) and the global Code mode choice
  models-config/route.ts          GET/PUT — read/write ~/.pi/agent/models.json
  models-config/catalog/route.ts  GET models.dev pricing presets
  models-config/discover/route.ts POST fetch a configured provider's upstream model list
  models-config/builtin-match/route.ts GET ?baseUrl=&modelId= built-in providers at that endpoint + pi's settings for the model
  models-config/test/route.ts     POST test a configured model/provider
  plugins/route.ts                GET/POST package plugin management
  skills/route.ts                 GET/PATCH loaded skills and disable-model-invocation
  skills/install/route.ts         POST install skills through npx skills add
  skills/project/route.ts         POST turn a skill on, off, or remove it in one project
  skills/search/route.ts          GET/POST skills.sh search
  scheduled-tasks/**              GET/POST tasks, PATCH/DELETE [id], POST [id]/run, GET [id]/runs, POST run seen, POST preview, GET events (SSE)
  worktrees/route.ts              GET list / POST create / PUT switch branch / DELETE git worktrees
  worktrees/fetch/route.ts        POST git fetch --prune + fresh branch lists
  desktop/read-images/route.ts    POST read natively-picked images into attachment payloads
  desktop/save/route.ts           POST copy a file to, or write bytes at, a natively-picked path
  artifacts/settings/route.ts     GET/PUT the "artifacts in the side panel" prompt switch
  session-title/settings/route.ts GET/PUT the "name sessions automatically" switch
  artifacts/route.ts              GET ?q= artifacts across all sessions (Artifacts page)
  artifacts/item/route.ts         GET ?session=&identifier= one artifact with every version
  artifacts/file/route.ts         GET ?path= one written/edited file's calls | ?session=&toolCallId= a write's content

lib/
  agent-client.ts      typed fetch helper for /api/agent commands
  artifacts.ts         `:::artifact` scanner, markdown encoding, version collection
  artifact-store.ts    client store shared by ChatWindow, message cards and the artifact panel
  artifact-index.ts    server index of artifacts in every session file (Artifacts page)
  artifact-settings.ts / artifact-guide-extension.ts  prompt switch file + `<artifacts>` prompt section
  html-preview.ts      inline HTML/SVG/React preview detection, sandbox, srcdoc bootstrap, React document
  preview-runtime.ts   loads public/preview-runtime/ (bundled React, Sucrase, Tailwind) for React previews
  app-prefs.ts         APP_PREF_KEYS + typed localStorage accessors (SSR/private-mode safe)
  desktop-connection.ts useDesktopConnection() — local server health probe for the reconnect banner
  desktop-native.ts    native dialogs, open/reveal path, external links, save/import, window lifecycle
  desktop-notify.ts    native completion notifications (skipped while the window is focused)
  draft-store.ts       local draft persistence helpers
  composer-copy-store.ts  one composer copy per device: shared composer key, per-device record, write token, size caps
  composer-copies.ts   the client's push (debounced) and poll (visible tab) for its own copy and the other devices' list
  composer-panel-placement.ts  a composer menu's width and the box it opens in (never under the sidebar)
  device-identity.ts   this browser's device id, its slug (`mac`/`iphone`/`ipad`) and its copy tokens
  file-access.ts       allowed file roots for /api/files and worktrees
  file-watch-stream.ts  one SSE for a page's file watchers (`?type=watch-all`); the per-file `?type=watch` stays
  file-watch-channel.ts  the client's leader-elected file-watch stream, per-file dispatch (the browser's six connections per host)
  running-sessions-stream.ts  the name of the shared running-sessions stream the sidebar leads
  file-paths.ts        client/server path encoding helpers
  enabled-models.ts    pure minimal-edit engine for the `enabledModels` pattern list
  enabled-models-runtime.ts  SDK adapter: per-pattern resolution, provider kinds, settings IO
  markdown.ts          shared markdown helpers
  npx.ts               npx runner used by skill install
  pi-types.ts          local structural types for pi SDK objects
  network-proxy.ts    Settings › General › Network proxy: process.env + dispatcher rebuild; network-proxy-test.ts the connection test
  rpc-manager.ts      AgentSessionWrapper + registry + startRpcSession
  scheduled-tasks/    scheduler, runner, cron, store, run index for scheduled tasks (see docs/agents/scheduled-tasks.md)
  session-reader.ts   SessionManager wrappers + path cache + buildSessionContext adapter
  session-file-diff.ts  a file's diff rebuilt from one session's write/edit/apply_patch records
  session-last-run.ts   a session file's last run: its start, end, and how long (the notification's numbers)
  task-completion-server.ts  the one announcer of a finished run: push + ntfy + macOS notification, once per run
  notification-tags.ts  the notification tag and the windows every channel shares (public/sw.js mirrors it)
  local-notification.ts  the macOS notification the server raises, and the installation's switch
  ntfy-publish.ts  publish one ntfy message (the route's Test notice and the announcer)
  project-skills.ts   a project's own `.pi/skills` folder: copy a skill in, flip it, take it out
  skill-roots.ts      the skill folders of a project and of the user, read by listing and writer
  skill-shadowing.ts  the twin file pi's one-name loader hides, back on the Skills list
  session-prompts.ts  every user prompt with its time and reply, read on demand for the Tasks calendar (fingerprint cache)
  tool-presets.ts     PRESET_NONE/DEFAULT/FULL + getPresetFromTools()
  terminal-focus.ts   the terminals' input fields and a phone's keyboard rules: the focus must *move*, one gesture cannot blur-then-focus, a read-only field opens nothing (the always-editable way in is `components/TerminalComposer.tsx`)
  types.ts            shared TypeScript types
  normalize.ts        normalizeToolCalls() — field name mismatch between file format and our types
  unparsed-tool-call.ts   the tool call a model printed as text, and the note that names it
  unparsed-tool-call-extension.ts  pi's settle boundary: one more request when a turn ends on that call
  workspace-state.ts  persisted session/cwd/file-tab restore for desktop cold starts
  worktree.ts         project/worktree resolution and git worktree operations

components/
  AppShell.tsx        layout + URL state + tab management
  SessionSidebar.tsx  session tree + FileExplorer
  ChatWindow.tsx      chat composition + completion sound wrapper
  TopbarElapsed.tsx   the header's live clock since the last prompt; its own component so a 1s tick re-renders the chip, not the shell
  ClockIcon.tsx       the clock glyph every duration label shares
  ChatInput.tsx       input bar + model/thinking/tools/compact controls
  ComposerDeviceCopies.tsx  one read-only row per other device's composer copy, docked above the composer
  SideChatIcon.tsx    the side-chat bubble every place that marks one draws (composer, sidebar, header, panel, tab, quote bar)
  MessageView.tsx     renders one message (user/assistant/toolCall/toolResult)
  BranchNavigator.tsx in-session branch switcher
  MarkdownBody.tsx    markdown renderer
  HtmlPreviewBlock.tsx / HtmlPreviewErrorBar.tsx  inline previews and their error strip
  ArtifactCard.tsx / ArtifactPanel.tsx / ArtifactView.tsx / artifact-tabs.ts  artifact card in messages, right-panel tab, shared viewer
  artifacts/          Artifacts page (cross-session list, search, preview) and its sidebar row
  ModelsConfig.tsx    modal for editing models.json (opened from sidebar bottom)
  EnabledModelsSection.tsx  model switches inside ModelsConfig, backed by enabledModels
  AgentsConfig.tsx    built-in subagent toggle + agent profile editor
  PluginsConfig.tsx   modal for installed package plugins
  SkillsConfig.tsx    modal for loaded/search/installable skills
  scheduled/          Scheduled page (list, detail, editor, run history) and its sidebar row
  tasks/              Tasks page (waiting / running / recent across projects), its Calendar mode (TaskCalendar, calendar-helpers) and its sidebar row
  RemoteAccessSection.tsx  Settings › General › Remote access (Tailscale) and "Notify this device"
  RelaySection.tsx    Settings › General › Remote relay: relay config, pairing QR, approvals, paired phones
  SettingsPanel.tsx   settings dialog; its General tab hosts the app intro, Version & Updates and the desktop-only switches
  AppUpdatesSection.tsx  Version & Updates block at the top of General
  desktop/DesktopAppSection.tsx  window/tray prefs; renders nothing outside Tauri
  FileExplorer.tsx    file tree inside sidebar
  FileIcons.tsx       file icon helpers
  FileViewer.tsx      file content in a tab
  TabBar.tsx          tab bar (Chat + open file tabs)

hooks/
  useAgentSession.ts       messages, streaming, SSE, fork/navigate, reconciliation; built-in slash commands (/session, bare /mcp)
  useAudio.ts              completion sound + AudioContext unlock
  useDragDrop.ts           shared drag/drop state
  useIsMobile.ts           responsive breakpoint
  useScheduledTasks.ts     shared store + SSE for scheduled tasks
  useKeyboardShortcuts.ts  Esc stops the running agent unless a field or nearer handler took it; Ctrl+Alt+N
  useResizablePanel.ts     drag/keyboard panel size kept per key; persistClamp: false never saves a short window's clamp
  useTheme.ts              theme state
  useElapsedSince.ts       milliseconds since a timestamp, re-read every second; null on the first render so hydration matches
```

---

## Topic Notes

Read the doc for the area you touch before changing it. Upstream docs (no prefix) come from pi-web; `fork-*` docs hold this fork's notes and win where the two disagree.

- [sessions.md](docs/agents/sessions.md): AgentSession lifecycle and shutdown, fork vs in-session branching, the sidebar's on-disk Fork, session file rewrites, toolCall normalization, a run's message keys across the file read, SSE reconnect and tool events, a tool card's flat arguments as rows, transcript system / usage / context-edit entries, running-state polling, custom-message collapsing, streamed chunks re-rendering only the reply, streaming markdown block by block, hand-written anchors in rendered Markdown landing after the sanitizer's id prefix, Windows drive-letter Markdown links becoming `file:///` before sanitizing, user messages' raw HTML shown as text, ```svg fences previewed only as an `<img>`, display math's Copy button, long thinking rendered in pieces, a finished turn's duration, history caches (tool-result images, subagent runs, session views) and deferred code highlighting with Prism languages loaded on demand, a patch shown in one column or two, the session sidebar (toolbar row and its brand, project groups, their order and display names, pins, archive, new-session project adoption, the files below the sessions or in a tab), the project/worktree bar above a fresh composer (the header: brand, then the bar) and what it carries across the remount, exported HTML, the extension status bar and its `command:` buttons, extension UI colors (pi's palette theme, the page's light/dark ANSI palette), cache and cost notices (`showCacheMissNotices`), the read-only Debug panel (connections, server state, sessions the server holds). Files: `lib/rpc-manager.ts`, `lib/session-reader.ts`, `lib/session-fork*.ts`, `lib/session-delete.ts`, `lib/normalize.ts`, `lib/message-keys.ts`, `lib/session-tree.ts`, `lib/session-ui-state*.ts`, `lib/sidebar-prefs.ts`, `lib/sidebar-actions.ts`, `lib/session-links.ts`, `lib/favicon-badge.ts`, `lib/new-session-context.ts`, `hooks/useAgentSession.ts`, `hooks/useSessionUiState.ts`, `hooks/useSidebarMotion.ts`, `hooks/useGroupDrag.ts`, `hooks/useFilesPlacement.ts`, `hooks/useResizablePanel.ts`, `app/api/agent/**`, `app/api/sessions/**`, `components/SessionSidebar.tsx`, `components/PiWebTitle.tsx`, `components/SessionTree.tsx`, `components/SidebarMenu.tsx`, `components/SidebarToast.tsx`, `components/SidebarIcons.tsx`, `components/ProjectWorktreePicker.tsx`, `components/NewSessionContextBar.tsx`, `components/WorktreeCreateForm.tsx`, `handleNewSession`, `handleSelectSession` and the bar's handlers in `components/AppShell.tsx`, `components/BranchNavigator.tsx`, `components/MessageView.tsx`, `lib/message-display.ts`, `lib/patch.ts`, `components/FileViewer.tsx`, `components/MarkdownBody.tsx`, `lib/markdown.ts`, `lib/markdown-blocks.ts`, `lib/streaming-message.ts`, `hooks/useStreamingSelector.ts`, `lib/turn-duration.ts`, `components/MermaidBlock.tsx`, `components/SvgBlock.tsx`, `lib/highlight-queue.ts`, `lib/prism-languages.ts`, `hooks/usePrismLanguages.ts`, `lib/session-view-cache.ts`, `components/CodemodeToolView.tsx`, `components/ExtensionStatusBar.tsx`, `components/ExtensionWidgets.tsx`, `lib/extension-ui-theme.ts`, `components/AnsiText.tsx`, `lib/transcript-notices*.ts`, `components/TranscriptNotices.tsx`, `app/api/cache-miss-notices/**`, `lib/tool-fields.ts`, `lib/tool-execution-progress.ts`, `lib/ansi.ts`, `lib/debug-*.ts`, `lib/stream-client.ts`, `lib/page-stream-registry.ts`, `lib/page-debug.ts`, `lib/file-watch-registry.ts`, `components/DebugPanel.tsx`, `components/debug-panel-state.ts`.
- [tools.md](docs/agents/tools.md): tool presets and Chat only, exact system prompts, tool exposure, the codemode / tool-search / mcp built-ins, the read-only MCP policy, the Code mode and PowerShell `defaultTools` switches. Files: `lib/tool-presets.ts`, `lib/tool-preset-preference.ts`, `lib/chat-only.ts`, `lib/exact-system-prompt.ts`, `lib/builtin-extensions.ts`, `lib/mcp-read-only-policy.ts`, `lib/codemode-settings.ts`, `lib/powershell-settings.ts`, `lib/global-settings-file.ts`, `app/api/agent/new/route.ts`, `app/api/tools/settings/route.ts`, tool selection in `lib/rpc-manager.ts`.
- [mcp-runtime.md](docs/agents/mcp-runtime.md): the per-session MCP host (when servers register and connect, reported states, trust read on every sync, idle release); `/mcp` in the composer. Files: `lib/mcp-host.ts`, `lib/mcp-transport.ts`, `lib/mcp-status.ts`, `lib/mcp-command.ts`, `lib/mcp-config-key.ts`, MCP wiring in `lib/rpc-manager.ts` and `lib/builtin-extensions.ts`, `/mcp` handling in `hooks/useAgentSession.ts`.
- [mcp-settings.md](docs/agents/mcp-settings.md): Settings › MCP reads without running anything, masking, the trust dialog's server list, row states, notices, Code mode choice, trust from Settings, Escape stacking, every `mcp.json` write and undo. Files: `app/api/mcp/route.ts`, `app/api/project-trust/route.ts`, `lib/mcp-config-read.ts`, `lib/mcp-config-file.ts`, `lib/mcp-override.ts`, `lib/mcp-undo.ts`, `lib/mcp-secrets.ts`, `lib/mcp-server-display.ts`, `lib/mcp-json-error.ts`, `lib/project-trust.ts`, `lib/regular-file.ts`, `lib/stacked-dialog.ts`, `lib/settings-navigation.ts`, `components/McpConfig.tsx`, `components/mcp-config-helpers.ts`, `components/ProjectTrustDialog.tsx`, `components/SettingsPanel.tsx`.
- [mcp-test-sign-in.md](docs/agents/mcp-test-sign-in.md): Settings › MCP Test (route checks, bounded connection, `!command` queue, redaction, status store) and OAuth sign-in / sign-out. Files: `app/api/mcp/test/**`, `app/api/mcp/sign-in/**`, `lib/mcp-test.ts`, `lib/mcp-entry-request.ts`, `lib/mcp-status.ts`, `lib/mcp-sign-in.ts`, `lib/mcp-sign-out.ts`, `components/McpSignIn.tsx`, `components/mcp-sign-in-helpers.ts`, `components/OAuthPastePanel.tsx`.
- [mcp-add.md](docs/agents/mcp-add.md): Settings › MCP add (paste re-parsed on the server, host-variable confirmation, literal secrets kept global, fresh-folder trust, the add pane) and the paste importer's escaping and grammars. Files: `lib/mcp-add.ts`, `lib/mcp-import*.ts`, `lib/shell-words.ts`, fresh-folder trust in `lib/project-trust.ts`, `components/McpAddServer.tsx`, `components/mcp-add-helpers.ts`, the `add` action of `app/api/mcp/route.ts`.
- [models.md](docs/agents/models.md): default model and reasoning level, providers registered at session_start, mid-run reasoning changes, remote provider catalogs, `enabledModels` scoping and minimal edits, provider auth listing and credentials. Files: `app/api/models/**`, `app/api/models-config/**`, `app/api/auth/**`, `lib/default-preferences.ts`, `lib/model-scope.ts`, `lib/enabled-models*.ts`, `lib/model-catalog-refresh.ts`, `lib/deferred-provider-models.ts`, `lib/provider-listing*.ts`, `components/ModelsConfig.tsx`, `components/EnabledModelsSection.tsx`, `components/ModelSelector.tsx`, `components/SelectorRow.tsx`.
- [files-and-access.md](docs/agents/files-and-access.md): worktrees and project grouping, the file access allow-list (the `/api/files` security boundary), file tree visibility, the app's folder window (its places rail, filter, name/date order, hidden switch, keyboard), uploads and chat file drops, web password throttling. Files: `app/api/files/**`, `app/api/cwd/**`, `app/api/worktrees/**`, `app/api/file-index/**`, `app/api/web-auth/**`, `proxy.ts`, `lib/path-security.ts`, `lib/file-access.ts`, `lib/linked-directory.ts`, `lib/session-file-references*.ts`, `lib/file-tree-visibility.ts`, `lib/file-upload-client.ts`, `lib/worktree.ts`, `lib/paths.ts`, `lib/directory-browser.ts`, `lib/directory-places.ts`, `lib/auth-throttle.ts`, `components/ProjectWorktreePicker.tsx`, `components/DirectoryPicker.tsx`, `components/NewSessionContextBar.tsx`, `components/FileExplorer.tsx`, `hooks/useDragDrop.ts`.
- [settings-ui.md](docs/agents/settings-ui.md): Plugins and Skills routes, sidebar group switches, project-level skills (`.pi/skills`), the shared `SettingsUi` blocks every settings panel and add pane uses. Files: `app/api/plugins/**`, `app/api/skills/**`, `lib/project-skills.ts`, `lib/skill-roots.ts`, `lib/skill-shadowing.ts`, `components/SettingsUi.tsx`, `components/settings-ui-helpers.ts`, `components/SkillsConfig.tsx`, `components/PluginsConfig.tsx`; also before adding a settings section or add pane.
- [subagents.md](docs/agents/subagents.md): the built-in subagent setting, profiles and their files, run status, completion notifications, the report card that opens collapsed. Files: `lib/subagent*.ts`, `app/api/subagents/**`, `components/AgentsConfig.tsx`, `CustomMessageView` in `components/MessageView.tsx`.
- [scheduled-tasks.md](docs/agents/scheduled-tasks.md): scheduled tasks (the Scheduled page): server-side scheduler and its lease, catch-up and overlap rules, read-only default, the run index that hides runs from the project tree, why shared state is on `globalThis`. Files: `lib/scheduled-tasks/**`, `app/api/scheduled-tasks/**`, `instrumentation-node.ts`, `hooks/useScheduledTasks.ts`, `components/scheduled/**`, the Scheduled row in `components/SessionSidebar.tsx`, the page overlay in `components/AppShell.tsx`.
- [artifacts.md](docs/agents/artifacts.md): inline HTML/SVG/React previews and `:::artifact` blocks, output vs process files on the Artifacts page: what renders where, the sandbox rules and the desktop `about:srcdoc` allowance, the auto-run rule for scripted pages, the bundled React runtime (inlined, because sandboxed frames cannot reach localhost; `npm run preview-runtime` regenerates it), the fix flow and the prompt switch, the cross-session Artifacts page. Files: `lib/artifacts.ts`, `lib/artifact-store.ts`, `lib/artifact-index.ts`, `lib/file-output-role.ts`, `lib/artifact-file-roles.ts`, `lib/artifact-favorites.ts`, `components/artifacts/**`, `lib/html-preview.ts`, `lib/html-preview-stream.ts`, `lib/preview-theme-kit.ts`, `lib/artifact-settings.ts`, `lib/artifact-guide-extension.ts`, `hooks/useArtifactPublisher.ts`, `hooks/useHtmlPreviewFrame.ts`, `lib/preview-runtime.ts`, `scripts/build-preview-runtime.mjs`, `public/preview-runtime/`, `components/Artifact*.tsx`, `components/HtmlPreview*.tsx`, `components/artifact-tabs.ts`, `app/api/artifacts/**`, `is_inline_frame_document` in `src-tauri/src/lib.rs`.
- [remote-relay.md](docs/remote-relay.md): the end-to-end encrypted relay (Noise IK over a dumb relay, phone shell + tunnel service worker, pairing, request mark). Files: `lib/relay/**`, `relay/` (server, Docker), `relay-shell/` (`npm run relay:shell`), `app/api/relay/**`, `components/RelaySection.tsx`, `e2e/relay.mjs`; deploying: [remote-relay-deploy.md](docs/remote-relay-deploy.md). A request carrying the relay mark comes from a paired phone: it is never local (`isLocalRequest`), and local-only routes must ask `isLocalRequest()`, never a loopback Host.
- [client-platform.md](docs/agents/client-platform.md): mobile software keyboard and viewport height, the installed web app's notch and home indicator (`data-standalone-safe-area`), completion sound, the page's service worker in its two builds — production offline (the offline/unavailable fallback pages and their self-heal, the navigation budget) and development push-only (`?v=dev`, so a Home Screen phone can subscribe from `npm run dev`) —, the browser's connection budget and the streams shared across tabs, production `--keepAliveTimeout`. Files: `hooks/useViewportHeight.ts`, `hooks/useStandaloneSafeArea.ts`, the keyboard-open CSS, the installed-app inset block and the phone terminal's input field in `app/native-theme.css`, `public/sw.js`, `public/offline.html`, `public/unavailable.html`, `public/offline-recovery.js`, `components/PwaRegistration.tsx`, `bin/keep-alive.js`, `lib/file-watch-stream.ts`, `lib/file-watch-channel.ts`, `lib/running-sessions-stream.ts`, `lib/scheduled-tasks/shared-stream.ts`, `e2e/offline-navigation.mjs`.

Fork notes:
- [fork-sessions.md](docs/agents/fork-sessions.md): branch summaries, the not-yet-flushed new session, the SDK → wire → client event pipeline, the incremental session scanner, `useAgentSession` guards (request ids, load deadline, streaming seed, render-phase scroll save), compaction / retry / 0.86 events, `isRunning()` and `isIdle`, running-state propagation and reconciliation, session automation, the single-shot composer send, `!command` output, stats, transcript system messages, extension command session actions, the Process details collapse rule and a running turn's live tail, one Edited files card per turn with the live card above the composer, a long prompt's scroll box and its Expand, a file's diff as one session made it (`lib/session-file-diff.ts`), a run that ends on a tool call the model printed as text (`lib/unparsed-tool-call.ts`), and why an assistant reply's content list stays dense (`lib/assistant-content.ts`).
- [fork-models.md](docs/agents/fork-models.md): routed model, cost by model and cache warming, classifier and image models, the four thinking-level states, model defaults, remote provider catalogs (refresh only on request), `enabledModels` minimal edits and `resync`, auth and credential deletion.
- [fork-tools-subagents.md](docs/agents/fork-tools-subagents.md): new-session tool presets and Chat only, exact system prompts through `before_agent_start`, built-in subagents (setting, disabled built-ins, profile files, notifications).
- [fork-files-security.md](docs/agents/fork-files-security.md): security posture (web password, OAuth tokens, preview sandboxes), worktrees and branch switching, the file access allow-list, web password throttling, the one sentence a finished task is announced with (the server alone: `lib/task-completion-server.ts`, shared tag and windows: `lib/notification-tags.ts`, the title of a nameless session: `lib/session-prompt-title.ts`) and the phone pushes.
- [fork-desktop.md](docs/agents/fork-desktop.md): the Tauri shell (desktop token, native menus in Rust, file context menu, window state, tauri plugin version pairing), workspace terminals and node-pty / quickjs staging, Windows overwrite installs, and the payload credential scan that keeps `.pi/mcp.json` out of an installer.
- [fork-ui.md](docs/agents/fork-ui.md): who contains whom in the topbar / chat column / right panel, the header's `[folder] project  [branch|worktree] branch  [clock]  [subagents] ✓ ⚠ ↻` row (desktop and phone) with the worktree glyph's folder rule (the checkout is a linked worktree, `isWorktree` — not a name match against the branch) and the chips' hover lift, the Agents panel as an `.app-menu` card (rounded, shadowed, its layer never scrolls) placed under the count it opens from and centred under the header on a phone (`lib/top-panel-placement.ts`), the composer's branch chip (the name is the switch; worktree from a branch; the second row when the width runs out), the composer's ink alignment and the running-status line's clearance, the composer's per-device copies (one read-only row per other device, docked above the composer; no device edits another's draft), the composer's three menus (Reasoning, Config, session automation) taking an explicit width and opening inside the conversation column, never under the sidebar (`lib/composer-panel-placement.ts`), the right panel opening on a terminal, the settings dialog tabs, touch affordances, completion sound, plugins and skills.
- [fork-chat-workspace.md](docs/agents/fork-chat-workspace.md): the non-project Chats section, the hidden `chat-workspace` cwd and `workspaceKind` identity, project-workbench suppression, and the server-enforced chat policy (skills and MCP yes; no file, shell or other extension tools; no context files), text attachments, and continuing a chat in a project.

### AgentSession lifecycle (`lib/rpc-manager.ts`)
- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions`
- `globalThis` survives Next.js hot-reload; plain module-level Map does not
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)

### Hard rules
Each one undid a real regression; the linked note has the reasoning.
- Never stage a file the task did not touch; never push `main`.
  Section 6 of the notes above is the rule: commit the verified
  work and `git push -u origin <branch>` after every pass.
- An assistant reply's content list stays dense. The chat walks it with `for…of`/`.some`/spread, which do not skip holes, so one empty slot throws `undefined is not an object (evaluating 'block.type')`. `normalizeToolCalls` fills every message entering client state and `updateContentBlock` keeps the streaming entry dense; the collectors guard with `fillContentGaps` (`lib/assistant-content.ts`). Never write `content[i] =` on a reply and never iterate raw content in a new consumer. ([fork-sessions](docs/agents/fork-sessions.md))
- `AgentSessionWrapper.isRunning()` ORs in `inner.isIdle === false`; dropping it evicts wrappers mid-retry. ([fork-sessions](docs/agents/fork-sessions.md))
- Never assign `agent.state.systemPrompt` (a getter since pi 0.86). Exact prompts go only through `lib/exact-system-prompt.ts`; do not add a second path. ([fork-tools-subagents](docs/agents/fork-tools-subagents.md))
- `useAgentSession`: keep the monotonic request ids, `fetchWithRetry` for the session load, `seedStreamingSnapshot()`, the render-phase scroll save, and the `sessionHookMountedRef` re-assert before `maintainEventsConnected()`. ([fork-sessions](docs/agents/fork-sessions.md))
- The composer sends exactly one `onSend` per submit; a second raw send restores the text into the box. ([fork-sessions](docs/agents/fork-sessions.md))
- Do not re-add the legacy `auto_compaction_*` event cases or a manual DeepSeek xhigh clamp. ([fork-sessions](docs/agents/fork-sessions.md))
- `enabledModels`: never compare patterns as strings, never assume `provider/*` covers a provider, never rebuild the list from `getAvailable()`; every toggle is a minimal edit and only `resync` repairs entries. ([fork-models](docs/agents/fork-models.md))
- Provider catalogs refresh over the network only when the user presses "Refresh catalog". ([fork-models](docs/agents/fork-models.md))
- Credential deletes go through `removeStoredCredentialIfType()`, and both provider lists refresh after any auth change. ([fork-models](docs/agents/fork-models.md))
- Built-in subagent profiles are switched off by name in `disabledBuiltIns`, never copied out to a `.md`; keep `SUBAGENT_NOTIFICATION_PREFIX` in code. ([fork-tools-subagents](docs/agents/fork-tools-subagents.md))
- Never give one iframe both `allow-scripts` and `allow-same-origin`; keep `SERVE_EXT_TO_MIME` in `getServeMime`. ([fork-files-security](docs/agents/fork-files-security.md))
- Manual-code OAuth handshake tokens are `crypto.randomUUID()`. The auth throttle stays global, and its reset window stays longer than the max delay. ([fork-files-security](docs/agents/fork-files-security.md))
- No literal `homedir()` in session-scanner fs calls; use `userHome()`. ([fork-sessions](docs/agents/fork-sessions.md))
- Native-dialog routes (`/api/desktop/*`, `?type=import`) require the per-process desktop token; never a static token or User-Agent check. `read-images` derives its cap from `MAX_ATTACHED_IMAGES`. ([fork-desktop](docs/agents/fork-desktop.md))
- Open local paths with `explorer.exe` on Windows, never `cmd.exe /C start`. ([fork-desktop](docs/agents/fork-desktop.md))
- Native popup menus are built in Rust (`show_popup_menu`); do not go back to the JS `Menu` API. ([fork-desktop](docs/agents/fork-desktop.md))
- `tauri-plugin-*` crates and `@tauri-apps/plugin-*` packages stay on the same minor; fix drift in `Cargo.lock`, never by pinning npm down. ([fork-desktop](docs/agents/fork-desktop.md))
- Window state flags are `SIZE | POSITION | MAXIMIZED`; never `VISIBLE` or `DECORATIONS`. ([fork-desktop](docs/agents/fork-desktop.md))
- After an SDK bump run `npm run desktop:prepare && npm run desktop:verify`; never hard-code a nested staging destination; keep all three Windows `node_modules` guards. ([fork-desktop](docs/agents/fork-desktop.md))
- The staged payload must carry no `.pi/`, no `Bearer ak_`, no armoured private key and no `src-tauri/target` leftover: `outputFileTracingExcludes` is inert on Windows, so the load-bearing defence is the pre-trace cleanup plus the throwing scan in `scripts/prepare-desktop.mjs` (`scripts/packaged-payload.mjs`). ([fork-desktop](docs/agents/fork-desktop.md))
- Layout: the center column contains topbar and chat; the right-panel block is a full-height sibling inside the outer row; no `paddingLeft: sidebarResizer.width` on the topbar. Pinned by `AppShell.right-panel-row.test.mjs`. ([fork-ui](docs/agents/fork-ui.md))
- A composer menu gets an explicit width from `lib/composer-panel-placement.ts` and is placed inside the conversation column. Never let one be shrink-to-fit on its 32px anchor (it collapses to its `minWidth` and cuts its own rows), and never clamp it to the window: 16px from the window's left edge is inside the sidebar, whose column clips the menu and paints above it (`.app-main-column` is `overflow: hidden`, the sidebar's z-index is 200, the menus' is 100). Pinned by `lib/composer-panel-placement.test.mjs`. ([fork-ui](docs/agents/fork-ui.md))
- `SettingsPanel` keeps the `onBusyChange` guard so a desktop update cannot be dismissed mid-install. ([fork-ui](docs/agents/fork-ui.md))
- Chats own a server-created folder under the chat root (a new chat is requested with the root, never a path built in the browser); `workspaceKind` / `chatFolder` come from the server, and chats stay out of project trust / worktrees / project files / terminals / the right panel. Server policy keeps a chat off the shell, with file tools confined to its folder, `read` also opening skills and files the user named in their own message (read-only), MCP tools limited to those their server marks read-only, no extension tool the user has not allowed, and context-file-free, even for persisted sessions. Only the per-chat unlock (`pi-web:chat-unlock`, never on a network-exposed server) lifts that. Legacy chats (the old shared `chat-workspace` cwd) keep their old policy. ([fork-chat-workspace](docs/agents/fork-chat-workspace.md))
- The worker's `?v=` picks its build (`components/PwaRegistration.tsx`, `OFFLINE_MODE` in `public/sw.js`): production is the offline build, development registers the same script as `?v=dev` for **push only** — it precaches nothing, answers no request, and deletes every `pi-web-*` cache on activate. A dev page on the offline build pins the previous build's chunks; a phone with no registration at all cannot turn "Notify this device" on. ([client-platform](docs/agents/client-platform.md))
- A production navigation is answered by the server, never by a cached document. A refused connection is `offline.html` at once; a server that accepts and stays silent is `unavailable.html` after `NAVIGATION_TIMEOUT_MS` (15 s) — the two cases are different news, and a page that says "offline" must be true. Both pages carry `public/offline-recovery.js` (probe `/api/home`, self-reload, the `localStorage` reload budget); production entries pass `--keepAliveTimeout 65000` (`bin/keep-alive.js`) because Next's 5 s default is shorter than a browser's socket reuse. A stream every tab wants goes through `openSharedEventStream[Handle]()` with a `pi-web:*` name (one leader per browser; the file watchers fan into `?type=watch-all`); a stream whose handlers must run per tab (an open session, a terminal panel) opens its own and says so. ([client-platform](docs/agents/client-platform.md))

---

### Two kinds of branching — don't confuse them
- **Fork** (Fork button on user message): creates a new independent `.jsonl` file (`parentSession` header field). In the sidebar it is a row of its own beside its source, marked with the fork glyph; only subagent runs and side chats nest under a row, folded by default (`lib/sidebar-session-nodes.ts`, `lib/sidebar-subagent-expansion.ts`, #237).
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching between them calls `/api/sessions/[id]/context?leafId=`.

### Upstream merge sentinels (not the same "fork" as session fork)
This repo is a fork of `agegr/pi-web` and periodically merges upstream. `components/fork-extractions.test.mjs` guards the failure mode that a clean merge can still be wrong: code this fork *moved* to another file reappears at its origin, or a fork change is silently reverted. Git does not track cross-file moves, so neither shows up in `tsc`, eslint, or the upstream suite.

When one of those assertions fails, the default is to restore the behaviour, not to delete the assertion. A failure saying a marker is "absent from the origin but also from the extraction targets — it looks deleted, not moved" means the feature is probably gone: that is exactly how the project-picker filter box was found missing after a restyle had left every project past the 7-row cap unreachable. Risk levels live in `scripts/fork-ownership.json`; the reasoning is in `docs/ownership-boundaries.md`.

The third direction is `forbiddenMarkers` on a `FORK_FEATURES` entry: a region the *fork* deleted that upstream still ships. A clean merge re-adds it silently, so the entry asserts those strings stay absent from the file (currently the new-session branding header in `components/ChatWindow.tsx`). A failure there means "put the removal back", never "drop the marker".

### Upstream merge decisions (standing rules)
Full per-merge reasoning (segments E, F, G, with what was adopted and what was declined) is in [merge-history.md](docs/merge-history.md). The rules that still bind a future merge:
- **Upstream owns SDK adaptation.** Exact system prompts go through `lib/exact-system-prompt.ts` (`before_agent_start`); the session list comes from `lib/session-list-scanner.ts`; MCP and Code mode run on ADR 0006's `builtin:*` extensions (`createMcpExtension()` is never passed as a bare inline factory) and `resolveActiveToolNames()` replaced `withExtensionTools()`. Do not re-add a second path for any of these.
- **Declined upstream UI stays declined**: the sidebar explorer and resizable session/explorer panes (`data-resize-handle="sidebar-sections"`), `DirectoryPicker`, `SessionSearch`, `ChatMinimap`, `getSessionListIndices` windowing, the second mobile toolbar group, the topbar models/skills/settings quick-buttons, `ExtensionStatusBar` (the fork's `ExtensionStatusLine` replaces it). A merge that brings one back is re-introducing declined UI, not a test to satisfy.
- **Fork layers that must survive a merge**: `userHome()` routing instead of literal `homedir()`, models-config literal-key redaction, `resolveSessionReferences` in the send/queue paths, the monotonic request-id guards in `useAgentSession`, the project-tree sidebar with the full-height layout, desktop i18n and Settings sections.
- **`lib/startup-preferences.ts` stays deleted** (new-session model picks are session-scoped); `PUT /api/models/default` is the only writer of global defaults.
- **`package-lock.json` keeps the tauri plugin versions pinned to `src-tauri/Cargo.lock`**: restore HEAD's lock before `npm install --package-lock-only`, or the carets re-resolve and `release-workflows.test.mjs` fails.
- After a merge: `node scripts/upstream-css-baseline.mjs update <upstream-ref>` and `npm run drift`.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`SessionContext.entryIds[]` parallels `messages[]`: each displayed message's `.jsonl` entry id, used for fork and navigate_tree.

## Styling: fork CSS lives only in `app/native-theme.css`

**UI consistency is mandatory (user requirement).** Every application menu, dropdown,
option picker and autocomplete popup must use the shared `.app-menu` surface and menu
tokens in `app/native-theme.css`. Form choices use `components/AppSelect.tsx`; do not
introduce raw `<select>` controls or OS-native application option menus. Preserve the
same palette, nested radii, inset, row spacing, selected/disabled states and focus
treatment in both themes. Use the existing design as the reference, consult the
sources in `docs/ui-menu-audit.md`, and inspect actual rendered states at desktop and
narrow widths before claiming visual consistency. System file/directory dialogs are
separate OS tasks. Run `node --test scripts/ui-menu-consistency.test.mjs` after menu work;
changes to shared choices also run `node e2e/option-controls.mjs`.

`app/globals.css` and `app/settings.css` are pi-web's and stay byte-identical to upstream — `scripts/upstream-css-baseline.test.mjs` fails on any edit. Put every fork rule in `app/native-theme.css` (imported last in `app/layout.tsx`); overrides of upstream rules that other theme rules must beat go in its "fork base layer" at the top. After an upstream merge run `node scripts/upstream-css-baseline.mjs update <upstream-ref>` (the sync workflow does). Layout of the theme file and the design intent to restore after a merge: `docs/native-theme.md`.

## CSS Variables (`app/globals.css`, re-tokened in `app/native-theme.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


