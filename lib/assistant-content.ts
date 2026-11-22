import type { AssistantContentBlock, TextContent } from "./types";

/**
 * True for anything shaped like an assistant content block.
 *
 * Deliberately loose about `type`: pi owns the block list, and a block type
 * this file has not caught up with yet must survive intact (the renderers
 * ignore an unknown `type`, which is what they already do). What is rejected
 * is a slot that holds no block at all — `undefined` from a hole in a sparse
 * array, `null` from a JSON round trip of one, a bare string, an array.
 */
export function isAssistantContentBlock(value: unknown): value is AssistantContentBlock {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return typeof (value as { type?: unknown }).type === "string";
}

/**
 * The block that stands in for a content slot with no block in it.
 *
 * A text block with empty text is what a streaming `*_start` already puts in
 * every block before its first delta, so a gap renders as nothing and reads as
 * nothing to the artifact scanner, the written-file collector and the answer
 * checks.
 */
export function emptyTextBlock(): TextContent {
  return { type: "text", text: "" };
}

/**
 * A dense copy of an assistant message's content, same length, same positions.
 *
 * Assistant content arrives from three places — a session file, the wire's
 * message snapshots, and the client's own streaming reducer — and all three
 * can carry a slot with no block in it: pi's provider builders assign
 * `content[contentIndex]`, so a block this client never saw start (a reconnect
 * mid-run, a late `*_end` after a snapshot reset) leaves a hole behind, and
 * holes survive `[...content]` as `undefined`. Code that iterates content with
 * `for…of`, `.some`, `.every` or spread reads that `undefined` and dies on
 * `block.type`; `.filter`/`.map` skip holes, which is why only some screens
 * crash. Producers call this so no such slot ever reaches React state;
 * consumers call it as a guard, because a session file is not ours to fix.
 *
 * Positions are kept on purpose: the wire numbers its deltas by content index,
 * so dropping a slot would apply every later delta to the wrong block.
 */
export function fillContentGaps(content: readonly unknown[] | undefined | null): AssistantContentBlock[] {
  if (!Array.isArray(content)) return [];
  const blocks: AssistantContentBlock[] = [];
  for (const block of content) {
    blocks.push(isAssistantContentBlock(block) ? block : emptyTextBlock());
  }
  return blocks;
}
