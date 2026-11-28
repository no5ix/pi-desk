import { NextResponse } from "next/server";
import { readSessionEntryById } from "@/lib/session-entry-read";

/**
 * The full text of one tool-result content block, for a card whose live copy
 * was cut to the per-event payload budget (lib/event-payload-limit.ts).
 *
 * A tool result that arrives over the event stream is the run's own bytes; a
 * result bigger than one event's budget is cut in the structure, marked
 * `payloadTruncated`, and pointed here. The session entry is the authoritative
 * copy, so nothing is lost: the card says "shortened in this stream" and loads
 * the whole block on demand.
 *
 * Mirrors the deferred thinking route: an open session answers from its
 * in-memory `SessionManager`, otherwise from the file.
 */

/** One block of text this route serves. Bigger blocks answer with a bounded head. */
const MAX_SERVED_CHARS = 4 * 1024 * 1024;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const { id, entryId } = await params;
  const blockIndexParam = new URL(req.url).searchParams.get("blockIndex");
  const blockIndex = blockIndexParam === null ? Number.NaN : Number(blockIndexParam);
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
    return NextResponse.json({ error: "Valid blockIndex is required" }, { status: 400 });
  }
  try {
    const read = await readSessionEntryById(id, entryId);
    if (!read) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const { entry } = read;
    if (!entry || entry.type !== "message" || entry.message.role !== "toolResult") {
      return NextResponse.json({ error: "Tool result not found" }, { status: 404 });
    }
    const block = entry.message.content[blockIndex];
    if (!block) return NextResponse.json({ error: "Content block not found" }, { status: 404 });
    const text = block.type === "text" && typeof block.text === "string"
      ? block.text
      : JSON.stringify(block, null, 2);
    if (text === undefined) return NextResponse.json({ error: "Content block is not text" }, { status: 415 });
    const truncated = text.length > MAX_SERVED_CHARS;
    return NextResponse.json({
      text: truncated ? text.slice(0, MAX_SERVED_CHARS) : text,
      truncated,
      bytes: text.length,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
