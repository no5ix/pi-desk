# DECISIONS

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
