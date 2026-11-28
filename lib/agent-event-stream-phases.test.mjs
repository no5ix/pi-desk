import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createAgentEventStream, TOOL_UPDATE_COALESCE_MS } = await jiti.import("./agent-event-stream.ts");

const decoder = new TextDecoder();
const SESSION = "session-phases";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function readWithin(reader, timeoutMs = 1_500) {
  let timeout;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, rejectPromise) => {
        timeout = setTimeout(() => rejectPromise(new Error("Timed out reading SSE chunk")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function framesFrom(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)));
}

/**
 * A leaf value that lands on `id` when the finished message is appended. The
 * stream reads the session's leaf twice — at `message_end`, and one microtask
 * later when the gated append flushes — so a test advances it synchronously
 * after delivering the event. That is the session's own order: the entry is
 * written, the event is delivered, the flush reads the leaf.
 */
function leafLanding(id, role) {
  return {
    current: null,
    advance() {
      this.current = { id, type: "message", role };
    },
  };
}

/**
 * Open a stream over a fake session and drain the transport and snapshot
 * frames. `leaf: null` builds a session with no `leafEntry` at all, which is
 * the shape of a session that cannot name the entry a message became.
 */
async function openStream(options, leaf = { current: null }) {
  const startup = deferred();
  const stream = createAgentEventStream(
    new Request(`http://localhost/api/agent/${SESSION}/events`),
    SESSION,
    startup.promise,
    undefined,
    options,
  );
  const reader = stream.getReader();
  const transport = await readWithin(reader);
  assert.equal(decoder.decode(transport.value), ":\n\n", "the transport opens before the session is ready");

  let listener = null;
  const session = {
    isStreaming: false,
    streamingMessage: null,
    isAlive: () => true,
    onEvent(next) {
      listener = next;
      return () => {};
    },
  };
  if (leaf !== null) session.leafEntry = () => leaf.current;
  startup.resolve(session);

  const snapshot = await readWithin(reader);
  const published = framesFrom(decoder.decode(snapshot.value));

  const collect = async (count, ms = 400) => {
    const frames = [];
    const deadline = Date.now() + ms;
    while (frames.length < count && Date.now() < deadline) {
      try {
        const chunk = await readWithin(reader, Math.max(50, deadline - Date.now()));
        if (chunk.done) break;
        frames.push(...framesFrom(decoder.decode(chunk.value)));
      } catch {
        break;
      }
    }
    return frames;
  };

  // A test that leaves the reader open leaves the stream — and its coalescing
  // timers — alive, and the file hangs.
  const close = async () => {
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  };

  return { listener: (event) => listener?.(event), published, collect, leaf, close };
}

const bigThinking = `${"t".repeat(1500)}\n${"u".repeat(1500)}`;

function assistantEnd(thinking = bigThinking) {
  return {
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking }, { type: "text", text: "the answer" }],
      model: "m",
      provider: "p",
      usage: { input: 1, output: 2 },
    },
  };
}

function toolResultEnd(text, extra = {}) {
  return {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: 7,
      ...extra,
    },
  };
}

test("a finished reply is handed to the page with the entry it became, and its reasoning deferred", async () => {
  const { listener, collect, leaf, close } = await openStream({}, leafLanding("entry-9", "assistant"));
  try {
    listener(assistantEnd());
    leaf.advance();
    const [event] = await collect(1);

    assert.equal(event.type, "message_end");
    assert.equal(event.entryId, "entry-9", "the page learns which session entry this message is");
    assert.ok(event.deferredContent, "the event says the message is a projection");
    assert.equal(event.message.content[0].deferred, true);
    assert.equal(event.message.content[0].thinking.length, 240, "the reasoning is a preview, not the transcript");
    assert.equal(event.message.content[1].text, "the answer", "the reply the reader is waiting for is not cut");
  } finally {
    await close();
  }
});

test("a stream whose session cannot name the entry sends the message whole", async () => {
  const { listener, collect, close } = await openStream({}, { current: null });
  try {
    listener(assistantEnd());
    const [event] = await collect(1);
    assert.equal(event.entryId, undefined);
    assert.equal(event.deferredContent, undefined);
    assert.equal(event.message.content[0].thinking, bigThinking, "no entry to fetch from means no deferral");
  } finally {
    await close();
  }
});

test("the deferral is a switch: a client that wants every byte gets every byte", async () => {
  const { listener, collect, leaf, close } = await openStream({ deferLiveContent: false }, leafLanding("entry-9", "assistant"));
  try {
    listener(assistantEnd());
    leaf.advance();
    const [event] = await collect(1);
    assert.equal(event.entryId, undefined, "the switch is off: no projection, no entry id");
    assert.equal(event.message.content[0].thinking, bigThinking);
  } finally {
    await close();
  }
});

test("a gated append keeps the producer's order: the message lands before the events behind it", async () => {
  const { listener, collect, leaf, close } = await openStream({}, leafLanding("entry-9", "assistant"));
  try {
    listener(assistantEnd());
    listener({ type: "tool_execution_end", toolCallId: "call-1", toolName: "read", result: { content: [] } });
    leaf.advance();
    const events = await collect(2);
    assert.deepEqual(events.map((event) => event.type), ["message_end", "tool_execution_end"],
      "the one-microtask wait for the entry id must not reorder the stream");
    assert.equal(events[0].entryId, "entry-9");
  } finally {
    await close();
  }
});

