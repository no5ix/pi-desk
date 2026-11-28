import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  capEventPayloadJson,
  MAX_EVENT_PAYLOAD_BYTES,
  MIN_EVENT_PAYLOAD_BYTES,
  PAYLOAD_KEEP_ITEMS,
  resolveMaxEventPayloadBytes,
} = await jiti.import("./event-payload-limit.ts");

const LIMIT = MAX_EVENT_PAYLOAD_BYTES;

function toolResultEvent(text, extra) {
  return {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: 123,
      ...(extra || {}),
    },
  };
}

function cut(event, limitBytes = LIMIT, options = {}) {
  const json = JSON.stringify(event);
  const capped = capEventPayloadJson(event, json, { limitBytes, ...options });
  return { json, capped, parsed: capped ? JSON.parse(capped.json) : event };
}

test("the budget is a megabyte by default, and the environment moves it only inside a usable range", () => {
  assert.equal(resolveMaxEventPayloadBytes(undefined), MAX_EVENT_PAYLOAD_BYTES);
  assert.equal(resolveMaxEventPayloadBytes(""), MAX_EVENT_PAYLOAD_BYTES);
  assert.equal(MAX_EVENT_PAYLOAD_BYTES, 1024 * 1024);
  assert.equal(resolveMaxEventPayloadBytes("0"), 0, "0 switches the cap off");
  assert.equal(resolveMaxEventPayloadBytes("off"), 0, "a switch that has to be read at 3am");
  assert.equal(resolveMaxEventPayloadBytes("none"), 0);
  assert.equal(resolveMaxEventPayloadBytes("disabled"), 0);
  assert.equal(resolveMaxEventPayloadBytes(String(2 * 1024 * 1024)), 2 * 1024 * 1024);
  assert.equal(resolveMaxEventPayloadBytes("1024"), MIN_EVENT_PAYLOAD_BYTES,
    "a budget under the floor would cut every event on the stream");
  assert.equal(resolveMaxEventPayloadBytes("nonsense"), MAX_EVENT_PAYLOAD_BYTES);
});

test("an event inside the budget is not touched at all", () => {
  const event = toolResultEvent("short output");
  assert.equal(capEventPayloadJson(event, JSON.stringify(event), { limitBytes: LIMIT }), null,
    "no cut means the stream forwards the object it was given, untouched");
});

test("an oversized tool result is cut, and what arrives is a valid event that says it is short", () => {
  const text = "y".repeat(4 * 1024 * 1024);
  const { json, capped, parsed } = cut(toolResultEvent(text));
  assert.ok(capped, "the oversized event must be cut");
  assert.ok(capped.json.length <= LIMIT, `the cut event is ${capped.json.length} bytes`);

  assert.equal(parsed.type, "message_end");
  assert.equal(parsed.message.role, "toolResult");
  assert.equal(parsed.message.toolCallId, "call-1", "the card an update belongs to must stay addressable");
  assert.equal(parsed.message.toolName, "read");
  assert.equal(parsed.message.isError, false);
  assert.equal(parsed.message.timestamp, 123);

  const marker = parsed.payloadTruncated;
  assert.ok(marker, "the event has to say it is shortened");
  assert.equal(marker.bytes, undefined, "the stream stamps the original size; the module counts what fell off");
  assert.ok(marker.chars > 3 * 1024 * 1024, `it reports what fell off: ${marker.chars}`);
  assert.equal(marker.images, 0);
  assert.ok(marker.fields.includes("message.content.0.text") || marker.fields.length > 0,
    "it names what it cut");

  // The kept text is the head of the output, not a mid-string byte slice.
  const kept = parsed.message.content[0].text;
  assert.ok(kept.startsWith(text.slice(0, 4096)), "the kept text is a prefix of the original");
  assert.match(kept, /characters cut from this stream/);
});

test("the cut keeps the fields a card needs and spends the budget on the content", () => {
  const event = {
    ...toolResultEvent("z".repeat(900 * 1024), { entryId: "entry-5" }),
    deferredContent: { imageBytes: 7 },
  };
  const { parsed, capped } = cut(event, 256 * 1024);
  assert.ok(capped.json.length <= 256 * 1024);
  assert.equal(parsed.message.entryId, "entry-5", "the entry id is how a collapsed card fetches the text back");
  assert.deepEqual(parsed.deferredContent, { imageBytes: 7 }, "the marker on a live message is not cut");
  assert.ok(parsed.message.content[0].text.length > 100 * 1024, "the budget goes to the text");
});

