import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  UNPARSED_TOOL_CALL_CUSTOM_TYPE,
  assistantEndedOnUnparsedToolCall,
  findUnparsedToolCall,
  stripFencedCode,
  unparsedToolCallNoticeText,
} = await jiti.import("./unparsed-tool-call.ts");

/**
 * A real reply from a quantized Qwen GGUF served by llama.cpp (session
 * 2026-11-25T11-25-45Z, pi-web): the whole assistant message, `stopReason
 * "stop"`, zero tool calls, and the run over.
 */
const CAPTURED = "<tool_call>\n<=read>\n<parameter=path>\n/Users/lynx/Documents/github/pi-desk/docs/agents/fork-ui.md\n</parameter>\n<parameter=offset>\n80\n</parameter>\n<parameter=limit>\n105\n</parameter>\n</function>\n</tool_call>";

test("the captured mangled call is detected and its tool named", () => {
  const found = findUnparsedToolCall(CAPTURED);
  assert.ok(found);
  assert.deepEqual(found.names, ["read"]);
  assert.match(found.sample, /^<tool_call>/);
  assert.match(found.sample, /fork-ui\.md/);
});

test("the other XML tool-call shapes are detected", () => {
  assert.deepEqual(findUnparsedToolCall(
    '<antml:invoke name="bash">\n<antml:parameter name="command">ls</antml:parameter>\n</antml:invoke>',
  )?.names, ["bash"]);
  assert.deepEqual(findUnparsedToolCall(
    '<invoke name="read">\n<parameter name="path">a.ts</parameter>\n</invoke>',
  )?.names, ["read"]);
  assert.deepEqual(findUnparsedToolCall(
    "<function=bash><parameter=command>ls</parameter></function>",
  )?.names, ["bash"]);
});

test("prose about the format, and a fenced example, are not a printed call", () => {
  assert.equal(findUnparsedToolCall(
    "The extension API has a `tool_call` event. Its shape is:\n\n```\n<tool_call>\n<=read>\n<parameter=path>\nx\n</parameter>\n</tool_call>\n```\n",
  ), null);
  assert.equal(findUnparsedToolCall(
    "A tool call looks like <tool_call> with <parameter=path> tags around the value.",
  ), null);
  assert.equal(findUnparsedToolCall("The card now fills the conversation column."), null);
  assert.equal(findUnparsedToolCall(""), null);
  // A marker with no parameter row is a mention, not a call.
  assert.equal(findUnparsedToolCall("<tool_call> would be the opener."), null);
  assert.equal(stripFencedCode("a\n```\nx\n```\nb"), "a\n\nb");
});

test("a reply that ended on a printed call is a run with work left", () => {
  const message = {
    role: "assistant",
    stopReason: "stop",
    content: [
      { type: "thinking", thinking: "Let me read the docs section on the composer." },
      { type: "text", text: CAPTURED },
    ],
  };
  const found = assistantEndedOnUnparsedToolCall(message);
  assert.ok(found);
  assert.deepEqual(found.names, ["read"]);
});

test("a parsed tool call, an abort, an error and a user message are not", () => {
  const text = { type: "text", text: CAPTURED };
  assert.equal(assistantEndedOnUnparsedToolCall({
    role: "assistant",
    stopReason: "tool_use",
    content: [text, { type: "toolCall", name: "read", arguments: {} }],
  }), null);
  assert.equal(assistantEndedOnUnparsedToolCall({ role: "assistant", stopReason: "aborted", content: [text] }), null);
  assert.equal(assistantEndedOnUnparsedToolCall({ role: "assistant", stopReason: "error", content: [text] }), null);
  assert.equal(assistantEndedOnUnparsedToolCall({ role: "user", content: [text] }), null);
  assert.equal(assistantEndedOnUnparsedToolCall({ role: "assistant", stopReason: "stop", content: "done" }), null);
  assert.equal(assistantEndedOnUnparsedToolCall(undefined), null);
  // A content list with a hole (the dense-content rule) is read, not thrown on.
  const holed = [text];
  holed.splice(0, 0, undefined);
  assert.equal(assistantEndedOnUnparsedToolCall({
    role: "assistant",
    stopReason: "stop",
    content: holed.filter((block) => block !== undefined).concat(),
  })?.names.length, 1);
  assert.equal(assistantEndedOnUnparsedToolCall({ role: "assistant", stopReason: "stop", content: CAPTURED })?.names[0], "read");
});

test("the note names the tool, says nothing ran, and quotes what was written", () => {
  const text = unparsedToolCallNoticeText(findUnparsedToolCall(CAPTURED));
  assert.match(text, /printed a tool call as text/);
  assert.match(text, /nothing ran/);
  assert.match(text, /\bread\b/);
  assert.match(text, /real tool call/);
  assert.match(text, /What you wrote:/);
  assert.match(text, /fork-ui\.md/);
  assert.equal(UNPARSED_TOOL_CALL_CUSTOM_TYPE, "pi-web:unparsed-tool-call");
  // A call whose name survived nowhere is still described.
  const nameless = unparsedToolCallNoticeText(findUnparsedToolCall("<tool_call>\n<parameter=x>1\n</parameter>\n</tool_call>"));
  assert.doesNotMatch(nameless, /It names/);
});
