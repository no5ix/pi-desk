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
 * press is the one thing that must not look like it is disappearing.
 *
 * Compositing the token with `color-mix` does not fix it: mixing a 5%-alpha colour with
 * an opaque one yields a layer that is about *half* transparent, so the panel kept
 * showing through the hovered button. The wash has to be an opaque base with the tint
 * laid over it — `background-color` for the surface, a flat gradient for the tint — so
 * every palette (the pastels included) gets the same solid layer.
 */

const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/** The body of one top-level rule. */
function rule(selector) {
  const at = css.indexOf(`\n${selector} {`);
  if (at === -1) return null;
  return css.slice(at, css.indexOf("\n}", at));
}

for (const [selector, name] of [
  [".file-workbench-icon-button:hover:not(:disabled)", "the panel header's icon buttons"],
  [".right-panel-close:hover", "the panel's own close corner"],
  [".terminal-panel-header button:hover", "the terminal panel's header buttons"],
]) {
  test(`${name} paint an opaque hover wash`, () => {
    const hover = rule(selector);
    assert.ok(hover, `${selector} exists`);
    assert.match(hover, /background-color: var\(--surface\);/,
      "an opaque base: the tint alone is a 5% overlay, and mixing it leaves a half-transparent layer");
    assert.match(hover, /background-image: linear-gradient\(var\(--bg-hover\), var\(--bg-hover\)\);/,
      "the tint laid over that base is one solid wash");
    assert.match(hover, /color: var\(--text\);/, "the glyph gets brighter, which is the feedback the user asked for");
    assert.ok(!/background: var\(--bg-hover\);/.test(hover), "the bare overlay on a bare background is what read as transparent");
    assert.ok(!/color-mix\([^)]*var\(--bg-hover\)/.test(hover), "color-mix carries the token's alpha — that was the bug");
    assert.ok(!/opacity/.test(hover), "fading the control is never the hover state");
  });
}

test("the palette keeps --bg-hover translucent, which is why the wash composites", () => {
  assert.match(css, /--bg-hover: rgba\(0, 0, 0, 0\.04\);/, "light");
  assert.match(css, /--bg-hover: rgba\(255, 255, 255, 0\.05\);/, "dark");
});
