# DECISIONS
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
