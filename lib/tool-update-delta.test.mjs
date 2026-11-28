import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  applyToolUpdateDelta,
  createToolUpdateEncoder,
  rememberToolUpdateState,
  TOOL_UPDATE_BASELINE_CAP,
  TOOL_UPDATE_STATE_CAP,
  TOOL_UPDATE_WIRE_DELTA,
  TOOL_UPDATE_WIRE_FULL,
} = await jiti.import("./tool-update-delta.ts");

function update(toolCallId, content, details) {
  return {
    type: "tool_execution_update",
    toolCallId,
    toolName: "bash",
    partialResult: { content, ...(details ? { details } : {}), isError: false },
  };
}

function wireBytes(event) {
  return JSON.stringify(event).length;
}

test("the first update of a tool call goes out whole, the next as the growth only", () => {
  const encoder = createToolUpdateEncoder();
  const first = encoder.encode(update("call-1", [{ type: "text", text: "line 1\n" }]));
  assert.equal(first.mode, TOOL_UPDATE_WIRE_FULL);
  assert.equal(first.rev, 1);
  assert.deepEqual(first.partialResult.content[0].text, "line 1\n");

  const second = encoder.encode(update("call-1", [{ type: "text", text: "line 1\nline 2\n" }]));
  assert.equal(second.mode, TOOL_UPDATE_WIRE_DELTA);
  assert.equal(second.rev, 2);
  assert.equal(second.base, 1);
  assert.equal(second.textAppend, "line 2\n");
  assert.equal(second.partialResult, undefined, "the whole partial result is not resent");
  assert.ok(
    wireBytes(second) < wireBytes(first),
    `a delta must cost less than the snapshot it replaces (${wireBytes(second)} vs ${wireBytes(first)})`,
  );
  // The saving is the payload, not the envelope: the growing-log test below
  // shows what that means over a real run.
  assert.ok(second.partialResult === undefined);
});

test("a growing shell log costs the appended bytes, and the client rebuilds every frame", () => {
  const encoder = createToolUpdateEncoder();
  const chunks = Array.from({ length: 60 }, (_unused, index) => `chunk ${index} ${"x".repeat(200)}\n`);

  let fullBytes = 0;
  let deltaBytes = 0;
  let state;
  let expected = "";
  for (const chunk of chunks) {
    expected += chunk;
    const event = update("call-log", [{ type: "text", text: expected }]);
    fullBytes += wireBytes(event);
    const wire = encoder.encode(event);
    deltaBytes += wireBytes(wire);
    const applied = applyToolUpdateDelta(state, wire);
    assert.equal(applied.ok, true);
    state = applied.state;
  }

  assert.equal(state.partialResult.content[0].text, expected, "the last frame is exact");
  assert.ok(
    deltaBytes < fullBytes / 3,
    `60 snapshots of a growing log cost ${fullBytes} B, deltas ${deltaBytes} B`,
  );
});

test("unchanged details are omitted, and a codemode snapshot sends only the calls it added", () => {
  const encoder = createToolUpdateEncoder();
  const calls = [{ name: "read", args: "a" }, { name: "ls", args: "b" }];
  encoder.encode(update("cm", [{ type: "text", text: "start\n" }], { calls, phase: "running" }));

  // Same content, same details: nothing on the card changes.
  const same = encoder.encode(update("cm", [{ type: "text", text: "start\n" }], { calls, phase: "running" }));
  assert.equal(same.mode, TOOL_UPDATE_WIRE_DELTA);
  assert.equal(same.detailsReplace, undefined, "details the client already has are not resent");

  const grown = encoder.encode(update(
    "cm",
    [{ type: "text", text: "start\n" }],
    { calls: [...calls, { name: "write", args: "c" }], phase: "running" },
  ));
  assert.deepEqual(grown.callsAppend, [{ name: "write", args: "c" }]);
  assert.equal(grown.callsCount, 3);
  assert.equal(grown.detailsReplace, undefined);

  // The client's state follows the same sequence: the identical frame was rev 2.
  let state = { partialResult: { content: [{ type: "text", text: "start\n" }], details: { calls, phase: "running" } }, rev: 1 };
  const appliedIdle = applyToolUpdateDelta(state, same);
  assert.equal(appliedIdle.ok, true);
  state = appliedIdle.state;
  assert.deepEqual(state.partialResult.details.calls, calls, "an omitted details block keeps the client's copy");
  const applied = applyToolUpdateDelta(state, grown);
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.state.partialResult.details.calls, [...calls, { name: "write", args: "c" }]);
});

