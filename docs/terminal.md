# Workspace Terminals

The Explorer terminal action opens or focuses a terminal for its selected cwd
in the right panel's existing tab bar. Each terminal tab keeps the cwd it was
created with. Files still mount only their active viewer; terminal panels stay
mounted behind inactive tabs, hidden panels, and session or project switches.

## Lifecycle

- Each new tab generates a random terminal ID before creation. Creation with
  the same ID and cwd is idempotent, including React Strict Mode's repeated
  effects. An existing ID cannot be reused for another cwd.
- `sessionStorage` retains terminal IDs, cwds, and the active terminal layout
  across refresh. Restored tabs first check the existing server instance and
  never silently start replacement processes after expiry or server restart.
- A new PTY gets a 120-second connection lease. Subscribing cancels expiry;
  the last subscriber leaving starts a new 120-second grace period. This also
  collects creations that never establish their initial connection.
- Hiding a panel, switching tabs, and unmounting a component only disconnect
  clients. Explicitly terminating a tab waits for creation and in-flight input
  before deleting the PTY. Restart waits for termination before creating a new
  ID. Failed termination leaves the tab available to retry.
- A shell exit closes the SSE stream and retains its output and exit code in
  the browser. Unobserved server records expire after the same grace period.
- Explicit termination and expiry signal the shell, escalating to SIGKILL after
  two seconds if it ignores SIGHUP. Server shutdown force-kills shells immediately.

## Transport

Output events carry a monotonically increasing UTF-16 offset in SSE `id`.
Reconnections use `Last-Event-ID` (or `after` on an explicit reconnect) and send
only the missing suffix. The server keeps at most 128 KiB of UTF-16 code units;
an older cursor triggers a terminal reset and bounded history replay. This is
bounded output history, not a serialized full-screen terminal snapshot. Slow
SSE consumers are disconnected once their response queue fills.

Input and resizes are serialized. Pending adjacent input is batched so remote
connections do not require one round trip per keystroke; large pastes are split
without splitting Unicode characters. Failed input is not retried because its
delivery may be ambiguous. Reconnect attaches to the same process with a fresh
writer; restart explicitly replaces the process.

`bin/prepare-terminal.js` repairs node-pty 1.1.0's macOS spawn-helper executable
bits during installation, including published/npm-installed Pi Web packages.

Pi Web pins node-pty to `1.2.0-beta.15`, which includes Linux x64 and ARM64
prebuilt binaries. Native module loading is deferred until terminal creation,
so missing or incompatible binaries produce a JSON error with repair instructions.
Empty or non-JSON API errors show the HTTP status and direct users to the server log.

If a native binary cannot load, run
`npm rebuild node-pty --build-from-source --ignore-scripts=false --foreground-scripts` from the
installation directory (for npx, the cache directory containing `node_modules`).
On Debian/Ubuntu, install `python3` and `build-essential` first. This forces a
source build instead of reusing a missing or incompatible prebuilt binary.
Restart Pi Web after repair.

## Rendering and keys
`components/TerminalPanel.tsx` draws at `TERMINAL_FONT_SIZE` (9 CSS px): xterm
measures cells in CSS pixels, and 9 is the 13px the panel shipped with, 30%
smaller, kept whole so the canvas grid stays crisp. The family follows the app's
mono font choice and is re-measured on a font change without restarting the PTY;
the size has no setting of its own.

`macOptionIsMeta: true` makes Option behave as Meta on macOS, like Terminal.app's
"Use Option as Meta key". Left off, the browser hands xterm the accented
character for the chord (Option+E is `´`, Option+R is `®`), the shell receives
that text and fzf's Option+E / Option+R — like readline's Option+F / Option+B
word jumps — never fire. With it the PTY receives ESC + letter. xterm reads the
option only on macOS, so Windows and Linux keep Alt as Alt, and the phone's
CTRL / ALT latch (`lib/terminal-extra-keys.ts`) stays a separate path.

The option covers only part of the chord set, so the panel's
`attachCustomKeyEventHandler` completes it (`macOptionSequence()` in
`lib/terminal-input.ts`):

