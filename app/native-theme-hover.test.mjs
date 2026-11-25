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
 * The same token is what upstream's `.image-preview-close:hover` paints its plate with,
 * over a `rgba(0,0,0,.72)` backdrop: the hovered × over the user's photo read as "a
 * little bit transparent". `app/globals.css` is upstream-owned and byte-identical, so the
 * fork's override in this file is what makes that plate solid.
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
  [".image-preview-close:hover", "the image preview's close, over a black backdrop"],
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
test("the header's project, branch and context chips lift their label and their glyph", () => {
  // The header's project, branch, clock and context are controls that open the app's tip,
  // and the only state they showed was the 4% wash — over the translucent chrome that is
  // nearly nothing, so a pointer moving along the row said nothing and the row read as
  // labels. The label and its glyph now lift to `--text` with the wash, the way a
  // `.app-menu` row lifts the line it stands on; the wash itself stays the token.
  const hover = css.match(/\.app-topbar-project-hit:hover,[^{}]*\{([^}]*)\}/);
  assert.ok(hover, "the shared hover / open-tip block for the three chips exists");
  assert.match(hover[1], /background: var\(--bg-hover\);/, "the wash stays the token");
  assert.match(hover[1], /color: var\(--text\);/, "the label lifts to the row's full text colour");
  const glyph = css.match(/\.app-topbar-project-hit:hover svg,[^{}]*\{([^}]*)\}/);
  assert.ok(glyph, "the glyph is named on its own: `.app-topbar-project svg` out-specifies an inherited color");
  assert.match(glyph[1], /color: var\(--text\);/, "a chip never highlights half of itself");
  const chip = rule(".app-topbar-project-hit,\n.app-topbar-branch-hit,\n.app-topbar-context-hit");
  assert.ok(chip, "the three chips share one base rule");
  assert.match(chip, /transition: background [^,]+, color [^;]+;/, "the lift is animated with the wash, not after it");
});

test("a panel divider the pointer crosses is not highlighted", () => {
  // `.panel-resize-handle` is a 12px invisible hit target straddling the pane boundary
  // (`margin: 0 -6px`); the visible line is the panels' own hairline. Upstream tints its
  // `::after` on :hover, :focus-visible and .is-resizing alike, so crossing the sidebar /
  // conversation edge lit up the separator that was already there. The tint belongs to the
  // two states that say "this target is live": keyboard focus (the separator is tabbable
  // and the arrows resize it) and an active drag.
  const hover = rule(".panel-resize-handle:hover::after");
  assert.ok(hover, ".panel-resize-handle:hover::after is answered — upstream's rule wins by cascade if it is not");
  assert.match(hover, /background: transparent;/, "pointer-over paints nothing over the hairline");
  assert.ok(!/color-mix/.test(hover), "no tint of any strength on hover");
  assert.match(css, /\.panel-resize-handle:focus-visible::after \{\n\s*background: color-mix\(in srgb, var\(--border\) 92%, var\(--text-muted\)\);/, "a keyboard-focused divider stays lit");
  assert.match(css, /\.panel-resize-handle\.is-resizing::after \{\n\s*background: color-mix\(in srgb, var\(--border\) 80%, var\(--text-muted\)\);/, "a dragged divider stays lit");
  // The right panel's pair above 960px outranks upstream with `!important`; the `:not()`s
  // are what keep the higher-specificity transparent rule from beating the tinted one.
  assert.match(css, /\.right-panel-resize-handle:not\(:focus-visible\):not\(\.is-resizing\)::after \{\n\s*background: transparent !important;/,
    "the panel edge's divider is transparent except on focus and drag");
  assert.match(css, /\.right-panel-resize-handle:is\(:focus-visible, \.is-resizing\)::after \{\n\s*background: color-mix\(in srgb, var\(--separator\) 68%, var\(--text-muted\)\) !important;/,
    "and its focus / drag tint survives upstream's rule");
  assert.ok(!css.includes(".right-panel-resize-handle:not(:hover):not(:focus-visible):not(.is-resizing)::after"),
    "the old pair tinted :hover — the pointer-over highlight the user reported");
  assert.ok(!/\.panel-resize-handle:hover::after[^{}]*\{[^}]*background:\s*color-mix/.test(css), "no hover tint anywhere in the fork theme");
});
