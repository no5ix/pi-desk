import { NextResponse } from "next/server";
import { readLastRunTimes } from "@/lib/session-last-run";
import { resolveSessionPath } from "@/lib/session-reader";

/**
 * GET /api/sessions/[id]/last-run  →  { startedAt, endedAt }
 *
 * The span of the session's last run, for the completion notification ("The task
 * lasted …, started at …, and ended at …").
 *
 * A page has those times only for a run it saw begin. A task started from a phone
 * over the relay, a queued prompt, a page reloaded mid-run, an extension-triggered
 * run: the page has none, and the notification used to be dropped. The session file
 * knows, and this route reads its tail (`lib/session-last-run.ts`) — the same
 * information `/api/sessions/[id]` already exposes, so no new file access and no
 * new authority.
 *
 * 404 when the session is unknown, unreadable, or has no run in it (nothing to
 * announce), which the caller reads as "say nothing".
 */

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "session id is required" }, { status: 400 });
  try {
    const sessionPath = await resolveSessionPath(id);
    if (!sessionPath) {
      return NextResponse.json({ error: "session not found" }, { status: 404 });
    }
    const times = await readLastRunTimes(sessionPath);
    if (!times) {
      return NextResponse.json({ error: "this session has no finished run" }, { status: 404 });
    }
    return NextResponse.json(times);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