- xterm's Meta path translates from the legacy `keyCode`, in the `default:` arm
  of that switch. A printable chord works (`keyCode` 82 is `R`, so `^[r`), while
  a chord whose `key` is the layout's accent maps to nothing — Option+E on a
  Portuguese layout is a dead key, and five presses reached the prompt as
  `´´´´´` — and a chord the browser reports no `keyCode` for maps to nothing
  either. The panel rebuilds it from `key` and the physical `code`.
- The arrows are handled in their own cases, above the Alt branch, so Option+Left
  went out as the modified CSI `ESC [ 1 ; 3 D`, which no macOS shell binds. The
  panel sends Terminal.app's word jumps, ESC + `b` / `f` / `p` / `n`.
- The handler consumes only what xterm cannot produce: a one-character chord is
  left to xterm, so it is never sent twice, and it acts only on a keydown whose
  target is inside the panel, so the composer keeps typing its accents.
  `preventDefault()` is what stops the browser composing the accent behind the
  panel's back.

A phone opens the software keyboard only for a focus raised by a touch, on an
editable field it renders. xterm focuses on `mousedown`, which iOS synthesizes
after the tap, so a tap on the panel left a blinking cursor and no keyboard
(upstream pi-web #1702). `TerminalPanel.tsx` focuses from `pointerdown` /
`touchend` in the capture phase (xterm cancels the event it is built from), and
`app/native-theme.css` gives xterm's helper textarea the `opacity` and 16px font
Safari needs to treat it as a field — 16px is the same floor the composer's
inputs use, below it Safari zooms the page on focus. xterm's `_syncTextArea`
writes the field's left / top / width / height / line-height inline to follow
the cursor, so the CSS must not set geometry: that is what anchors an IME. The
field is read-only while `disableStdin` is on, which is why a tap while the panel
still says "connecting" cannot raise a keyboard.

The focus must also *move*. Safari opens the keyboard when focus arrives at an
editable field during the touch; re-focusing the field that is already the active
element fires no focus event, so no keyboard opens, however many times you tap.
The panel focuses the field itself when the PTY connects (`events.onopen`) and
when the tab becomes active, so every tap found it focused and did nothing —
while a tap after *Restart terminal* worked, because a restart builds a fresh
`Terminal` whose field nobody has focused yet. That is the whole difference, and
the fix: `focusFromTouch` blurs a focused field before focusing it, so the tap is
a focus change. Two more keys turn the same lock: a `readOnly` field never raises
a keyboard, and WebKit gives no guarantee EventSource's `open` fires, so the
first SSE message opens input (`disableStdin = false`) as well as `onopen`.

A tap that *opens* the panel can raise the keyboard too, since the tap is the
gesture: the panel publishes its field to `lib/terminal-focus.ts` (a module, not
a ref, because the panel is `dynamic()`-loaded while `components/AppShell.tsx`
owns the panel toggle and the Explorer's terminal action), and `handleOpenTerminal`
/ `handleRightPanelToggle` call `focusTerminalInputFromTouch()` from the click.
A terminal tab created by that same tap has no field yet — its panel mounts after
the gesture ended — so the keyboard arrives with the next tap.

## Verification

Run `npm test` for native PTY, lease, output cursor, input queue, and storage
checks, and `components/TerminalPanel.options.test.mjs` for the glyph size, the
Option-as-Meta option, the chords that complete it, and the phone's tap-to-focus
(the blur-then-focus, and the field the panel publishes for the panel toggle).
`lib/terminal-focus.test.mjs` covers the registry: a focused field is blurred
first, and a `readOnly` or detached field never takes the focus.
`npm run test:terminal` starts an isolated development server and runs
desktop/mobile browser checks using generated session fixtures; it also asserts
the 9px glyph size and, on macOS, that Option+E / Option+R reach the shell as
`^[e` / `^[r`, Option+Left / Option+Right as `^[b` / `^[f`, and a synthesized
dead-key chord (`key: "Dead"`, `code: "KeyC"`, as WebKit reports it) as `^[c` —
`cat -v` makes the bytes visible — and that a printable chord arrives once. On
the touch viewport it taps the screen and asserts the caret landed in xterm's
helper field, sized and styled as a field iOS accepts, and that the tap produced
a focus *event* (the field was already focused, and moving the focus is the
keyboard's precondition). Install the Playwright Chromium browser first with
`npx playwright install chromium`.
The browser check prints the temporary location of its screenshots and log.