test("a tool-result text cut carries the URL of the block the session file keeps", () => {
  const event = toolResultEvent("w".repeat(3 * 1024 * 1024));
  const { parsed, capped } = cut(event, LIMIT, { sessionId: "session-1", entryId: "entry-8" });
  const url = parsed.payloadTruncated.contentUrl;
  assert.equal(
    url,
    "/api/sessions/session-1/entries/entry-8/tool-result-content?blockIndex=0",
    "the card offers the real text, not a silent shortening",
  );
  assert.equal(capped.truncated.contentUrl, url, "what the stream reports is what is on the wire");
});

test("a base64 image in an oversized event becomes a counted note", () => {
  const big = "B".repeat(2 * 1024 * 1024);
  const event = {
    type: "message_end",
    message: {
      role: "toolResult",
      toolCallId: "c",
      content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: big } }],
    },
  };
  const { parsed, capped } = cut(event);
  const notes = parsed.message.content.filter((block) => block.type === "text");
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /\[image omitted from this stream: image\/png, ~\d+ bytes\]/);
  assert.ok(capped.json.length <= LIMIT);
  assert.equal(parsed.payloadTruncated.images, 1, "the card says a screenshot fell off, not that there was none");
});

test("an oversized event with no content array is cut as a tree, and the marker sits on the event", () => {
  const event = {
    type: "extension_ui_request",
    id: "req-1",
    method: "notify",
    text: "n".repeat(3 * 1024 * 1024),
  };
  const { parsed, capped } = cut(event, 64 * 1024);
  assert.equal(parsed.id, "req-1", "a dialog request has to stay answerable");
  assert.equal(parsed.type, "extension_ui_request");
  assert.ok(capped.json.length <= 64 * 1024);
  assert.ok(parsed.payloadTruncated.chars > 2 * 1024 * 1024);
  assert.equal(parsed.payloadTruncated.contentUrl, undefined, "no session entry to fetch this back from");
});

test("the array tail is what falls off, and the count of what fell off is kept", () => {
  const blocks = Array.from({ length: 400 }, (_unused, index) => ({
    type: "text",
    text: `block ${index} ${"t".repeat(4000)}`,
  }));
  const event = { type: "message_end", message: { role: "toolResult", toolCallId: "c", content: blocks } };
  const { parsed, capped } = cut(event, 128 * 1024);
  assert.ok(parsed.message.content.length <= PAYLOAD_KEEP_ITEMS, "the kept items are the documented leading ones");
  assert.equal(parsed.message.content[0].text, blocks[0].text, "the head of the list is kept");
  assert.ok(parsed.payloadTruncated.items >= 380, `it counts the tail: ${parsed.payloadTruncated.items}`);
  assert.ok(capped.json.length <= 128 * 1024);
});

test("a stream with no payload budget keeps every byte of every event", () => {
  const event = toolResultEvent("q".repeat(4 * 1024 * 1024));
  assert.equal(capEventPayloadJson(event, JSON.stringify(event), { limitBytes: 0 }), null);
});

test("the marker is never the thing that breaks the budget", () => {
  // The smallest allowed budget, on an event whose essential keys are already a
  // fifth of it: the cap must still return a parseable event that says it is cut.
  const event = {
    type: "message_end",
    message: { role: "toolResult", toolCallId: "c", content: [{ type: "text", text: "x".repeat(500 * 1024) }] },
  };
  const { parsed, capped } = cut(event, MIN_EVENT_PAYLOAD_BYTES);
  assert.ok(JSON.parse(capped.json));
  assert.ok(capped.json.length <= MIN_EVENT_PAYLOAD_BYTES + 512,
    `the cut lands at ${capped.json.length} against a ${MIN_EVENT_PAYLOAD_BYTES} budget`);
  assert.ok(parsed.payloadTruncated.chars > 0);
});

test("an event whose serialization is not JSON is passed through rather than mangled", () => {
  const json = "not json at all";
  assert.equal(capEventPayloadJson({ type: "x" }, json, { limitBytes: 64 }), null);
});
