import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
// The integrated terminal is an xterm.js surface over the server PTY. Two of its
// options are user-visible contracts: the glyph size, and Option behaving as
// Meta on macOS (fzf's Option+E / Option+R, readline's Option+F / Option+B).
// Verified live in `node_modules/@xterm/xterm` 6.0.0: with the option, the PTY
// receives `^[e` for Option+E; without it, the browser hands xterm the accented
// character (UTF-8 `M-BM-4` under `cat -v`) and the shell never sees a chord.
const source = await readFile(new URL("./TerminalPanel.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");
const options = source.slice(source.indexOf("new Terminal({"), source.indexOf("terminalRef.current = terminal;"));
const handler = source.slice(source.indexOf("attachCustomKeyEventHandler"), source.indexOf("const writer = createTerminalWriter"));

test("the terminal draws its glyphs 30% smaller than the size it shipped with", () => {
  assert.match(source, /const TERMINAL_FONT_SIZE = 9;/, "13px -> 9px is the requested 30% reduction, kept whole for the canvas grid");
  assert.match(options, /fontSize: TERMINAL_FONT_SIZE,/);
  assert.ok(!/fontSize: 13\b/.test(source), "the panel does not draw at the old 13px");
  // The family stays the app's mono choice, re-measured when it changes.
  assert.match(options, /fontFamily: getComputedStyle\(container\)\.getPropertyValue\("--font-mono"\)/);
  assert.match(source, /terminal\.options\.fontFamily = getComputedStyle\(container\)/);
});

test("Option is Meta on macOS, so shell chords reach the PTY", () => {
  assert.match(options, /macOptionIsMeta: true,/);
  // The custom key handler keeps its two desktop shortcuts.
  assert.match(handler, /\(event\.ctrlKey \|\| event\.metaKey\) && key === "v"\) return false;/);
  assert.match(handler, /\(event\.ctrlKey \|\| event\.metaKey\) && key === "c" && terminal\.hasSelection\(\)\) return false;/);
  // xterm's own Meta path is `keyCode`-driven and only covers one-character
  // keys, so the chords Safari and the desktop app's WKWebView report a
  // `keyCode` of 0 for never reach the PTY: a dead-key chord (Option+E is
  // `Dead`, `´` on a Portuguese layout) arrives as text, and Alt+arrows go out
  // as the modified CSI `ESC [ 1 ; 3 D` no macOS shell binds. The handler
  // completes that path from `key` and `code` — and only for a keystroke inside
  // the terminal, so the composer keeps typing its accents.
  assert.match(handler, /APPLE_OPTION_IS_META && event\.altKey && container\.contains\(event\.target as Node \| null\)/);
  assert.match(handler, /macOptionSequence\(event\)/);
  assert.match(handler, /event\.preventDefault\(\);/);
  assert.match(handler, /terminal\.input\(chord, true\)/);
  // The same platforms xterm reads macOptionIsMeta on; Windows and Linux keep
  // the Alt sequences xterm already sends.
  assert.match(source, /const APPLE_OPTION_IS_META = \/\^\(\?:Mac\|iPhone\|iPad\|iPod\)\//);
  // The phone's CTRL / ALT latch types through the same data path.
  assert.match(source, /terminal\.onData\(\(data\) => \{[\s\S]*?applyTerminalModifiers\(data, consumeModifiers\(\)\)/);
});

test("a tap on a phone's terminal opens the keyboard, and the command line needs no trickery", () => {
  // iOS opens a keyboard only for a focus that *moves* to an editable field during a gesture,
  // and opens nothing for a field that is already the active element (upstream pi-web #1702).
  // That is the report "tapping the terminal never opens the keyboard, and the first tap after a
  // Restart does": the panel focused the field on connect and on tab activation, so every tap
  // was a focus that did not move. The capture phase matters — xterm's own handler cancels the
  // event it is built from.
  assert.match(source, /container\.addEventListener\("pointerdown", releaseOnTouch, true\)/);
  assert.match(source, /container\.addEventListener\("touchstart", releaseOnTouch, true\)/);
  assert.match(source, /container\.addEventListener\("touchend", liftFromTouch, true\)/);
  assert.match(source, /container\.addEventListener\("pointerup", liftFromPointer, true\)/);
  for (const name of ["pointerdown", "touchstart", "touchend", "pointerup"]) {
    assert.match(source, new RegExp(`container\\.removeEventListener\\("${name}", (releaseOnTouch|liftFromTouch|liftFromPointer), true\\)`),
      `the ${name} listener is removable, so the cleanup does not leak handlers`);
  }
  assert.match(source, /const isTouchPointer = \(event: PointerEvent \| TouchEvent\) =>\n\s*!\(event instanceof PointerEvent\) \|\| event\.pointerType === "touch";/,
    "a mouse pointer does none of this; the desktop keeps its normal focus");
  // The focus has to move, and blur-then-focus inside one gesture reads as no net change — the
  // first fix for this bug. So the landing releases the field and the lift focuses it.
  assert.match(source, /const field = terminal\.textarea;\n\s*if \(field && field\.ownerDocument\.activeElement === field\) field\.blur\(\);/,
    "the finger down: the field lets go");
  assert.match(source, /const raiseOnTouch = \(event: PointerEvent \| TouchEvent, fromLift: boolean\) => \{[\s\S]*?terminal\.focus\(\);/,
    "the finger up: a focus that moves from the page into the field");
  // The panel never parks the caret in the field on a phone: that is the state that swallowed
  // every tap, and the reason a restarted terminal's first tap worked.
  assert.match(source, /if \(container\.offsetWidth && container\.offsetHeight && !isTouchFocusDevice\(\)\) terminal\.focus\(\);/, "connect focuses on a mouse only");
  assert.match(source, /if \(active && !isTouchFocusDevice\(\)\) terminalRef\.current\?\.focus\(\);/, "the tab becoming active does the same");
  // A read-only field opens no keyboard either, and WebKit gives no guarantee that EventSource's
  // `open` fires, so the first message opens input as well.
  const stream = source.slice(source.indexOf("events.onmessage"), source.indexOf("events.onopen"));
  assert.match(stream, /terminal\.options\.disableStdin = false;/);
  // The command line is the path that depends on none of this: a real, visible, always-editable
  // input under the terminal, so the tap focuses a field Safari renders.
  assert.match(source, /const showComposer = useTerminalComposerVisible\(\);/);
  assert.match(source, /\{showComposer && <TerminalComposer onSend=\{sendComposerText\} \/>\}/, "the row sits under the terminal, above the extra keys");
  assert.match(source, /if \(!terminal \|\| !connectedRef\.current\) return false;/,
    "a send into a shell that is not there is refused, so the row keeps the command the user typed");
  assert.match(source, /terminal\.input\(applyTerminalModifiers\(text, consumeModifiers\(\)\), true\);\n\s*terminal\.input\("\\n", true\);/,
    "the text goes out as typed, then Enter");
  assert.match(source, /connectedRef\.current = value;/, "the panel publishes whether the shell is there, for the row's Send");
  // ...and for a field it renders. xterm's `_syncTextArea` writes left / top / width / height /
  // line-height inline to follow the cursor, so the only property that can hide the field is its
  // stylesheet's `opacity: 0`; 16px is the font size Safari needs so focusing a field does not
  // zoom the page. The rule must not fight xterm for the geometry, which is what anchors an IME.
  const helperStart = cssSource.indexOf(".xterm-helper-textarea {");
  assert.ok(helperStart >= 0, "native-theme.css styles xterm's helper textarea");
  const helperRule = cssSource.slice(helperStart, cssSource.indexOf("}", helperStart));
  assert.match(helperRule, /opacity: 0\.01;/);
  assert.match(helperRule, /font-size: 16px;/);
  for (const geometry of ["left:", "top:", "width:", "height:", "line-height:"]) {
    assert.ok(!helperRule.includes(geometry), `the rule leaves ${geometry.replace(":", "")} to xterm's inline geometry`);
  }
});

test("the phone's command line has its own row, sized for the keyboard", () => {
  const composerStart = cssSource.indexOf(".terminal-composer {");
  assert.ok(composerStart >= 0, "native-theme.css lays the row out (the fork owns this file)");
  const composerRule = cssSource.slice(composerStart, cssSource.indexOf("}", composerStart));
  assert.match(composerRule, /grid-row: 5;/, "under the extra keys, which globals.css pins at row 4");
  assert.match(composerRule, /background: var\(--surface\);/, "the fork's terminal surface, not upstream's");
  assert.ok(!/^\s*(left|top|width|height):/m.test(composerRule));
  const inputStart = cssSource.indexOf(".terminal-composer input {");
  assert.ok(inputStart >= 0);
  const inputRule = cssSource.slice(inputStart, cssSource.indexOf("}", inputStart));
  assert.match(inputRule, /font-size: 16px;/, "the size Safari needs, so focusing the field does not zoom the page");
  assert.match(inputRule, /min-width: 0;/, "a flex input that can shrink on a phone");
  assert.match(cssSource, /html\[data-keyboard-open\] \.terminal-composer \{/, "the safe-area padding stands down while the keyboard is up, as it does for the extra keys");
  assert.match(cssSource, /html\[data-standalone-safe-area\]:not\(\[data-keyboard-open\]\) \.terminal-composer \{/);
});
