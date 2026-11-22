import { NextResponse } from "next/server";
import { buildSessionContext, openSessionManager, resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession } from "@/lib/rpc-manager";
import { buildSessionFileDiff } from "@/lib/session-file-diff";
import { hasParentDirectorySegment } from "@/lib/path-security";
import { isWindowsAbsolutePath } from "@/lib/file-access";
import type { AgentMessage } from "@/lib/types";

/**
 * The diff a session made to one file: `GET ?path=/abs/file`.
 *
 * The chat's `Edited files` card counts the lines the session's own
 * `write` / `edit` / `apply_patch` calls changed, so a file the agent changed
 * and then committed (or a working tree left clean) has no git diff for the
 * panel to show. This route answers with the hunks recorded in the session,
 * in the order they happened, in the same shape `/api/git/diff` returns so the
 * file viewer renders either from one diff view.
 *
 * Nothing is read from disk for the path: it is only the match key against the
 * calls in the session, so the answer is exactly what the session file already
 * exposes through `/api/sessions/[id]` (same auth, no file access).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const target = new URL(req.url).searchParams.get("path")?.trim() ?? "";
  if (!target || (!target.startsWith("/") && !isWindowsAbsolutePath(target))) {
    return NextResponse.json({ error: "path must be an absolute path" }, { status: 400 });
  }
  if (hasParentDirectorySegment(target)) {
    return NextResponse.json({ error: "path must not walk out of its folder" }, { status: 400 });
  }

  try {
    const rpc = getRpcSession(id);
    const liveRpc = rpc?.isAlive() ? rpc : undefined;
    const sessionPath = liveRpc ? null : await resolveSessionPath(id);
    if (!liveRpc && !sessionPath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const sm = liveRpc?.inner.sessionManager ?? openSessionManager(sessionPath!);
    const entries = sm.getEntries();
    const cwd = sm.getHeader()?.cwd ?? "";
    const context = buildSessionContext(entries as never, sm.getLeafId(), { deferThinking: true });
    const diff = buildSessionFileDiff(context.messages as unknown as AgentMessage[], target, cwd || undefined);
    if (!diff) return NextResponse.json({ supported: false, source: "session" });

    return NextResponse.json({
      supported: true,
      source: "session",
      status: diff.status,
      patch: diff.patch,
      additions: diff.additions,
      deletions: diff.deletions,
      changes: diff.changes,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
