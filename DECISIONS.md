## The write API refuses project-local secrets, not only the home-folder ones

`lib/credential-paths.ts` is anchored at the home folders, which is right for the
read side (`~/.ssh`, `~/.aws`, `.pi/agent/auth.json`). A project checkout can
carry the same names inside itself — a vendored `.ssh`, a deploy key, a
repository's own `.git/hooks`. Writes are policed structurally in
`lib/file-write.ts`: the secret directory names, the named credential files,
`*.pem`/`*.p12`/`*.key`, and any `.git` segment (a hook runs as the user, so
writing one is running code). `.env` stays writable: in a project it is
configuration the user edits, not a credential store.

## A save is refused when the file moved on disk, and the refusal is a name

The panel edits files the agent is also writing. `PUT /api/files/[...path]`
takes the `mtime` the editor read the file at and refuses with `CONFLICT` when
the disk time differs; the client shows Reload, and "Save over it" only when the
user asks for that (the route marks the response `overwritten`). The watcher
never replaces a dirty buffer, and a file that disappeared is `NOT_FOUND`, not
silently recreated. Codes, not prose, drive the save bar.

## The editor is Ayu Monokai; the read view keeps the theme-following palette

The generated `lib/editor/ayu-monokai.ts` is the editor's palette, from the
vendored theme file. The read view (`SyntaxHighlighter` with `calmCodeTheme`)
keeps painting from `--code-accent`/`--code-warm`/`--code-comment`, because that
palette follows the app's light/dark switch; pinning it to Monokai's dark canvas
would put a dark-only palette on a light theme. The editor is a deliberate dark
surface, so it can carry the generated one.

## The graph's lane colours are CSS variables, not literals in the component

`scripts/inline-style-tokens.test.mjs` keeps literal sizes, weights and hex
colours out of `components/**`. The Log graph needs eight distinguishable hues,
which the app's tokens do not provide, so they are `--git-lane-1…8` on
`.git-panel` in `app/native-theme.css` (with a `:root.dark` set) and the SVG
strokes reference them. One palette, in the fork's stylesheet, per both themes.

# DECISIONS

## The Branchshift Git panel and the editable file panel (this branch)

- **The Git panel is a port, not a rewrite.** `src/git/**` in Branchshift has no
  `vscode` imports, so `lib/git/**` is a copy (via `scripts/port-branchshift.mjs`)
  and its mocha suites came with it (`scripts/port-branchshift-tests.mjs`). A
  rewrite of 5.2k lines of git handling would have thrown away the parsing, the
  index transaction behind partial commits, the worktree path handling and the
  tests that cover them.
- **The command surface stays Branchshift's, behind one route.** The webview
  posted `{command, params, repoId}` to the extension host; the panel posts the
  same envelope to `POST /api/git/execute`. `lib/git/commands.ts` is a closed
  table — no command takes a shell string, an argv array, or a repository path —
  so the panel keeps its 70 commands without becoming a remote shell.
- **The repository is derived from an authorized cwd, never from the browser.**
  `lib/git/workspace.ts` discovers the checkout that owns the cwd, its sibling
  worktrees, and the checkouts nested inside it; a `repoId` is honoured only when
  discovery reached it. Worktrees matter here: pi-desk's projects *are* worktrees,
  and a worktree has its own index, HEAD and `gitDir` — an operation must run
  against the selected checkout, so each worktree is its own repository entry.
- **Two panels, one live signal.** The file tree keeps its cwd-scoped status
  projection (`lib/git-changes.ts`, which the explorer's dots and the
  changed-files group need) and the Git panel reads the full repository state
  from `lib/git`; both refresh from the same SSE stream, so a terminal commit
  moves both. Keeping one implementation for both would have made the explorer's
  tolerant, cwd-filtered view strict and repository-wide.
- **Branchshift's CSS variables are mapped, not copied.** The ported components
  read `--vscode-*` variables. `.git-panel` in `app/native-theme.css` defines
  those from pi-desk's own tokens, so the panel themes with the app, the fork
  keeps its "fork CSS lives only in native-theme.css" rule, and no second colour
  palette is invented.
- **The three-way merge editor is the one declined piece.** The sidebar has no
  width for three columns; Accept Yours / Theirs, the conflict list,
  base/ours/theirs contents, and merge/rebase continue-skip-abort are all there,
  and the file panel's editor is where a hunk gets resolved by hand.
- **CONTRIBUTING.md's out-of-scope list declines Git clients and file editing for
  upstream pi-web.** This fork wants both — the request is explicit — so they are
  built here, kept inside pi-desk's existing security posture (allowed roots, the
  desktop token, the web password), and recorded as a deliberate fork divergence.
- **The editor engine is chosen by measurement, not preference.** Both CodeMirror 6
  and Monaco standalone were installed and driven in the app (bundle size, theme
  fidelity, completion work). The one that wins is the one that gets the Ayu
  Monokai theme with the least duplicated palette and gives Tab-accept word
  completion without a completion framework.
- **A plain-text surface strips ANSI; it never renders it.** The running-tool status line
  ("Running bash… <progress>") and a tool card's result pane run a command's streamed
  output through `stripAnsi` (`lib/ansi.ts`) — the fork's existing rule for extension
  dialogs, notices, a folded panel's summary and the page title. Colourising the card with
  `AnsiText` was declined: that pane is deliberately muted plain text the user selects and
  copies, the palette belongs to the terminal theme, and the interactive bash pane
  (`components/ChatWindow.tsx`) is already the place that paints colours.
- **The worktree glyph is a fact about the folder, not about a name match.** The header's
  project chip, the composer's project chip and the branch list's current row show
  `WorktreeIcon` when the checkout the session works in is a **linked** worktree
  (`ProjectInfo.isWorktree` / `SessionInfo.isWorktree`), and the project folder on the main
  checkout and in a plain folder. The rule used to be
  `isWorktree && branchOwnsWorktreeFolder(path, branch)` — is this folder the
  `<repo>-worktrees/<branch>` the app made for the branch we are on — so that a linked folder
  switched to an ordinary branch read as a plain folder. The user's `main-bak` inside
  `auto-toc-worktrees/main-bak3-test-wt` then wore the folder glyph in all three places, and
  the user called it wrong: the folder is a worktree, the branch chip beside it already names
  the branch, and a folder is what a session touches. `lib/worktree-folder.ts` stays as the
  naming rule the new-worktree form shows while typing; no glyph asks it
  (`components/AppShell.worktree-project.test.mjs`, `components/ProjectContextMenu.test.mjs`,
  `e2e/branch-menu-filter.mjs`).

