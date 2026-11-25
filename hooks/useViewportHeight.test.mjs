import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { shouldUseVisualViewportHeight, settleKeyboardViewportHeight, KEYBOARD_STABLE_MS } =
  await jiti.import("./useViewportHeight.ts");

test("uses the visual viewport for a focused editor when the keyboard shrinks it", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), true);
});

test("does not keep the keyboard height after the visual viewport restores", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

test("restores the dynamic height as soon as the editor loses focus", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: false,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 1,
  }), false);
});

test("does not mistake pinch zoom for an open keyboard", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 422,
    viewportScale: 2,
  }), false);
});

test("keeps the dynamic viewport height when the visual viewport is not reduced", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 844,
    viewportScale: 1,
  }), false);
});

// iOS auto-zooms the page when a < 16px editable takes focus, and a user pinch
// zooms it too. The composer must still follow the keyboard in those cases.
test("detects the keyboard while the page is zoomed", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 350,
    viewportScale: 1.3,
  }), true);
});

test("ignores the Safari toolbar shift while an editor is focused", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 806,
    viewportScale: 1,
  }), false);
});

test("falls back to an unscaled comparison for a missing scale", () => {
  assert.equal(shouldUseVisualViewportHeight({
    hasFocusedEditable: true,
    innerHeight: 844,
    viewportHeight: 510,
    viewportScale: 0,
  }), true);
});

test("the keyboard's travel is one way: a mid-slide reading never lowers the composer back", () => {
  // iOS slides the keyboard in over a third of a second, and the settle chain re-reads
  // the visual viewport through the slide. The first readings are frames of it — the
  // viewport is only ever taller than the height the keyboard ends at — so the app's
  // height (the column the composer sits at the end of) must take the smallest, not the
  // freshest. A composer that follows every frame travels past its place and falls back
  // into it, which is the jump the phone showed.
  const opening = { appliedHeight: 627, candidateHeight: 700, keyboardOpen: true, msSinceKeyboardOpen: 120 };
  assert.equal(settleKeyboardViewportHeight(opening), 627, "a taller mid-slide reading is ignored");
  assert.equal(
    settleKeyboardViewportHeight({ appliedHeight: 627, candidateHeight: 560, keyboardOpen: true, msSinceKeyboardOpen: 120 }),
    560,
    "a shorter reading is the keyboard's own travel: it lands",
  );
  assert.equal(
    settleKeyboardViewportHeight({ appliedHeight: null, candidateHeight: 817, keyboardOpen: true, msSinceKeyboardOpen: 0 }),
    817,
    "the first reading is the starting point",
  );
});

test("after the settle window, a taller viewport is real news", () => {
  // An IME bar that goes away, a keyboard that changes shape: those are height increases
  // the user sees, and the composer has to follow them.
  assert.equal(
    settleKeyboardViewportHeight({
      appliedHeight: 560,
      candidateHeight: 627,
      keyboardOpen: true,
      msSinceKeyboardOpen: KEYBOARD_STABLE_MS,
    }),
    627,
  );
  assert.equal(
    settleKeyboardViewportHeight({ appliedHeight: 560, candidateHeight: 817, keyboardOpen: false, msSinceKeyboardOpen: 0 }),
    817,
    "with no keyboard the reading is the page's own height",
  );
});
