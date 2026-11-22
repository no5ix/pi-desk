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
const options = source.slice(source.indexOf("new Terminal({"), source.indexOf("terminalRef.current = terminal;"));

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
  // The custom key handler must keep its two desktop shortcuts and stay out of
  // the Alt path, or xterm's Meta handling never runs for the chord.
  const handler = source.slice(source.indexOf("attachCustomKeyEventHandler"), source.indexOf("const writer = createTerminalWriter"));
  assert.match(handler, /\(event\.ctrlKey \|\| event\.metaKey\) && key === "v"\) return false;/);
  assert.match(handler, /\(event\.ctrlKey \|\| event\.metaKey\) && key === "c" && terminal\.hasSelection\(\)\) return false;/);
  assert.ok(!/altKey|Alt\b/.test(handler), "the handler does not consume Alt chords");
  // The phone's CTRL / ALT latch types through the same data path.
  assert.match(source, /terminal\.onData\(\(data\) => \{[\s\S]*?applyTerminalModifiers\(data, consumeModifiers\(\)\)/);
});