test("a tool result's screenshot is deferred on the live path, so a screenshot run streams frames, not files", async () => {
  const bigImage = "S".repeat(4 * 1024 * 1024);
  const event = {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: bigImage } }],
      isError: false,
      timestamp: 1,
    },
  };
  const { listener, collect, leaf, close } = await openStream({}, leafLanding("entry-3", "toolResult"));
  try {
    listener(event);
    leaf.advance();
    const [wire] = await collect(1);
    assert.equal(wire.entryId, "entry-3");
    assert.equal(wire.deferredContent, true);
    assert.equal(wire.message.content[0].source.type, "url");
    assert.equal(
      wire.message.content[0].source.url,
      `/api/sessions/${SESSION}/entries/entry-3/tool-result-image?blockIndex=0`,
    );
    const bytes = JSON.stringify(wire).length;
    assert.ok(bytes < 2_000, `the frame is ${bytes} bytes instead of ${JSON.stringify(event).length}`);
  } finally {
    await close();
  }
});

test("delta mode: the growing part of a tool update is what crosses the wire", async () => {
  const { listener, collect, close } = await openStream({ deltaToolUpdates: true });
  try {
    const updates = [];
    let text = "";
    for (let index = 0; index < 4; index += 1) {
      text += `line ${index}\n`;
      updates.push({
        type: "tool_execution_update",
        toolCallId: "call-log",
        toolName: "bash",
        partialResult: { content: [{ type: "text", text }], details: { fullOutput: text }, isError: false },
      });
    }

    const wire = [];
    for (const update of updates) {
      listener(update);
      // One frame per coalescing window: the stream keeps the newest per tool call.
      wire.push(...await collect(1, TOOL_UPDATE_COALESCE_MS + 500));
      await new Promise((resolve) => setTimeout(resolve, TOOL_UPDATE_COALESCE_MS + 20));
    }

    const toolFrames = wire.filter((event) => event.type === "tool_execution_update");
    assert.equal(toolFrames.length, updates.length, "every update reaches the page, in order");
    assert.equal(toolFrames[0].mode, "full");
    assert.equal(toolFrames[1].mode, "delta");
    assert.equal(toolFrames[1].base, 1);
    assert.equal(toolFrames[1].textAppend, "line 1\n");
    assert.equal(toolFrames[1].partialResult, undefined, "the whole partial result is not resent");

    const deltaBytes = wire.reduce((sum, event) => sum + JSON.stringify(event).length, 0);
    const fullBytes = updates.reduce((sum, event) => sum + JSON.stringify(event).length, 0);
    assert.ok(deltaBytes < fullBytes, `delta wire ${deltaBytes} B vs full wire ${fullBytes} B`);

    listener({ type: "tool_execution_end", toolCallId: "call-log", toolName: "bash", result: { content: [] } });
    const end = await collect(1);
    assert.equal(end[0].type, "tool_execution_end");
  } finally {
    await close();
  }
});

test("delta mode is opt-in: a client that did not ask gets the snapshots it can render alone", async () => {
  const { listener, collect, close } = await openStream({});
  try {
    listener({ type: "tool_execution_update", toolCallId: "c", toolName: "bash", partialResult: { content: [{ type: "text", text: "a" }] } });
    const [first] = await collect(1, TOOL_UPDATE_COALESCE_MS + 500);
    listener({ type: "tool_execution_update", toolCallId: "c", toolName: "bash", partialResult: { content: [{ type: "text", text: "ab" }] } });
    const [second] = await collect(1, TOOL_UPDATE_COALESCE_MS + 500);
    assert.equal(first.partialResult.content[0].text, "a");
    assert.equal(second.mode, undefined, "no mode field: the old client contract");
    assert.equal(second.partialResult.content[0].text, "ab");
  } finally {
    await close();
  }
});

test("an oversized event is cut to its budget, and the frame says so and points at the full text", async () => {
  const { listener, collect, leaf, close } = await openStream({ maxEventPayloadBytes: 64 * 1024 }, leafLanding("entry-6", "toolResult"));
  try {
    const event = toolResultEnd("L".repeat(400 * 1024));
    listener(event);
    leaf.advance();
    const [wire] = await collect(1);
    const bytes = JSON.stringify(wire).length;
    assert.ok(bytes <= 64 * 1024 + 512, `the frame is ${bytes} bytes against a 64 KiB budget`);
    assert.equal(wire.message.toolCallId, "call-1", "the card the update belongs to stays addressable");
    assert.equal(wire.message.timestamp, 7);
    const marker = wire.payloadTruncated;
    assert.ok(marker, "a shortened value must not look complete");
    assert.ok(marker.chars > 300 * 1024);
    // The append flush named the entry (Phase 5), and the cut (Phase 7) uses it:
    // the card is pointed at the session entry that keeps the whole text.
    assert.equal(wire.entryId, "entry-6");
    assert.equal(
      marker.contentUrl,
      "/api/sessions/session-phases/entries/entry-6/tool-result-content?blockIndex=0",
      `the card is pointed at the entry's text: ${marker.contentUrl}`,
    );
  } finally {
    await close();
  }
});

test("a stream with the budget switched off forwards an oversized event untouched", async () => {
  const { listener, collect, leaf, close } = await openStream({ maxEventPayloadBytes: 0 }, leafLanding("entry-6", "toolResult"));
  try {
    const event = toolResultEnd("L".repeat(400 * 1024));
    listener(event);
    leaf.advance();
    const [wire] = await collect(1);
    assert.equal(wire.payloadTruncated, undefined);
    assert.equal(wire.message.content[0].text.length, 400 * 1024);
  } finally {
    await close();
  }
});
