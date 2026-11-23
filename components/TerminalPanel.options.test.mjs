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

test("a tap on a phone's terminal opens the software keyboard", () => {
  // iOS opens the keyboard only for a focus raised by a touch: xterm focuses on
  // `mousedown`, which iOS synthesizes after the tap, so tapping the panel left
  // the cursor blinking with no keyboard (upstream pi-web #1702). The capture
  // phase matters — xterm's own handler cancels the event it is built from.
  assert.match(source, /container\.addEventListener\("pointerdown", focusFromTouch, true\)/);
  assert.match(source, /container\.addEventListener\("touchend", focusFromTouch, true\)/);
  assert.match(source, /event\.pointerType === "mouse"\) return;/);
  assert.match(source, /const focusFromTouch = \(event: PointerEvent \| TouchEvent\) => \{[\s\S]*?terminal\.focus\(\);/);
  assert.match(source, /event instanceof PointerEvent && event\.pointerType === "mouse"\) return;/);
  assert.match(source, /container\.removeEventListener\("pointerdown", focusFromTouch, true\)/);
  assert.match(source, /container\.removeEventListener\("touchend", focusFromTouch, true\)/);
  // ...and the focus has to *move*. The panel focuses this field on its own — when
  // the PTY connects (onopen) and when the tab becomes active — so by the time a
  // finger lands the field is the active element: a plain `focus()` fires no focus
  // event and Safari opens no keyboard, however many times you tap. A restart built
  // a fresh, unfocused field, which is why the tap after a restart opened one. The
  // tap blurs a focused field, then focuses it, in the same gesture.
  assert.match(source, /const field = terminal\.textarea;\n\s*if \(field && field\.ownerDocument\.activeElement === field\) field\.blur\(\);/);
  // A read-only field opens no keyboard either, and WebKit gives no guarantee that
  // EventSource's `open` fires, so the first message opens input as well.
  const stream = source.slice(source.indexOf("events.onmessage"), source.indexOf("events.onopen"));
  assert.match(stream, /terminal\.options\.disableStdin = false;/);
  // The panel publishes its field, so the tap that opens the panel can raise the
  // keyboard (lib/terminal-focus.ts).
  assert.match(source, /registerTerminalInputField\(id, terminal\.textarea \?\? null\);/);
  assert.match(source, /registerTerminalInputField\(id, null\);/, "and retires it when the tab closes");
  // ...and for a field it renders. xterm's `_syncTextArea` writes left / top /
  // width / height / line-height inline to follow the cursor, so the only
  // property that can hide the field is its stylesheet's `opacity: 0`; 16px is
  // the font size Safari needs so focusing a field does not zoom the page. The
  // rule must not fight xterm for the geometry, which is what anchors an IME.
  const helperStart = cssSource.indexOf(".xterm-helper-textarea {");
  assert.ok(helperStart >= 0, "native-theme.css styles xterm's helper textarea");
  const helperRule = cssSource.slice(helperStart, cssSource.indexOf("}", helperStart));
  assert.match(helperRule, /opacity: 0\.01;/);
  assert.match(helperRule, /font-size: 16px;/);
  for (const geometry of ["left:", "top:", "width:", "height:", "line-height:"]) {
    assert.ok(!helperRule.includes(geometry), `the rule leaves ${geometry.replace(":", "")} to xterm's inline geometry`);
  }
});
