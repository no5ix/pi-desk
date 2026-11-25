import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./useResizablePanel.ts", import.meta.url), "utf8");

test("vertical panels use vertical pointer movement, cursor, keys, and separator orientation", () => {
  assert.match(source, /axis === "vertical" \? event\.clientY : event\.clientX/);
  assert.match(source, /axis === "vertical" \? "row-resize" : "col-resize"/);
  assert.match(source, /axis === "vertical" \? "ArrowDown" : "ArrowRight"/);
  assert.match(source, /axis === "vertical" \? "ArrowUp" : "ArrowLeft"/);
  assert.match(source, /axis === "vertical" \? "horizontal" as const : "vertical" as const/);
});

test("resized values continue to persist and reset through the shared panel contract", () => {
  assert.match(source, /writeStoredWidth\(storageKey, nextWidth\)/);
  assert.match(source, /onDoubleClick: resetWidth/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /window\.addEventListener\("resize", onResize\)/);
});

test("a pointer drag never focuses the separator, so the divider is left unhighlighted", () => {
  // The drag's `preventDefault()` cancels the compatibility `mousedown`, so an explicit
  // `target.focus()` was the only thing focusing the separator mid-drag — and Chromium
  // grants `:focus-visible` to a programmatically focused `div[role=separator][tabindex=0]`,
  // so the divider stayed lit after the pointer was released. Pointer capture needs no
  // focus; the keyboard user Tabs to the separator, which is the one state with a cue to
  // show (`e2e/divider-hover.mjs` measures the drag in a real browser).
  const pointerDown = source.slice(source.indexOf("const onPointerDown"), source.indexOf("const onPointerMove"));
  assert.match(pointerDown, /target\.setPointerCapture\(event\.pointerId\)/, "the drag keeps its pointer capture");
  // A call, not a mention: the comment above the capture names the call that was removed.
  assert.ok(!/^\s*[\w.]+\.focus\(/m.test(pointerDown), "pointer-down must not focus the separator: a mouse drag would leave the line lit");
});
