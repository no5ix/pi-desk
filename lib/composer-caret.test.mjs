import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { isTouchPointer, armComposerCaret, repaintComposerCaret, CARET_REPAINT_DELAYS_MS } =
  await jiti.import("./composer-caret.ts");

function fakeArea({ value = "", active = true, throws = false } = {}) {
  const calls = [];
  const el = {
    value,
    selectionStart: 0,
    selectionEnd: 0,
    focus: () => calls.push("focus"),
    setSelectionRange: (start, end) => {
      calls.push(`set:${start},${end}`);
      if (throws) throw new Error("this field has no selectable text");
      el.selectionStart = start;
      el.selectionEnd = end;
    },
  };
  globalThis.document = active ? { activeElement: el } : { activeElement: {} };
  return { el, calls };
}

test("only a finger's tap counts as the gesture that may raise the keyboard", () => {
  assert.equal(isTouchPointer({ pointerType: "touch" }), true);
  assert.equal(isTouchPointer({ pointerType: "pen" }), true);
  assert.equal(isTouchPointer({ pointerType: "mouse" }), false, "a mouse click changes nothing");
  assert.equal(isTouchPointer(undefined), false);
});

test("armComposerCaret focuses the field and puts the caret at the end, in the gesture", () => {
  const { el, calls } = fakeArea({ value: "a finished reply" });
  assert.equal(armComposerCaret(el), true);
  assert.deepEqual(calls, ["focus", "set:16,16"], "focus first, then the selection: the selection is the call that paints the caret");
  assert.equal(el.selectionStart, 16);
});

test("armComposerCaret keeps a field that refuses a selection, and does nothing to none", () => {
  const { el, calls } = fakeArea({ value: "12", throws: true });
  assert.equal(armComposerCaret(el), true, "the focus is all a field with no selectable text can be given");
  assert.deepEqual(calls, ["focus", "set:2,2"]);
  assert.equal(armComposerCaret(null), false);
  assert.equal(armComposerCaret(undefined), false);
});

test("repaintComposerCaret sets the selection to itself, and only in the focused field", () => {
  const { el, calls } = fakeArea({ value: "a draft with a caret in the middle" });
  el.selectionStart = 9;
  el.selectionEnd = 9;
  assert.equal(repaintComposerCaret(el), true);
  assert.deepEqual(calls, ["set:9,9"], "no move, no focus call: the caret is repainted where it stands");
  const idle = fakeArea({ value: "not focused", active: false });
  assert.equal(repaintComposerCaret(idle.el), false, "a field the page does not focus is left alone");
  assert.equal(repaintComposerCaret(null), false);
});

test("the caret is repainted after the keyboard's travel, not during it", () => {
  // The settle chain ends at 720ms (hooks/useViewportHeight.ts); a caret set before the
  // travel lands is painted at a place the composer is leaving.
  assert.ok(CARET_REPAINT_DELAYS_MS.length >= 2, "the travel is followed, not sampled once");
  assert.ok(CARET_REPAINT_DELAYS_MS[0] >= 200, `the first repaint is after the lift starts (${CARET_REPAINT_DELAYS_MS[0]}ms)`);
  assert.ok(
    CARET_REPAINT_DELAYS_MS[CARET_REPAINT_DELAYS_MS.length - 1] >= 720,
    `the last repaint outlives the settle chain (${CARET_REPAINT_DELAYS_MS.at(-1)}ms)`,
  );
  for (let i = 1; i < CARET_REPAINT_DELAYS_MS.length; i++) {
    assert.ok(CARET_REPAINT_DELAYS_MS[i] > CARET_REPAINT_DELAYS_MS[i - 1], "and they arrive in order");
  }
});
