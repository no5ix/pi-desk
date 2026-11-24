import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * A hover state is a solid layer, not a window.
 *
 * The fork's palette defines `--bg-hover` as a 4–5% overlay (light `rgba(0,0,0,.04)`,
 * dark `rgba(255,255,255,.05)`) because it sits over the desktop's translucent
 * vibrancy window. On the right panel's header that is all the close button gets, so
 * pointing at the × read as the glyph going faint — the control the user is about to
 * press is the one thing that must not look like it is disappearing. The wash is the
 * same tint composited onto the panel's own colour: one opaque layer, same look.
 */

const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("the panel header's icon buttons paint an opaque hover wash", () => {
  const hover = css.match(/\.file-workbench-icon-button:hover:not\(:disabled\) \{([^}]+)\}/);
  assert.ok(hover, "the hover rule exists");
  assert.match(hover[1], /background: color-mix\(in srgb, var\(--bg-hover\), var\(--bg-panel\)\);/,
    "the tint is composited onto the panel's colour, so it is a layer and not a window");
  assert.ok(!/background: var\(--bg-hover\);/.test(hover[1]), "the bare overlay on a bare background is what read as transparent");
  assert.match(hover[1], /color: var\(--text\);/, "the glyph gets brighter, which is the feedback the user asked for");
});

test("the palette keeps --bg-hover translucent, which is why the wash composites", () => {
  assert.match(css, /--bg-hover: rgba\(0, 0, 0, 0\.04\);/, "light");
  assert.match(css, /--bg-hover: rgba\(255, 255, 255, 0\.05\);/, "dark");
});
