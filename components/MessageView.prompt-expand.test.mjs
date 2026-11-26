import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");

test("a long prompt is scrollable before it is expanded", () => {
  // The collapsed prompt used to be a clipped box with a fade: reading past the
  // fold needed "Expand" first. It is a scroll box at the same height now.
  assert.match(source, /const collapsed = overflowing && !expanded;/);
  assert.match(
    source,
    /style=\{collapsed \?\s*\{\s*maxHeight: USER_TEXT_COLLAPSE_HEIGHT,\s*overflowY: "auto",/,
  );
  assert.doesNotMatch(source, /maxHeight: USER_TEXT_COLLAPSE_HEIGHT,\s*overflow: "hidden",/);
});

test("Expand lifts the bubble cap so the whole prompt fits", () => {
  // The bubble owns the collapsed cap (USER_BUBBLE_MAX_HEIGHT). Expanding the
  // prompt tells the bubble, which stops capping and stops scrolling: the whole
  // prompt is visible, not a taller scroll box.
  assert.match(source, /const \[promptExpanded, setPromptExpanded\] = useState\(false\);/);
  assert.match(source, /maxHeight: expanded \|\| promptExpanded \? "none" : USER_BUBBLE_MAX_HEIGHT,/);
  assert.match(source, /overflowY: expanded \|\| promptExpanded \? "visible" : "auto",/);
  assert.match(source, /onExpandedChange=\{setPromptExpanded\}/);
});

test("the fade below the fold leaves at the end of the box", () => {
  // A permanent fade on a scroll box reads as a clipped render; it is a hint
  // that more text follows, so it goes once the box is scrolled to its end.
  assert.match(source, /const faded = collapsed && !scrolledToEnd;/);
  assert.match(source, /maskImage: faded \? fade : undefined,/);
  assert.match(source, /setScrolledToEnd\(el\.scrollTop \+ el\.clientHeight >= el\.scrollHeight - 8\);/);
});

test("Collapse returns the prompt to the scroll box", () => {
  // One toggle, both ways: the state travels up on every press, so the bubble
  // caps again and the box scrolls.
  // The viewport is told before the row grows, so the page does not jump under the finger.
  assert.match(source, /onClick=\{\(event\) => \{\s*const next = !expanded;[\s\S]*?onContentToggle\?\.\(event\.currentTarget\);\s*setExpanded\(next\);\s*onExpandedChange\?\.\(next\);\s*\}\}/);
  assert.match(source, /\{expanded \? t\("i18n\.collapse"\) : t\("i18n\.expand"\)\}/);
});