test("a details object the delta cannot describe goes out whole", () => {
  const encoder = createToolUpdateEncoder();
  encoder.encode(update("cm", [{ type: "text", text: "a\n" }], { calls: [{ name: "read" }], phase: "running" }));
  const replaced = encoder.encode(update("cm", [{ type: "text", text: "a\n" }], { calls: [{ name: "write" }], phase: "running" }));
  assert.deepEqual(replaced.detailsReplace, { calls: [{ name: "write" }], phase: "running" });

  let state = { partialResult: { content: [{ type: "text", text: "a\n" }], details: { calls: [{ name: "read" }], phase: "running" } }, rev: 1 };
  const applied = applyToolUpdateDelta(state, replaced);
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.state.partialResult.details, { calls: [{ name: "write" }], phase: "running" });
});

test("an appended block, a removed block and a rewritten block are each handled", () => {
  const encoder = createToolUpdateEncoder();
  encoder.encode(update("c", [{ type: "text", text: "one\n" }]));

  const appended = encoder.encode(update("c", [{ type: "text", text: "one\n" }, { type: "image", source: { type: "url", url: "/x" } }]));
  assert.equal(appended.mode, TOOL_UPDATE_WIRE_DELTA);
  assert.deepEqual(appended.contentAppend, [{ type: "image", source: { type: "url", url: "/x" } }]);

  // The tail block changed in place: not an append, so the frame goes whole.
  const rewritten = encoder.encode(update("c", [{ type: "text", text: "ONE\n" }, { type: "image", source: { type: "url", url: "/x" } }]));
  assert.equal(rewritten.mode, TOOL_UPDATE_WIRE_FULL);

  const shrunk = encoder.encode(update("c", [{ type: "text", text: "ONE\n" }]));
  assert.equal(shrunk.mode, TOOL_UPDATE_WIRE_FULL, "a content array that shrank has no delta shape");
});

test("a delta with a hole in it is refused, and the client keeps the frame it has", () => {
  const encoder = createToolUpdateEncoder();
  const first = encoder.encode(update("c", [{ type: "text", text: "a" }]));
  let state = applyToolUpdateDelta(undefined, first).state;

  const gap = { type: "tool_execution_update", toolCallId: "c", mode: TOOL_UPDATE_WIRE_DELTA, rev: 9, base: 1, textAppend: "zzz" };
  const applied = applyToolUpdateDelta(state, gap);
  assert.equal(applied.ok, false);
  assert.equal(applied.state.partialResult.content[0].text, "a", "no splice into a frame the delta does not describe");

  // A base the client does not have cannot be spliced either.
  const badBase = { type: "tool_execution_update", toolCallId: "c", mode: TOOL_UPDATE_WIRE_DELTA, rev: 2, base: 7, textAppend: "zzz" };
  assert.equal(applyToolUpdateDelta(state, badBase).ok, false);

  // A delta for a tool call this page never saw (a stream opened mid-call).
  assert.equal(applyToolUpdateDelta(undefined, gap).ok, false);
});

test("a dropped delta invalidates the baseline, so the next update is whole", () => {
  const encoder = createToolUpdateEncoder();
  encoder.encode(update("c", [{ type: "text", text: "a" }]));
  encoder.invalidate("c");
  const next = encoder.encode(update("c", [{ type: "text", text: "ab" }]));
  assert.equal(next.mode, TOOL_UPDATE_WIRE_FULL, "a client with a hole in its stream needs a whole frame");
  assert.equal(next.rev, 1, "a fresh baseline starts a new sequence");
});