- **Tests never spawn OS processes.** `app/api/cwd/pick` and `app/api/notifications/local` are tested through their gates (non-local → 403, empty body → 400, GET capability probe); `osascript`/`tailscale` invocation is verified by source sentinels, not by running the CLI.
- **Tests follow the fork's own style**: pure-function tests plus source-regex sentinels (`components/*.test.mjs`), because the fork's guards are already source-based and upstream CSS/JSX files must stay mergeable.
- **`formatDurationHms` is unpadded** (`0h18m13s`, `0h0m9s`) — matches the user's example and the answer to the "9-second run" question. The clock stays zero-padded `hh:mm:ss`.
- **Local notification is server-side `osascript`** (not Safari Web Push): the user does not use Safari's Add-to-Dock web app, and a plain Safari tab has no system-notification API. Attributed to the process that owns the server; the settings row says so.
- **Tailscale Serve stays fire-and-forget** in `registerNodeInstrumentation()` (Next's `Ready` line gates the browser opener), macOS-only, `PI_WEB_DISABLE_TAILSCALE_SERVE=1` off switch, set in the e2e env.
- **ntfy config lives server-side** (a settings file, like the other `lib/*-settings.ts`), not localStorage, because the topic is a property of the Pi installation and the completion sender is the browser: any device that opens Pi must publish to the same topic.

---

# Phase C2 decisions (2026-11-22)

- **A native pick answers with a status, not a path.** `picked` / `cancelled` /
  `unavailable`. A dismissed Finder panel is a decision the user made and ends the flow;
  only a server that cannot show a panel (non-macOS, remote page, Finder failure) is a
  reason to open the in-app typed picker. Returning `null` for both made Cancel open a
  panel over the chat.
- **HTTP header values go through `ntfyHeaderValue()`.** A header is a ByteString: one byte
  per character. `fetch` throws for an em dash (index 17 of `Pi Agent Desktop — test`)
  before the request leaves. The rule is UTF-8 bytes carried as latin-1 characters, which
  is what ntfy decodes; trimming goes by characters so a long CJK title cannot split a
  byte. The message body needs none of this.
- **A sidebar fold animates the element's height, measured in JS.** `clip-path`/`opacity`
  paint without changing layout, and an `auto` height is not transitionable everywhere
  (`interpolate-size` is opt-in and newer than the target Safari). The JS measures
  `offsetHeight`/`scrollHeight`, writes a pixel start in the first commit and the end on
  the next frame, and unmounts closing rows on `transitionend` (with a safety timer). The
  siblings below then move continuously, which is the whole requirement.
- **The fold's animation state lives on the element (`data-fold-applied`).** React state
  would unmount the element mid-transition on a rapid click; a WeakMap of active listeners
  lets a new click replace the transition from the height reached.
- **`useProjectFold().opening` is computed during render.** An element's `ref` runs before
  any effect, so an effect-computed "just opened" is classified as a page load and the
  opening never plays (measured in the browser test, while collapsing worked).
- **`e2e/sidebar-fold.mjs` measures the fold in frames, not screenshots.** The complaint
  was geometric (where the rows below are, frame by frame), so the test samples
  `getBoundingClientRect().top` of the group below every frame and asserts the movement
  starts in the first frames, is spread across frames, and equals the content height.

---

# Phase C3 decisions (2026-11-22)

- **The reference is the composer's Add files panel.** A folder pick cannot be a web
  control (no `showDirectoryPicker()` in Safari, and a directory input yields no absolute
  path), so the native panel stays and is made to behave like the browser's own: it is
  there at once, it is the key window, and focus returns by itself.
- **Show the panel from System Events and activate it.** Finder's panel activates Finder
  (Dock bounce, desktop forward). A panel issued by osascript is owned by a background-only
  process and is not the key window, so the keyboard stays in the old app. System Events
  has no Dock icon, and activating it makes the panel key — measured, both ways.
- **Capture the frontmost app and restore it on both exits.** The capture and the write
  need the Accessibility permission, so both sit in `try` blocks: without the permission
  the panel works, without the hand-back.
- **The default location goes before the prompt.** `with prompt "x" of (loc)` compiles as
  possession of the string (-1723). Measured, and pinned by a test.
- **The panel opens in the folder that holds the current project.** The browser's hint is
  used only if it resolves to a real directory, and the answer is always the panel's own
  path — the hint is a location, not an input to the result.
- **The button carries the panel's progress.** The click's work is a native window, not a
  page transition, so the icon spins, the button is disabled and `aria-busy`, and the title
  says where the panel is. One panel per click.

## Phase C4 — the folder window is the app's own
- **A web page cannot retitle the browser's file panel, so it is not the folder chooser.**
  `<input type="file" webkitdirectory>` answers with the files inside the folder (no absolute
  path) and macOS titles its panel "Choose Files to Upload" with files selectable. Measured in
  Safari, with the user's screenshot.
- **Reuse the window the app already has.** `DirectoryPicker` (portal, backdrop, panel, folders
  only, path field) is the app's folder browser; "Add project" opens it with a `title` prop. The
  title is additive, so the project picker keeps its own heading, and the shared window keeps
  one implementation.
- **The animation belongs to CSS, the timer to the component, and the two must agree.**
  `DIRECTORY_PICKER_CLOSE_MS` equals `--dur-base`; a shorter timer cuts the fade, a longer one
  leaves a dead click. Pinned by a test that parses both files.
- **One dismissal path.** Backdrop, Escape, × and Cancel call `requestClose`; a bare `onCancel`
  in a handler is the bug where the window disappears between two paints.
- **A choice is not a dismissal.** Selecting a folder reports at once: the project appears in the
  tree immediately, and a fade would only delay it.
- **The window's path is a candidate, and a refusal stays in the window.** `/api/cwd/validate`
  decides (permissions, the allow-list); showing its message inside the window means the fix is
  one click up the tree, not a toast over the chat.
- **No native panel, so no per-panel ceremony.** The panel lock, the front-app capture, the focus
  hand-back and the Accessibility dependency are gone with the panel; the button only shows the
  validation (`sidebar.checkingFolder`).

## Phase D (five tasks on the running chat)
- **The "Edited files" diff comes from the session, not from git.** The card counts what the
  session's `write` / `edit` / `apply_patch` calls changed, and a change the agent committed has
  no git diff at all: the row opened a file with no diff. The session's own records are the only
  source that always describes *that* change, so `lib/session-file-diff.ts` rebuilds the hunks
  from them.
- **One file header, one hunk per recorded call.** The patch is a reading aid, not a patch to
  apply: hunks the tools reported verbatim keep their `@@` lines, and a synthesized hunk says
  `@@ session change +N @@` rather than pretending to a byte-exact index. Two edits of one file
  stack under a single header, so the diff reads as the file's change, not as two tool calls.
- **The session's record wins when both exist, with a switch to the working tree.** The card's
  number is the thing the user clicked on, so it is what opens; the toolbar offers
  **Working-tree changes** because the working tree is often further along (the user edited too).
- **A project skill is a link to the global folder, with a copy as fallback.** A link keeps
  `skills.sh` updates in one place and is what pi already does for global skills; a junction on
  Windows needs no developer mode, and a plain copy covers a filesystem that refuses links. The
  mode is answered, not promised.
- **The request names a skill, never a path.** `/api/skills/project` resolves the source from the
  skills this project already loads and fixes the target to `<cwd>/.pi/skills/<name>`; a browser
  that names a path cannot make the app copy `~/.ssh` into a project.
- **Removal deletes one top-level entry of the project's skills folder, and nothing above it.**
  Removing a linked entry removes the link, so the global skill survives — checked in a test that
  reads the global `SKILL.md` after the removal.
- **Eight tail blocks is a named constant, and a compaction card is one of them.** The running
  turn's newest work stays readable as it arrives; the number is a knob, not a magic value in the
  loop, and counting the compaction card keeps the rule "the last eight blocks are themselves".
- **Process details never open themselves.** Every call site passes `defaultExpanded={false}`.
  Opening used to be automatic for an unanswered turn, and a session opened on a finished turn
  showed its whole process. A search jump (`reveal`) counts as a click, so a search still lands.
- **One Edited files card per turn.** While the turn runs, the composer-adjacent live card is the
  list and the reply carries none; when the turn ends, the live card is gone and the turn's own
  card is there. Two lists of the same files, one of them stale, is the failure this avoids.
- **Expand lifts the bubble's cap through the parent, because the bubble owns the cap.**
  `USER_BUBBLE_MAX_HEIGHT` lives on the bubble; a scroll box inside a capped, `overflow: visible`
  bubble cannot grow. So `CollapsibleUserText` reports its state (`onExpandedChange`) and the
  bubble drops both its cap and its scroll.

## Project-level skills: a copy, not a link (Phase E)
- The user toggles the global skill and the project skill as two rows. A link makes them one file, so
  a project flip rewrote the global skill's frontmatter and re-enabled it in every other project, and
  pi's one-name loader showed only one of the two rows. A copy keeps the states independent.
- Turning a skill **off in one project** also needs a copy: pi keeps one skill per name, so the only
  per-project state is a project file. Writing the global file is a global change, not a project one.
- `addShadowedSkills()` puts the file pi's loader hid back on the panel's list and records
  `skillCollision.winner`, because the panel must not hide a switch it is offering.
- The supplement reads the folders with pi's own `loadSkillsFromDir` and dedupes by real path: a
  project link to a global folder stays one row, and the twin's parsing, name rules and frontmatter
  state come from pi, not from a second reader.
- An untrusted project's own skills are neither loaded nor put back on the list — trust decides what
  loads, so it decides what the panel may show and toggle.
- **Known limit, stated in the UI:** which file a session runs is pi's loader's choice (global folder
  first, then project, first name wins). For a skill from `~/.agents/skills` (skills.sh) the project
  copy wins in its own project, so per-project on/off is real; for a skill in `~/.pi/agent/skills` the
  global entry wins and the project copy is listed for its switch while sessions follow the global.
  The row's note names the winner either way.
- **A project skill left as a link is migrated, not kept.** The listing shows the global file beside
  it (`skillCollision.linkedToGlobal`) and the note says the switches share one file; the next
  on/off in this project replaces the link with a copy, so the state stops being shared. `isLinkedSkillEntry()`
  treats symlinks and Windows junctions alike.
- **A row put back is a global row.** The supplement's twin is read with pi's `user` source, because
  the sidebar groups are built from pi's scope and any other source label puts the row under a PATH
  heading. The skills.sh badge is the install lock's business, not the reader's.

## The folder window, not the OS panel (Phase F)
- **No web API can answer "which folder?" with a path**, so the app keeps its own folder window. A
  browser's file input answers with file contents and nothing else, `webkitdirectory` reports the
  files inside and no absolute path, macOS titles that panel "Choose Files to Upload" and a page
  cannot retitle it, Chrome's `showDirectoryPicker` gives a handle whose most identifying property
  is the folder's name and Safari does not ship it, and a pi session needs a real cwd on the server.
- **The rail is read from the server, and says what it cannot open.** Home, Documents, Desktop and
  Downloads are probed (`realpath`, `access(R_OK|X_OK)`), because macOS TCC denies those to the
  process; a row that opens on a refusal is worse than one visibly off. The UI names the places by id
  in the app's language, never by path.
- **Pinned and recent folders live in the browser, and are re-probed on every open.** One server can
  be reached from several machines; a favourite is a fact about the person's folder, not the
  session's. The route answers the caller's paths with `exists`/`readable` only, deduped and capped
  at 32, so a remembered folder that is gone is shown as gone and no request reads an unbounded list.
- **The window's commit point stays one.** Recording a taken folder happens in the same click as
  `onSelect`; the parent still validates the path through `/api/cwd/validate`. The window never
  adopts a folder on its own authority.
- **The native panel in Safari is possible only through the desktop app, and that is not the chosen
  path.** When the desktop app runs on the same machine as the browser it can show the macOS dialog
  and hand the path to the tab over the local API (the desktop-token pattern the native dialogs use);
  with no app running there is nothing to ask, so the in-app window has to be good anyway. The user
  chose the window; the desktop-assisted pick stays an option.

## The server announces, the page decorates (notification reliability)
- **The process that owns the run is the only sender that can be relied on.** ntfy and the
  macOS row were a page's job, so a task started from a phone, a queued prompt, a run that
  settles while the tab is closed, discarded, or suspended on iOS announced nothing on
  those channels. `lib/task-completion-server.ts` sends the push, the ntfy message and the
  Notification Center row from `onAgentRunComplete`, which already holds the run's span,
  name and outcome. The page keeps the one channel no server can raise: its own banner.
- **A notification is news for minutes.** The web-push TTL was 4 weeks (RFC 8030 asks a
  push service to store a message for at least its TTL while the subscriber is away, and to
  deliver the stored pile when it returns). A phone that was off, offline, or in a Focus
  mode for a day woke to a stack of stale completions whose own body said when they
  popped up. TTL is 5 minutes; a push that still lands late is shown silent and collapsed
  under one catch-up tag, because iOS revokes a subscription whose push is handled without
  a notification.
- **One tag, built in one place.** The page tagged `pi-task-complete:` and the payload
  tagged `pi-session-complete:`, so the worker's 10-second same-tag rule (#1515) never
  matched and a finished task showed twice. `lib/notification-tags.ts` is the single
  source; the worker repeats the literals and a test fails when they drift.
- **A switch belongs to the machine that acts.** The banner is a browser's (localStorage,
  plus that browser's permission); the Notification Center row needs no browser at all, so
  it is an installation setting in Pi Web's settings file, on by default, writable only
  from a local page. A phone's localStorage must not decide what the Mac shows.
- **Silence has a cost, and so does noise.** A run with no span is announced with the short
  "Task finished." rather than dropped — the server knows it ended, and "no notification at
  all" was the complaint. A run this process is catching up on, and a run the user stopped,
  stay silent; a dialog pushes once per dialog and at most once per session per ten
  minutes, because the MCP trust prompts at session start are the buzzes people hear with
  nothing running.
- **A run's end is `agent_settled`, and a run in the middle of a streak is still news.**
  The completion announce used to be gated on "the session is idle and its composer outbox
  is empty", which is not the end of a run: with several tasks queued in a row, the runs
  that finished first announced nothing on any channel (push, ntfy, the Mac's row) and only
  the streak's last run was announced, and a run that settled into an auto-compaction or a
  steering message waited for the whole post-run pipeline. `lib/rpc-manager.ts` now pairs
  `agent_start` with `agent_settled` (`agentRunNeedsCompletion` / `agentRunSettled`) and
  announces on the settle, clearing the span so the next run reports its own.
  `isRunning()` is the wrong question there: a `steer` settles its prompt promise in the
  middle of the run that is streaming, so announcing on that path announces an answer that
  has not arrived (the tests: "a steering prompt that settles mid-run announces nothing",
  "a finished task announces while the next queued task is still waiting"). The subagent
  rule is untouched — a run that leaves subagents at work is still silent (#1434), and a
  report's own run is still skipped by its mark.

## Selective pi-web backport (#1730, #1731, #1739, #1742, pi 1.6.0)
- **A PR is not one thing, and a fork without the half is not a failed port.**
  #1730's payload is client batching in `lib/agent-switcher.ts` /
  `components/AgentStatusBar.tsx`; this fork has neither, so the port is the lib
  half (`MAX_SESSION_STATS_IDS` out of the route and into `lib/session-stats.ts`,
  where a caller can batch by it) plus the cap tests, and the client half is
  recorded as N/A rather than invented. Inventing an agent switcher to host
  upstream's caller would be the fork adopting upstream's UI, which the merge
  rules already decline.
- **A steered report stays a custom message.** Upstream delivers the report
  through its `subagent-ui.ts` into `AgentStatusBar`; the fork's surface is the
  report card that renders a `pi-web:subagent-notification` message. The fork's
  `sendCustomMessage(message, { deliverAs, triggerTurn })` takes the same custom
  payload with `deliverAs: "steer"`, so the delivery channel changes and the
  rendering does not, and the fork's completion notice keeps owning the announcement.
- **A steered report marks no run.** `markSubagentReportRun()` exists so a run a
  report *starts* announces with the report's sentence. A report steered into the
  user's own run starts nothing: marking that run would replace the user's own
  completion sentence with the child's. The follow-up path keeps the mark.
- **The run boundary is an entry index, not a clock reading.** #1739's first
  shape (upstream 61695daf) filtered assistant entries by `timestamp >= dispatchedAt`;
  the fork's real-SDK integration test resumes a child in the same millisecond as
  the run it follows, and the resumed run reported `FIRST_RESULT\n\nRESUMED_RESULT`.
  Upstream's follow-up (3fbbe2f4) already made it `entries.slice(startedAt)`;
  entries are append-only, so an index is exact and has no clock to skew.
- **Read the transcript the way pi projects it.** pi omits a message with a
  `context_edit` carrying no replacement (its recovery before a provider retry, and
  a `length`-truncated draft before a compaction retry) and rewrites one with a
  replacement. Joining raw entries joined a draft pi had thrown away in front of
  the retried report, so `runResultText()` applies the edits (latest wins) first.
- **The SDK's data is not the fork's assertion.** pi 1.6.0 moved
  `qwen-token-plan-cn` from `token-plan.cn-beijing.maas.aliyuncs.com` to
  `token-plan.maas.qianwenaiapi.com` and dropped `supportsDeveloperRole` from the
  model entry. The fork's `builtin-match` test failed because it pinned 1.5.2's
  endpoint; the fix follows the SDK (new endpoint, and the compat field 1.6.0
  does report), not a weakened assertion.
- **Drift is a sync's job.** `npm run drift` names 6 files past
  `scripts/fork-ownership.json`. Measured on `pi-desk-main`, the same 6 disagree,
  so the registry update belongs to the next upstream sync; a backport that
  rewrites the registry hides its own divergence.

## Tailscale Serve: the tailnet URL belongs to the port the user opens
- **The machine's serve config is not this process's to own.** `tailscale serve`
  keeps one `/` handler per machine, so the startup registration is a global write.
  A process may only make that write when its port is one the user launched Pi on
  and will keep: `isAutoServePort()` refuses the IANA ephemeral range (≥ 49152),
  which is what macOS hands a bind on port 0 — the packaged app's last-resort
  `choose_port` and `verify-packaged-codemode.mjs`'s `freePort()`. A refusal
  touches nothing: no `serve status`, no `serve --bg`, no Tailscale app launch.
- **Fix the writer, and keep the feature.** The report blamed `npm start`, but
  `-p 30141` beats `PORT` in `resolveServePort()`, so that launch could not have
  written 55530; the offenders are the ephemeral-port launches. So the fix
  classifies ports, it does not disable the startup registration (the packaged app
  on 38471 and `pi-web --port` keep working), and the verify script also gets
  `PI_WEB_DISABLE_TAILSCALE_SERVE=1` — belt and braces, the same env the e2e
  harness uses.
- **A stable port self-heals, so no cleanup pass.** `tailscale serve --bg <port>`
  replaces the `/` handler, so the next `npm run dev/start` on 30141 repaired the
  hijacked mapping by itself; deleting "stale" mappings the code did not write
  (paths the user configured by hand) is not ours to do.
- **A deliberate `PORT=<ephemeral>` launch is the user's call.** Settings ›
  Remote access keeps copying `tailscale serve --bg <the page's port>`; that
  remains the way to register a port the app refuses to register for you.

---

# Branch picker decisions (2026-11-25)

- **The header's branch chip always wears `BranchIcon`.** A worktree session used to
  wear `WorktreeIcon`, giving one row `[folder] pi-desk  [worktree] wt/x`: the same glyph
  twice and a claim about the folder in front of a branch name. The project row is the
  chip that says which folder this is (its tip carries the path), so the checkout glyph
  lives there; the kind stays in the words (`chat.gitWorktreeBranchTitle`,
  `chat.branchTipWorktreeLabel`), which is where a phone and a screen reader read it.
- **A branch row's name is the switch; its one trailing button is the worktree that
  branch can start.** The second (branch) glyph did what the label already did, and a
  button on a row git would refuse (this folder's own branch, a branch a worktree holds)
  promises a click that answers with an error. The worktree button opens the
  new-worktree form, never a list of names.
- **The branch page is the tree and the panel's first page.** No `Project actions` step,
  no back rows; Escape, Cancel and a click outside close it. The `Worktrees…` item is
  gone from the DOM panel because every branch with a folder is a row of the tree with
  the glyph that says so, and a removal is confirmed in that branch's own row. The
  desktop shell keeps its native popup with its page, and answers with the same
  `buildBranchRows` order.
- **Nothing in the panel may be cut, so the panel is as wide as its longest name**:
  `width: max-content`, a 240px floor and a `min(420px, calc(100vw - 16px))` cap; a name
  breaks inside a word at the window's edge, a `remote` / `worktree` tag keeps its word
  whole. A branch name exists nowhere else on the screen; an ellipsis over one is data
  loss.
- **The new-worktree form names the base branch and the destination folder.**
  `worktreePathForBranch()` in `lib/branch-tree.ts` mirrors `sanitizeBranchForDir()` in
  `lib/worktree.ts`: one rule in two places, pinned by `lib/branch-tree.test.mjs`.
- **`~/Desktop/custom-bak.css` is adopted into `app/native-theme.css`, not into
  `custom.css`.** Fork rules belong in the fork's theme file (the upstream CSS is
  byte-identical and `custom.css` is the user's own runtime file); the adopted block is
  marked as such, including the squares-it `.agent-session-panel` corner, which
  `components/AgentSessionPanel.test.mjs` now pins as the panel's own call.
- **The browser checks keep their control passes.** `e2e/branch-menu-rows.mjs` re-serves
  the fixture with the four width rules surgically removed and expects the overlap back;
  a check that cannot see the bug it was written for is not a check.

- **The composer's cross-device mirror is deleted, not repaired.** Its whole
  failure class came from one shared record that every device wrote and read
  back: a copy arriving from the server repainted the composer the user was
  typing in (text replaced, screenshots dropped), the device whose clock ran
  ahead won every race, a blank copy wiped a prompt, an oversized attachment
  made the write land trimmed — and the fix for each was another stamp,
  signature or "this composer stopped being mirrored" set. Per-device copies
  remove the surface, so the guards go with it: `components/ChatInput.device-copies.test.mjs`
  pins `lib/composer-sync.ts`, `lib/composer-draft-store.ts` and
  `app/api/composer-draft/**` absent, because a merge that restores them restores
  the wipe with them.
- **"No device edits another's content" is enforced by the store, not by the
  client's good manners.** A record is addressed by `(composer identity, the
  caller's own deviceId)` — the device id is a segment of the record, never of
  the key, so there is no address that names another device's copy — and the
  store mints a write token on a device's first write and requires it on every
  later write and delete (403 without it). Two browsers on one Mac are two
  devices, each holding only its own token, which is exactly what the feature
  needs.
- **A copy never writes the composer.** The poll updates a list; the only path
  from a copy into the text is the row's click, which prepends the copy before
  what is typed here and joins its attachments — the existing prepend /
  `mergeRestoredSubmissionDraft` rule, not a second merge path. The row stays
  after the click: the copy belongs to the device that typed it, and picking it
  up twice is the user's business.
- **A row is read-only by construction.** `components/ComposerDeviceCopies.tsx`
  borrows the outbox's surface and drops its action column: no edit, no delete,
  no send. Its marks are the machine and its browser and they never hide below
  480px, where the outbox's queue mark does — on a phone, "whose draft is this"
  is the row's whole information.
- **The row's mark is a pair — the machine, then the browser that typed the
  copy — and the device slug is not printed.** A row wears the device glyph (a
  screen, a rounded phone, a tablet) in front of the browser glyph (Safari's
  compass, Chrome's wheel, Edge's swirl, Firefox's fox, Opera's O). The first
  cut at this drew only the browser, and two Safari rows — one from a MacBook,
  one from an iPhone — came out as twins: the machine answers "which device", the
  browser answers "which app", and a row needs both. `mac-content-copy` was
  printed beside the marks and read as scan noise, so the slug from
  `deviceCopyNames` is the row's `title` and `aria-label`
  (`mac-content-copy · Safari`). `browser` is part of the record
  (`detectBrowser` → the PUT body → the store's `browserFor`, capped on the
  route), so the mark comes from the device that typed the copy and no
  caller-supplied string reaches the renderer. Chromium forks are matched before
  Safari: every Blink UA ends with `Safari/537.36`, and a headless Chromium says
  `HeadlessChrome/`, so a `\b` before `Chrome/` would call both Safari.
- **A browser with no mark draws no brand, never a guess.** `other` has no entry
  in `BROWSER_GLYPHS` (Vivaldi, the DuckDuckGo app, an Android WebView) and a
  record written before browsers were recorded has no browser: `BrowserCopyGlyph`
  returns `null` and the row is marked by its machine alone. The device glyph is
  redrawn at the app's stroke weight (2, round caps) — the phone was a thin slab
  that read as a line at 15px.
- **The device slug, not a hostname, names a copy.** `mac-content-copy`,
  `iphone-content-copy`, `ipad-content-copy`: the label is a sanitised slug from
  what the browser reports (iPadOS 13+ asks for the desktop site, so
  `maxTouchPoints` decides before the platform name does), and a second device of
  the same label carries its own short id. A visible name must not carry a
  hostname, path or user name.
- **A partial copy says so.** The caps drop an oversized image and count it
  (`droppedImages`/`droppedFiles`) and the row names what is missing. A read-only
  copy that reports itself incomplete is honest; the mirror's silently trimmed
  copy was what repainted a composer without the screenshots the user had just
  added.


## A finished run's title is read from the session that ran (missing notifications)

- **A notification's title is a hard gate, so its reader must be dumb-safe.**
  `announceRunEnd` refuses a run it cannot title — "Session complete" cannot say
  which task ended, and the user rejected that format. That makes the title reader
  load-bearing: one reader that returns `null` silences every channel of one real
  finished task. It is now read from the live session's own entries first, with the
  file as the fallback for a run whose session is not live in this process.
- **A bounded read is a budget, not a window.** A session's first prompt is one
  JSONL line, and with a screenshot attached it carries a few hundred KB of base64.
  Cutting the file at a fixed byte offset cuts that line in half and the line stops
  being JSON, so "read the head of the file" silently means "no title for every
  session that opens with an image". The reader walks lines and caps the *bytes
  read*; it never truncates the line it is reading.
- **Oversized lines are filtered by shape, then parsed for real.** A line over
  256 KB is skipped only when its prefix says it is not a user message; a line that
  passes the check is parsed, so the shape test can cost a title but can never
  invent one. Tool results carry base64 too, and parsing a 10 MB line to learn it
  is not a prompt spends the end of a run.
- **No concurrency gate was added.** The report says "4 tasks running"; nothing in
  the announce path counts other sessions, and the replay reproduced the miss with
  one session. The parallel tasks made it *noticed* (the other three were still
  running, so nothing else had popped either). Announcing at the run's
  `agent_settled` stays the rule (464f9678).

## Item 11: the right panel's Git view

- **`runGit` is exported, not re-implemented.** The commits layer
  (`lib/git-log.ts`) runs git through the bounded runner that already lives in
  `lib/git-changes.ts` (renamed from a private `git()`), so the app has one timeout,
  one buffer cap and one place where a git argument list is audited.
- **The commit's patch is handed to the file viewer's `DiffView`.** `DiffView` is
  exported from `components/FileViewer.tsx` and imported by the panel. A second diff
  renderer was the obvious way to build this and is the thing the panel must not be;
  the export is the whole cost of sharing. The panel is `dynamic`-imported, so the
  viewer's markdown/syntax weight stays off the shell's load.
- **`patchForFile` lives in `lib/patch.ts`**, beside `parseUnifiedPatch`, not in the
  panel: cutting one file's section out of a multi-file patch is patch knowledge, and
  the panel and any later caller should read the same rules (`a/x => b/y` renames
  included).
- **A merge's diff is against its first parent, and the panel says so.** `git show`
  prints nothing for a merge; `git diff <sha>^1 <sha>` is the diff the commit *did*,
  and the row names it (`gitPanel.mergeCommit`, `gitPanel.mergeCommitHint`).
- **Ref and size limits are named, not implicit.** `isSafeGitRef` +
  `--end-of-options` on every rev argument; 40 commits per page, capped at 200; a
  patch over 2 MB answers `supported: false, reason: "too-large"` and the panel says
  the diff is too large rather than streaming 40 MB into a tab.
- **No git on a timer.** The view reads when it is shown; the reload buttons are the
  only other entry. A polling branch list is a git process per open panel.
- **The popup plumbing was out of scope and is out of the tree.** A Git button does
  not own exit animations of nine unrelated popups; the popup files are back to their
  pre-task content (ProjectPicker to `HEAD`, the three menus minus my calls), because
  the shared dev server compiles the whole app and a half-finished expression in one
  popup blanks every page of the tree that the other eleven items are measured on.

## The extension statuses moved to the Session stats card; the widgets did not

- **The statuses read in the card, not under the composer.** `ctx.ui.setStatus`
  lines (LSP, background tasks) were a bordered strip at the window's bottom
  edge: it folded every status into one 17px line, clipped what did not fit, and
  cost the conversation a row for a readout nobody consults while typing. The
  Session stats card is opened to read, so the same lines go there, one row per
  status in key order, colors kept, rows wrapping.
- **The extension widgets keep the composer's strip.** A widget is a control: it
  expands a panel above itself and answers clicks. A header card closes on the
  next click and on any session switch, so moving the widgets there would break
  the extension-compatibility rule (a pi CLI extension's UI has to stay usable).
  The strip is therefore conditional on `belowEditorWidgets.length > 0` and
  carries no status line any more.
- **The lift is a prop, cleared on unmount.** `onExtensionStatusesChange` follows
  the existing `onSessionStatsChange` / `onContextUsageChange` pattern; clearing
  on unmount is what keeps a session switch from showing the previous session's
  LSP line in the new session's card.
- **A card with only statuses is openable.** The More menu's row used to be
  disabled with no stats and no context; `sessionPanelHasContent` adds "has
  statuses", because an extension reports state before the session has usage.

## Memory release (branch `fix/memory-release`)

- **The heap ceiling is a policy module, not a script flag.** `bin/server-flags.js`
  decides the ceiling (dev 2048 MB, production and the desktop sidecar 1536 MB,
  `PI_WEB_MAX_OLD_SPACE_SIZE` to change it, `0`/`off` to leave V8 alone) and every
  entry point asks it: `npm run dev` (through the new `scripts/dev-server.mjs`),
  the LAN scripts, `bin/pi-web.js`, and `desktop/server-launcher.cjs` (in-process
  through `v8.setFlagsFromString`, which is the only way that reaches a forked
  server without re-exec). The cause is measured: `next dev` forks its server child
  with `--max-old-space-size` = half of physical RAM (`next/dist/cli/next-dev.js`),
  so on a 128 GB machine V8 was told to grow to 64 GB and did — 18.62 GB peak.
- **A production build sets the ceiling with `NODE_OPTIONS`, not in-process.**
  `bin/pi-web.js` re-execs with the flag; the flag has to be on the command line
  because V8's heap limit is read at startup. The desktop launcher's
  `v8.setFlagsFromString` is for the sidecar's own worker, not for the heap limit.
- **No count cap on warm sessions.** `lib/idle-session-cap.ts` documents why
  0.8.1's count of 4 was removed (switching among a few small sessions
  cold-started every one). The axis is bytes, so the byte budget went down
  (256 → 64 MiB) and the grace went down with it (30 → 15 s). The newest session
  is still always kept.
- **A session the page only read is released at 10 s; a session that answered a
  prompt is not.** `AgentSessionWrapper.everPrompted` is the difference. A viewer
  is rebuilt from the read-only view cache, so the release is nearly free; a
  session the person ran is the one they expect to come back to, and it keeps the
  byte cap and the idle timeout.
- **The page reports leaving; the server does not guess.** A selected page renews
  the lease every 30 s and every renewal restarts the idle countdown, so
  "switched away" is invisible to the server. `POST /api/agent/[id]/release`
  carries that news (with `keepalive` so a closing tab delivers it), and it is
  refused while an event stream is attached — a second tab is a reason to stay
  warm. A run in progress is never cut short: the idle timer re-arms while the
  session runs, and Stop's forced deadline is never shortened.
- **A cache that cannot name its bytes cannot be released.** Every long-lived
  `globalThis` store now registers a pruner (`lib/cache-registry.ts`): its bytes
  and a `prune(target)` that drops the coldest entries. `lib/cache-registry.test.mjs`
  fails when a store the debug meter names has no pruner, which is how the next
  cache added to the server gets noticed.
- **The valve halves, it does not empty.** Running the valve with a target of
  zero would drop the artifact index and every listing on a single sample, and
  the next page would rebuild all of it (a rescan of every session file). Each
  store goes to half of what it holds, once a minute at most, sessions first
  (cheapest to refetch), caches second, V8 last.
- **`global.gc()` is a dev knob.** The debug route's `?memory=1&gc=1` and the
  bench start the server with `--expose-gc`. Production does not: a full GC on a
  1.5 GB heap is a long pause, and the measured fact is that RSS does not fall
  while the ceiling is far above the live set — the ceiling is the collection
  trigger, which is why the ceiling and the budgets were lowered together.
- **Live sessions are not opened slim.** `lib/session-slim-load.ts` builds a
  `persist=false` manager on purpose. Opening a *live* wrapper from slimmed
  entries would let pi's `_rewriteFile()` (called on version migration and on
  session replacement) write the slimmed entries over the real transcript, losing
  every payload it dropped. Measured gain (~120 MB of a 129 MB file) is not worth
  a transcript-destroying path, so the read-only view cache keeps the slimming and
  the live wrapper keeps the whole file.
- **The read-only view cache is a heap budget now** (12/256/64 MB → 8/96/32 MB).
  The old numbers were chosen before anything measured a heap; a measured browsing
  run pinned 158.9 MB there alone. Re-reading a session from disk is the refetch.

## Search prompts, one session mention, attachments across a reload

- **The sidebar's search box answers prompts in two tiers, not one scan.** Typing filters the
  tree through the existing rule (`lib/session-title-search.ts`: title + first prompt). A query
  the tree cannot answer (≥2 chars, no rows) settles 500ms into `scope=prompts` — every session's
  own prompts, read through the calendar's fingerprint-cached `cachedSessionPrompts`
  (`lib/session-prompt-search.ts`, `GET /api/sessions/search?scope=prompts`). Auto-running the
  whole-transcript scan on every keystroke was tried and measured on this machine: 500 files
  against a 3s budget returned **zero** rows for a title fragment the tree had just matched, so
  the box would have answered "no matches" to a query with matches. Enter keeps the transcript
  scan as the explicit, wider question, and Escape returns to the tree.
- **`SessionSearch` is mounted UI, not declined UI.** AGENTS.md listed it as declined upstream UI
  while the fork's sidebar had been mounting it for the search box's results since the backport.
  The line is corrected: a merge that deletes the import leaves a search box that searches only
  titles, and `components/SessionSidebar.session-search.test.mjs` is the guard.
- **One label rule for a session mention** (`sessionMentionTitle`): name, else the first prompt in
  full (newlines → spaces, `"` → `'`), else the id. The 50-character cut is gone because the label
  is a lookup key: the send path resolves `#"<label>"` through the label → id target the composer
  registered, and a cut prompt matches no session, so the mention arrived as literal text. The
  palette and the row menu both call the rule, and the menu's insert goes through
  `ChatInput.insertSessionMention`, which registers the target. The id (not "Untitled session")
  names a session with no name and no prompt, because labels are map keys and a shared
  placeholder would collide across such sessions.
- **A draft's attachments go to IndexedDB, not to localStorage.** localStorage is text-only by
  design: ~5 MB per origin, shared with 50 drafts. The byte store (`lib/draft-attachment-store.ts`,
  `pi-web:draft-attachments`) keeps one record per durable draft key — a session, or a project's
  `parked-new:<cwd>` — capped at 10 images / 4 MB each / 8 MB per composer / 10 composers. A
  signature per key skips the write when the attachments have not changed, which is what makes
  per-keystroke draft writes cheap. Attachments are read back on request
  (`loadStoredDraftAttachments`) and applied only to a composer with nothing attached; where the
  browser has no IndexedDB (private mode, an embedded view that blocks it) everything behaves as
  before, so the text draft never depends on the byte store.

## The reload that keeps its screenshot: which key answers, and who may delete

The first cut of the byte store passed its unit tests and lost the picture in the running app: the
record was written under the project's parked key and deleted by the reloaded page before the
composer asked for it. Two rules fix that, both in `lib/draft-store.ts`.

- **Reads may derive the parked key; writes may not (unless they own it).**
  `durableAttachmentsKey` is the mirror (`parked-new:<cwd>`, registered by the app shell) or the
  key's own record; `durableAttachmentsKeyForRead` adds the parked key derived from a fresh
  composer key, because the shell's registration effect lands after the composer's mount effect.
  `durableAttachmentsKeyForWrite` uses that derivation only for a key the page has opened
  (`ownedDurableKeys`), so a stale composer key cannot delete or overwrite the record its
  successor owns. The derivation matches the cwd suffix against the parked keys the page knows
  (`knownParkedKeys`) rather than splitting `new:<draftId>:<cwd>` on a colon: a restored composer's
  id is `initial:<cwd>`, and a Windows cwd carries a drive letter's colon, so the split produced a
  doubled key and the reload restored nothing.
- **Only a page that has the bytes may throw them away.** `dropDurableRecord` deletes on a send,
  and on a cleared box or a removed picture only when this page wrote the record or read it into
  its composer. A reload writes text-only drafts — its own restore, `rekeyDraft`'s handover from the
  parked key, a composer that moved on — before its async read of the bytes lands, and a delete from
  any of those is the user's screenshot lost on refresh. `rekeyDraft` also merges one draft rather
  than concatenating two (`mergeRekeyedDraft`): the composer's key is seeded from the parked draft,
  so a union showed the same prompt twice, joined with a blank line, and the same picture twice.
- **The composer's edits outrank the store's answer.** `attachmentsTouchedRef`
  (`components/ChatInput.tsx`) marks a key whose attachments the user edited on this page; a restore
  snapshot arriving after that is dropped, so a box the user cleared is not refilled by an older read.
## A fixture's answer comes from the server, never from the component (2026-07)

`e2e/git-panel.fixture.jsx` answered `getRemoteBranches` from the shape the
component asked for, and the panel passed at five viewports while the real server
answer crashed it in the browser. A harness whose fixture and component were
written from the same assumption tests the assumption, not the seam.

Rule for this panel: every fixture answer is read off the service (`lib/git/**`)
or off a real repository, and where a shape is load-bearing a test pins the
server side too (`app/api/git/flow.test.mjs` asserts that a remote group has no
`name` key). A `useGitQuery<T>` whose `T` was typed by the caller, not copied
from the command's return, is the same bug in the other direction — the compiler
is told a lie and stops helping.

## The row owns its menu, and the menu opens under the row (2026-07)

The file tree's hover buttons (`@ mention`, download) took width from the name at
a narrow panel and offered two actions out of ten. Every row now has a menu
button, and the menu opens under the **row's** left edge — for the tree
(`components/FileTreeMenu.tsx`) and for the Git panel (`anchorTo` in
`components/git/git-ui.tsx`, walking `closest(".git-branch-row, .git-log-row,
.git-shelf-row, .git-change-row, [data-git-menu-row]")`). A menu anchored to a
16px button at the far right of a wide row reads as a menu about the button, and
in a narrow panel it lands off the row it describes.

**Delete goes to the system Trash** (`lib/trash.ts`, the rule that removed chats
follow). A taken name is refused, never silently overwritten; an explicit
overwrite is the only path that removes what is there. A project root is not the
tree's to delete.

**A compare tab is a separate view**, keyed `compare:<a>:<b>`, not a mode of the
file tab. The same file opened plainly is a different question, and one tab id
cannot carry both.

## The Git panel lives as long as the right sidebar, not as long as its toggle (2026-07)

`GitPanel` is mounted while `rightPanelOpen`, and hidden when its own toggle is
off. Reopening the Git view is a look at the same repository; the panel refetches
on its refresh buttons, on the `GET /api/git/events` stream, and when the sidebar
itself closes and opens again. A panel that re-reads git on every tab switch
flickers, and on a big repository it is a second of blank list for a glance.

The consequence is written down because it is a real cost: while the sidebar is
open the panel's queries and its SSE stream stay alive, so a hidden panel keeps
watching the repository. That is the same liveness the panel has when it is
visible, and it has no timer.

## A completion's kind decides whether Monaco keeps it (2026-07)

`SuggestModel` builds a disabled-kinds set from `editor.suggest.show*` and drops
every item whose kind is in it — no log, no notice, a popup that says "No
suggestions". The document's own words are `CompletionItemKind.Text`, so
`suggest.showWords: true` is not "turn Monaco's word list on" (`wordBasedSuggestions`
stays `"off"`, our provider owns the vocabulary); it is the switch that keeps our
own items. `Keyword` — the kind this editor used first — is filtered out by
`showKeywords: false`.

## A guard follows the code it guards (2026-07)

Three source-shape guards failed because the code they name moved, not because
the behaviour went: the composer's model picker is a row of the `+`'s menu
(`AgentsConfig.test.mjs` now reads `ComposerPlusMenu.tsx` and ChatInput's
`model={modelOptions…}` handoff), the tree's mention/download actions live in the
row menu (`SessionSidebar.file-search.test.mjs` asserts the menu items and the
shared `actions={actions}`), and the selector's filtered call takes `options`
where the guard expected `sortedOptions`. Each assertion was rewritten to the
file and shape that carries the behaviour, with the reason beside it. Deleting an
assertion is not the move: every one of these three still fails if the behaviour
goes.
