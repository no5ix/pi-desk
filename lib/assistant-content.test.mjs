import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { emptyTextBlock, fillContentGaps, isAssistantContentBlock } = await jiti.import("./assistant-content.ts");

test("only a shaped block counts as a content block", () => {
  assert.equal(isAssistantContentBlock({ type: "text", text: "hi" }), true);
  assert.equal(isAssistantContentBlock({ type: "toolCall", toolCallId: "1", toolName: "write", input: {} }), true);
  // A block type this app has not caught up with survives; the renderers ignore it.
  assert.equal(isAssistantContentBlock({ type: "future_block" }), true);

  assert.equal(isAssistantContentBlock(undefined), false);
  assert.equal(isAssistantContentBlock(null), false);
  assert.equal(isAssistantContentBlock("text"), false);
  assert.equal(isAssistantContentBlock(0), false);
  assert.equal(isAssistantContentBlock([]), false);
  assert.equal(isAssistantContentBlock({}), false);
});

test("filling gaps keeps every slot and its index", () => {
  // The two shapes a hole arrives in: a sparse array, and the null a JSON
  // round trip turns that hole into on the way over the wire.
  const sparse = [];
  sparse[3] = { type: "toolCall", toolCallId: "1", toolName: "write", input: {} };
  const viaJson = JSON.parse(JSON.stringify(sparse));

  for (const content of [sparse, viaJson]) {
    const filled = fillContentGaps(content);

    assert.equal(filled.length, 4, "the length the wire's contentIndex numbering expects");
    assert.deepEqual(filled.slice(0, 3), [emptyTextBlock(), emptyTextBlock(), emptyTextBlock()]);
    assert.equal(filled[3].toolCallId, "1", "the block stays at the index that addresses it");
  }
});

test("filled content is walkable and reads as nothing", () => {
  const filled = fillContentGaps([undefined, { type: "text", text: "Hello" }]);

  // The whole point: the loops that do not skip holes can read every slot.
  assert.deepEqual(filled.map((block) => block.type), ["text", "text"]);
  assert.equal(filled.filter((block) => block.type === "text" && block.text.length > 0).length, 1);
  for (const block of filled) assert.equal(typeof block.type, "string");
});

test("a content list that is not an array fills to empty", () => {
  assert.deepEqual(fillContentGaps(undefined), []);
  assert.deepEqual(fillContentGaps(null), []);
  assert.deepEqual(fillContentGaps("text"), []);
});
