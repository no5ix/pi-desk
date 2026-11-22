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
