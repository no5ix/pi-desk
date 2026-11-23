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

A phone's keyboard opens for a focus that **moves** to an editable field during
a user gesture, opens nothing for a field that is already the active element, and
opens nothing for a **read-only** field. The report this answers is exact:
"tapping the terminal never opens the keyboard, however many times I tap; the
first tap after `Restart terminal` does." A restart builds a fresh `Terminal`
whose helper textarea nobody has focused, so its first tap moves the focus; the
panel had focused the field on connect (`events.onopen`) and on tab activation,
so every other tap found it focused, fired no focus event, and opened nothing
(upstream pi-web #1702). Three contracts, each pinned by a test:

- **Connect does not focus the field on a touch device** — `isTouchFocusDevice()`
  in `lib/terminal-focus.ts`, checked at `onopen` and in the tab-activation
  effect. A caret the keyboard never followed is precisely the state that
  swallows the taps that come after it.
- **A tap releases the field on finger-down and focuses it on finger-up.** Blur
  and focus *inside one gesture* read as no net change, which is why the first
  fix for this bug — blur, then focus, in a single `focusFromTouch` handler — did
  nothing on the user's iPhone. `pointerdown` / `touchstart` call
  `releaseOnTouch` (blur the field when it is the active element) and `touchend`
  / `pointerup` call `raiseOnTouch`, through named listeners so the cleanup
  removes them. The capture phase is required (xterm cancels the event its own
  handler is built from) and `pointerup` stands down when `touchend` already
  focused, so a browser that fires both focuses once.
- **The panel grows a visible, always-editable command line**
  (`components/TerminalComposer.tsx`, shown on `(pointer: coarse)`, in row 5 of
  the panel grid under the extra-keys strip). It depends on no focus rule: the
  tap focuses a field Safari renders. It is never `readOnly` — not while the
  shell connects — `enterKeyHint="send"` makes the phone's own return key send,
  16px is the app's zoom floor, the label is `useId()`-bound, and the button
  prevents `pointerdown` / `mousedown` so it never takes the focus and the
  keyboard stays between commands. Send is the panel's `sendComposerText`: the
  text as typed, then Enter; a latched CTRL / ALT applies to a single character
  like a typed key. It answers `false` when the shell is not there to take input
  (`connectedRef`), and the row keeps the command the user typed.

The helper field still has to be a field Safari renders, so
`app/native-theme.css` gives it `opacity: 0.01` and 16px and sets no geometry:
xterm's `_syncTextArea` writes left / top / width / height / line-height inline
to follow the cursor, and that is what anchors an IME. The field is read-only
while `disableStdin` is on, which is why a tap on a panel that still says
"connecting" cannot raise a keyboard, and WebKit gives no guarantee
EventSource's `open` fires, so the first SSE message opens input as well.

A tap that *opens* the panel declines to focus the field on a touch device
(`focusTerminalInputFromTouch()` returns false when `isTouchFocusDevice()`): the
toggle is one gesture, and one gesture cannot be split into release and lift,
while the field is usually still read-only as the shell connects — so all that
focus would leave behind is the state the following taps inherit. The registry
(a module, not a ref, because the panel is `dynamic()`-loaded while
`components/AppShell.tsx` owns the panel toggle and the Explorer's terminal
action, and a plain module keeps the import free of xterm) keeps serving the
pointers where the caret belongs; on a phone the keyboard comes from the taps
inside the panel and from the command line.

## Verification

Run `npm test` for native PTY, lease, output cursor, input queue, and storage
checks, and `components/TerminalPanel.options.test.mjs` for the glyph size, the
Option-as-Meta option, the chords that complete it, and the phone's keyboard
path: the split handlers (the landing releases and the lift focuses, in both
event families, as removable named listeners), the panel focusing the field on a
mouse only, and the command line's wiring. `lib/terminal-focus.test.mjs` covers
the registry — a focused field is blurred first, a `readOnly` or detached field
never takes the focus, and on a touch device the panel toggle declines, because
the focus it would leave is the one that swallows the taps after it.
`components/TerminalComposer.test.mjs` pins the row: coarse pointers only, a
real input with `enterKeyHint="send"` and no `readOnly`, a `useId()`-bound
label, a Send button that keeps the focus, and a refused send that keeps the
text.
`npm run test:terminal` starts an isolated development server and runs
desktop/mobile browser checks using generated session fixtures; it also asserts
the 9px glyph size and, on macOS, that Option+E / Option+R reach the shell as
`^[e` / `^[r`, Option+Left / Option+Right as `^[b` / `^[f`, and a synthesized
dead-key chord (`key: "Dead"`, `code: "KeyC"`, as WebKit reports it) as `^[c` —
`cat -v` makes the bytes visible — and that a printable chord arrives once. On
the touch viewport it asserts connect left xterm's field unfocused; that a tap
lands the caret in a field iOS accepts (a box, rendered, 16px, editable) with a
focus *event*; that a **second** tap on the already-focused field produces the
`blur` → `focus` pair, which is the reported case; and that the command line
takes a tap as a real 16px input, carries a `printf` line to the shell, and
still holds the focus after Send. Install the Playwright Chromium browser first
with `npx playwright install chromium`.
The browser check prints the temporary location of its screenshots and log.
