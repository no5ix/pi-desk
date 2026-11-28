import test from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  deferLiveMessageContent,
  deferThinkingBlocks,
  deferToolResultBase64Images,
  LIVE_DEFER_MIN_IMAGE_BYTES,
  LIVE_DEFER_MIN_THINKING_CHARS,
} = await jiti.import("./deferred-message-content.ts");

const bigThinking = `${"a".repeat(1400)}\n${"b".repeat(1400)}`;
const bigImageBase64 = "A".repeat(Math.ceil(LIVE_DEFER_MIN_IMAGE_BYTES * 4 / 3) + 4);

function assistantWithThinking(thinking = bigThinking) {
  return {
    role: "assistant",
    content: [
      { type: "thinking", thinking },
      { type: "text", text: "the answer" },
    ],
    model: "m",
    provider: "p",
  };
}

function toolResultWithImage(bytes = bigImageBase64, mime = "image/png") {
  return {
    role: "toolResult",
    toolCallId: "call-1",
    toolName: "read",
    content: [
      { type: "text", text: "a screenshot" },
      { type: "image", source: { type: "base64", media_type: mime, data: bytes } },
    ],
  };
}

test("a live assistant reply keeps its text and defers its reasoning to the entry", () => {
  const { message, deferred } = deferLiveMessageContent(assistantWithThinking(), {
    sessionId: "session-1",
    entryId: "entry-9",
  });

  assert.equal(deferred.thinkingBlocks, 1);
  assert.equal(deferred.thinkingChars, bigThinking.length);
  const content = message.content;
  assert.equal(content[0].type, "thinking");
  assert.equal(content[0].deferred, true);
  // The preview is the same rule history uses, so a live card and a historical
  // card say the same thing about the same reasoning.
  assert.equal(content[0].thinking, "a".repeat(240), "the preview is the first line, capped");
  assert.equal(content[1].text, "the answer", "the visible reply is untouched");
  // Retrieval: the route the collapsed card already knows how to call.
  assert.ok(
    `/api/sessions/session-1/entries/entry-9/thinking?blockIndex=0`,
    "the thinking route is entry-scoped",
  );
});

test("reasoning below the floor stays inline: deferring it buys nothing", () => {
  const small = "short thought";
  const { message, deferred } = deferLiveMessageContent(assistantWithThinking(small), {
    sessionId: "session-1",
    entryId: "entry-9",
  });
  assert.equal(deferred.thinkingBlocks, 0);
  assert.equal(message.content[0].thinking, small);
  assert.equal(message.content[0].deferred, undefined);
  assert.ok(small.length < LIVE_DEFER_MIN_THINKING_CHARS);
});

test("a live tool result's screenshot becomes the URL the collapsed card loads", () => {
  const { message, deferred } = deferLiveMessageContent(toolResultWithImage(), {
    sessionId: "session-1",
    entryId: "entry-7",
  });
  assert.equal(deferred.imageBlocks, 1);
  assert.ok(deferred.imageBytes > LIVE_DEFER_MIN_IMAGE_BYTES);

  const image = message.content[1];
  assert.equal(image.type, "image");
  assert.equal(image.source.type, "url");
  assert.equal(image.source.media_type, "image/png");
  assert.equal(
    image.source.url,
    "/api/sessions/session-1/entries/entry-7/tool-result-image?blockIndex=1",
  );
  // The bytes are gone from the message, not copied into a second shape.
  assert.equal(image.source.data, undefined);
});

test("an attachment in a live user message is deferred the same way", () => {
  const message = {
    role: "user",
    content: [
      { type: "text", text: "look at this" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: bigImageBase64 } },
    ],
  };
  const { message: next, deferred } = deferLiveMessageContent(message, {
    sessionId: "s",
    entryId: "e",
  });
  assert.equal(deferred.imageBlocks, 1);
  assert.equal(next.content[1].source.type, "url");
  assert.ok(next.content[1].source.url.includes("/entries/e/tool-result-image?blockIndex=1"));
});

test("no entry to fetch from means no deferral: the live message keeps every byte", () => {
  const cases = [
    assistantWithThinking(),
    toolResultWithImage(),
  ];
  for (const message of cases) {
    const { message: kept, deferred } = deferLiveMessageContent(message, { sessionId: "session-1" });
    assert.equal(kept, message, "identity: the page keeps the message it was given");
    assert.equal(deferred.thinkingBlocks, 0);
    assert.equal(deferred.imageBlocks, 0);

    const withoutSession = deferLiveMessageContent(message, { entryId: "entry-1" });
    assert.equal(withoutSession.message, message);
  }
});

test("an image too small, too large or of an unknown type is kept, not dropped", () => {
  const small = deferLiveMessageContent(
    toolResultWithImage("A".repeat(64)),
    { sessionId: "s", entryId: "e" },
  );
  assert.equal(small.deferred.imageBlocks, 0, "below the floor: the fetch costs more than it saves");

  const huge = deferLiveMessageContent(
    toolResultWithImage("A".repeat(14 * 1024 * 1024)),
    { sessionId: "s", entryId: "e" },
  );
  assert.equal(huge.deferred.imageBlocks, 0, "over the route's cap: a card that cannot load is worse");

  const unknown = deferLiveMessageContent(
    toolResultWithImage(bigImageBase64, "image/tiff"),
    { sessionId: "s", entryId: "e" },
  );
  assert.equal(unknown.deferred.imageBlocks, 0, "the image route refuses that type");
});

test("the live and historical projections agree on the same thinking block", () => {
  const live = deferLiveMessageContent(assistantWithThinking(bigThinking), {
    sessionId: "s",
    entryId: "e",
  });
  const history = deferThinkingBlocks(assistantWithThinking(bigThinking));
  assert.equal(live.message.content[0].thinking, history.content[0].thinking);
  assert.equal(history.content[0].deferred, true);
});

test("an empty thinking block is left alone by both projections", () => {
  const message = { role: "assistant", content: [{ type: "thinking", thinking: "   " }], model: "m", provider: "p" };
  assert.equal(deferThinkingBlocks(message).content[0].deferred, undefined);
  const live = deferLiveMessageContent(message, { sessionId: "s", entryId: "e" });
  assert.equal(live.deferred.thinkingBlocks, 0);
});

test("history's projection still turns an oversized image into a counted note (no session id)", () => {
  const message = deferToolResultBase64Images(toolResultWithImage(), undefined, "entry-1");
  const notes = message.content.filter((block) => block.type === "text" && block.text.includes("omitted"));
  assert.equal(notes.length, 1, "the old bounded fallback survives");
});
