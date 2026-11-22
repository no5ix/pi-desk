import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  normalizeStreamingToolCalls,
  normalizeToolCalls,
} = await jiti.import("./normalize.ts");

function assistant(block) {
  return {
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [block],
  };
}

test("keeps SDK scratch input only for an in-flight snapshot", () => {
  const message = assistant({
    type: "toolCall",
    id: "call-1",
    name: "write",
    arguments: { path: "/tmp/file" },
    partialJson: '{"path":"/tmp/file","content":"hel',
  });

  assert.deepEqual(normalizeStreamingToolCalls(message).content[0], {
    type: "toolCall",
    toolCallId: "call-1",
    toolName: "write",
    input: { path: "/tmp/file" },
    rawInput: '{"path":"/tmp/file","content":"hel',
  });
  assert.deepEqual(normalizeToolCalls(message).content[0], {
    type: "toolCall",
    toolCallId: "call-1",
    toolName: "write",
    input: { path: "/tmp/file" },
  });
});

test("removes a client raw buffer when normalizing a completed message", () => {
  const message = assistant({
    type: "toolCall",
    toolCallId: "call-2",
    toolName: "write",
    input: { path: "/tmp/file", content: "complete" },
    rawInput: "temporary",
  });

  assert.equal(Object.hasOwn(normalizeToolCalls(message).content[0], "rawInput"), false);
});

test("a hole in a message's content normalizes to a block, keeping every index", () => {
  // Session files and the wire carry a hole as null; the client builds one by
  // index. Neither may hand undefined to the code that walks an assistant reply.
  const message = {
    role: "assistant",
    provider: "anthropic",
    model: "claude-test",
    content: [null, { type: "toolCall", id: "call-1", name: "write", arguments: { path: "/tmp/file" } }],
  };

  const normalized = normalizeToolCalls(message);
  assert.deepEqual(normalized.content[0], { type: "text", text: "" });
  assert.deepEqual(normalized.content[1], {
    type: "toolCall",
    toolCallId: "call-1",
    toolName: "write",
    input: { path: "/tmp/file" },
  });
});
