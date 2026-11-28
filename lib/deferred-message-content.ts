import type { AgentMessage, ImageContent } from "./types";
import { getThinkingPreview } from "./message-display";
import { MAX_TOOL_RESULT_IMAGE_BYTES, TOOL_RESULT_IMAGE_MIMES } from "./tool-result-images";
import { isRecord } from "./is-record.ts";

/**
 * The deferred-content projection, shared by the two paths that hand messages to
 * the browser:
 *
 *  - history: `lib/session-reader.ts` builds a session page with
 *    `deferThinking` / `deferToolResultImages` (see `entryToUiMessage`);
 *  - live: `lib/agent-event-stream.ts` projects a message the run just
 *    finished before its `message_end` reaches the page (Phase 5).
 *
 * Both replace heavyweight content with what a collapsed card needs and leave a
 * retrieval pointer behind: a thinking block keeps a preview plus `deferred`,
 * and its full text is served by
 * `GET /api/sessions/[id]/entries/[entryId]/thinking?blockIndex=N`; a base64
 * tool-result image becomes a `type: "url"` source pointing at
 * `GET /api/sessions/[id]/entries/[entryId]/tool-result-image?blockIndex=N`.
 * Neither needs the block to stay in React state, which is the point: a
 * collapsed card holds a preview, and the page keeps a window of messages
 * (lib/chat-lazy-load.ts), not a transcript.
 */

/** A thinking block this long is not "small essential data": defer it. */
export const LIVE_DEFER_MIN_THINKING_CHARS = 1_024;

/** A base64 image this small stays inline — a fetch costs more than it saves. */
export const LIVE_DEFER_MIN_IMAGE_BYTES = 64 * 1024;

/** What one pass of the live projection gave up, for the bench and the tests. */
export interface DeferredContentReport {
  thinkingBlocks: number;
  thinkingChars: number;
  imageBlocks: number;
  imageBytes: number;
}

export function base64ImageInfo(block: unknown): { bytes: number; mime?: string } | null {
  if (!isRecord(block) || block.type !== "image") return null;

  let data: string | undefined;
  let mime: string | undefined;
  if (typeof block.data === "string") {
    data = block.data;
    mime = typeof block.mimeType === "string" ? block.mimeType : undefined;
  } else if (isRecord(block.source) && block.source.type === "base64" && typeof block.source.data === "string") {
    data = block.source.data;
    mime = typeof block.source.media_type === "string" ? block.source.media_type : undefined;
  }
  if (!data) return null;

  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return { bytes: Math.max(0, Math.floor(data.length * 3 / 4) - padding), mime };
}

/**
 * A tool result's base64 images become URL sources the browser only asks for
 * while the card is expanded, so the initial history response stays small.
 * Images of an unsupported type, of zero bytes, or bigger than
 * `MAX_TOOL_RESULT_IMAGE_BYTES` (the image route refuses them) cannot be served
 * that way: they are replaced with one counted note, which is what the callers
 * without a session id have always got.
 */
export function deferToolResultBase64Images(
  message: AgentMessage,
  sessionId: string | undefined,
  entryId: string,
): AgentMessage {
  if (message.role !== "toolResult") return message;

  let omitted = 0;
  let bytes = 0;
  const mimes = new Set<string>();
  const content = message.content.flatMap((block, blockIndex) => {
    const image = base64ImageInfo(block);
    if (!image) return [block];

    // Keep the initial history response small, but preserve an image block that
    // the browser can load only when its collapsed tool result is expanded.
    if (
      sessionId &&
      image.mime &&
      TOOL_RESULT_IMAGE_MIMES.has(image.mime) &&
      image.bytes > 0 &&
      image.bytes <= MAX_TOOL_RESULT_IMAGE_BYTES
    ) {
      const source: ImageContent["source"] = {
        type: "url",
        media_type: image.mime,
        url: `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/tool-result-image?blockIndex=${blockIndex}`,
      };
      return [{ type: "image", source } satisfies ImageContent];
    }

    // Retain the old bounded fallback for callers that do not have a session id.
    omitted += 1;
    bytes += image.bytes;
    if (image.mime) mimes.add(image.mime);
    return [];
  });
  if (omitted === 0) return { ...message, content };

  const mimeText = mimes.size > 0 ? `: ${[...mimes].join(", ")}` : "";
  content.push({
    type: "text",
    text: `[${omitted} tool result image${omitted === 1 ? "" : "s"} omitted from initial history payload${mimeText}, ~${bytes} bytes]`,
  });
  return { ...message, content };
}