test("baselines and reconstructions are bounded, and both sides drop them when the call ends", () => {
  const encoder = createToolUpdateEncoder();
  for (let index = 0; index < TOOL_UPDATE_BASELINE_CAP - 1; index += 1) {
    encoder.encode(update(`call-${index}`, [{ type: "text", text: `output ${index}` }]));
  }
  assert.equal(encoder.trackedCount(), TOOL_UPDATE_BASELINE_CAP - 1);
  encoder.encode(update("call-last", [{ type: "text", text: "x" }]));
  assert.equal(encoder.trackedCount(), TOOL_UPDATE_BASELINE_CAP);
  encoder.encode(update("call-overflow", [{ type: "text", text: "x" }]));
  assert.equal(encoder.trackedCount(), TOOL_UPDATE_BASELINE_CAP, "a long run does not grow the map");
  encoder.invalidate("call-last");
  assert.equal(encoder.trackedCount(), TOOL_UPDATE_BASELINE_CAP - 1, "the end of a call takes its baseline out");

  const states = new Map();
  for (let index = 0; index < TOOL_UPDATE_STATE_CAP + 40; index += 1) {
    rememberToolUpdateState(states, `call-${index}`, { partialResult: { content: [] }, rev: 1 });
  }
  assert.equal(states.size, TOOL_UPDATE_STATE_CAP);
  assert.equal(states.has("call-0"), false, "the least recently updated reconstruction goes first");
  assert.equal(states.has(`call-${TOOL_UPDATE_STATE_CAP + 39}`), true);
});

test("an update with no content array is sent whole, so nothing has to be reconstructed", () => {
  const encoder = createToolUpdateEncoder();
  encoder.encode(update("c", [{ type: "text", text: "a" }]));
  const odd = encoder.encode({ type: "tool_execution_update", toolCallId: "c", toolName: "bash", partialResult: { details: 1 } });
  assert.equal(odd.mode, TOOL_UPDATE_WIRE_FULL);
});

test("a delta carries the error flag, so a failing tool is not shown as running clean", () => {
  const encoder = createToolUpdateEncoder();
  encoder.encode(update("c", [{ type: "text", text: "a" }]));
  const failing = encoder.encode({
    type: "tool_execution_update",
    toolCallId: "c",
    toolName: "bash",
    isError: true,
    partialResult: { content: [{ type: "text", text: "ab" }], isError: true },
  });
  assert.equal(failing.mode, TOOL_UPDATE_WIRE_DELTA);
  assert.equal(failing.isError, true);
  const applied = applyToolUpdateDelta({ partialResult: { content: [{ type: "text", text: "a" }], isError: false }, rev: 1 }, failing);
  assert.equal(applied.state.partialResult.isError, true);
});

test("coalescing: one delta per tool call covers everything the window collected", () => {
  const encoder = createToolUpdateEncoder();
  let text = "";
  const frames = [];
  for (let index = 0; index < 5; index += 1) {
    text += `${index}\n`;
    frames.push(update("c", [{ type: "text", text }]));
  }
  // The stream keeps only the newest frame per tool call, then flushes it.
  const wire = encoder.encode(frames[0]);
  const flushed = encoder.encode(frames[frames.length - 1]);
  assert.equal(wire.mode, TOOL_UPDATE_WIRE_FULL);
  assert.equal(flushed.mode, TOOL_UPDATE_WIRE_DELTA);
  assert.equal(flushed.textAppend, text.slice(frames[0].partialResult.content[0].text.length));

  let state = applyToolUpdateDelta(undefined, wire).state;
  state = applyToolUpdateDelta(state, flushed).state;
  assert.equal(state.partialResult.content[0].text, text);
});

test("every event that is not a tool update passes through untouched", () => {
  const encoder = createToolUpdateEncoder();
  const event = { type: "message_end", message: { role: "toolResult" } };
  assert.equal(encoder.encode(event), event);
});
