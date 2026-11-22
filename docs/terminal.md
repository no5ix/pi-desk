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

## Verification

Run `npm test` for native PTY, lease, output cursor, input queue, and storage
checks, and `components/TerminalPanel.options.test.mjs` for the glyph size and
the Option-as-Meta option. `npm run test:terminal` starts an isolated development
server and runs desktop/mobile browser checks using generated session fixtures;
it also asserts the 9px glyph size and, on macOS, that Option+E / Option+R reach
the shell as `^[e` / `^[r` (`cat -v` makes the bytes visible). Install the
Playwright Chromium browser first with `npx playwright install chromium`.
The browser check prints the temporary location of its screenshots and log.