/**
 * The history projection of one entry's content: every non-empty thinking block
 * becomes a preview marked `deferred`. Exported for the tests that pin the two
 * paths against each other.
 */
export function deferThinkingBlocks<T extends { content: unknown }>(message: T): T {
  const content = message.content;
  if (!Array.isArray(content)) return message;
  let changed = false;
  const next = content.map((block) => {
    if (isRecord(block) && block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim() !== "") {
      changed = true;
      return { ...block, thinking: getThinkingPreview(block.thinking), deferred: true };
    }
    return block;
  });
  return changed ? ({ ...message, content: next } as T) : message;
}

/**
 * Phase 5: the same retention semantics for a message a run has just finished,
 * before its `message_end` is written to the SSE stream. Without this, history
 * arrives slim and every live message lands in the page's message list with its
 * full reasoning and its full base64 screenshots, so the "loaded messages" the
 * page retains are exactly the messages of the run that is happening now.
 *
 * Unlike history, the live path never *drops* content: the page has no copy of
 * a message that is not in its list, and the image route only answers for an
 * entry that exists. So a message with no resolvable entry id is returned
 * unchanged — the full payload beats a card that can never expand.
 *
 * `minThinkingChars` / `minImageBytes` are the floor under which deferring
 * costs a round trip and saves nothing the browser did not already stream.
 */
export function deferLiveMessageContent(
  message: AgentMessage,
  options: {
    sessionId?: string;
    entryId?: string;
    minThinkingChars?: number;
    minImageBytes?: number;
  },
): { message: AgentMessage; deferred: DeferredContentReport } {
  const empty = { thinkingBlocks: 0, thinkingChars: 0, imageBlocks: 0, imageBytes: 0 };
  const { sessionId, entryId } = options;
  if (!sessionId || !entryId) return { message, deferred: empty };

  const minThinkingChars = options.minThinkingChars ?? LIVE_DEFER_MIN_THINKING_CHARS;
  const minImageBytes = options.minImageBytes ?? LIVE_DEFER_MIN_IMAGE_BYTES;

  let deferred: DeferredContentReport = { ...empty };

  if (message.role === "assistant" && Array.isArray(message.content)) {
    let changed = false;
    const content = (message.content as unknown as unknown[]).map((block) => {
      if (
        isRecord(block)
        && block.type === "thinking"
        && typeof block.thinking === "string"
        && block.thinking.length >= minThinkingChars
      ) {
        changed = true;
        deferred = {
          ...deferred,
          thinkingBlocks: deferred.thinkingBlocks + 1,
          thinkingChars: deferred.thinkingChars + block.thinking.length,
        };
        return { ...block, thinking: getThinkingPreview(block.thinking), deferred: true };
      }
      return block;
    });
    if (changed) message = { ...message, content } as AgentMessage;
  }

  if (message.role === "toolResult" || message.role === "user") {
    let images = 0;
    let imageBytes = 0;
    let changed = false;
    const content = (message.content as unknown[]).flatMap((block, blockIndex) => {
      const image = base64ImageInfo(block);
      if (!image || image.bytes < minImageBytes) return [block];
      if (!image.mime || !TOOL_RESULT_IMAGE_MIMES.has(image.mime)) return [block];
      if (image.bytes > MAX_TOOL_RESULT_IMAGE_BYTES) return [block];
      const source: ImageContent["source"] = {
        type: "url",
        media_type: image.mime,
        url: `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/tool-result-image?blockIndex=${blockIndex}`,
      };
      images += 1;
      imageBytes += image.bytes;
      changed = true;
      return [{ type: "image", source } satisfies ImageContent];
    });
    if (changed) {
      deferred = { ...deferred, imageBlocks: images, imageBytes };
      message = { ...message, content } as AgentMessage;
    }
  }

  return { message, deferred };
}
