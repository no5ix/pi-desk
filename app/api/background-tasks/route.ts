import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { BG_HOST_MAX_PAGE_SIZE } from "@/lib/background-tasks/protocol";
import {
  readBackgroundTasksSnapshot,
  runBackgroundTasksAction,
  type BackgroundTasksActionPayload,
} from "@/lib/background-tasks/service";

export const dynamic = "force-dynamic";

/** The conversations the panel lists, named the way the sidebar names them. */
async function readSessionNames(sessionIds: string[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  if (sessionIds.length === 0) return names;
  const wanted = new Set(sessionIds);
  try {
    for (const session of await listAllSessions({ allowStale: true })) {
      if (!wanted.has(session.id)) continue;
      names[session.id] = session.name?.trim() || session.firstMessage?.trim().slice(0, 80) || session.id;
    }
  } catch {
    // A name is a label. A session list that cannot be read leaves the ids, not an error.
  }
  for (const id of sessionIds) if (!names[id]) names[id] = id;
  return names;
}

function parseLimit(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(BG_HOST_MAX_PAGE_SIZE, value);
}

/** Per-activation cursors, as `cursors=<sessionId>:<cursor>,<sessionId>:<cursor>`. */
function parseCursors(raw: string | null): Record<string, string> {
  if (!raw) return {};
  const cursors: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const index = pair.indexOf(":");
    if (index <= 0) continue;
    const sessionId = pair.slice(0, index);
    const cursor = pair.slice(index + 1);
    if (sessionId.length > 0 && cursor.length > 0 && cursor.length <= 512) cursors[sessionId] = cursor;
  }
  return cursors;
}

/**
 * GET /api/background-tasks?session=&limit=&cursors=
 *
 * The panel's snapshot: the merged task list of this project's live conversations, the
 * extension's counts, and the availability state. Nothing is cached here — the extension's
 * registry is the only task list, and a page that shows a stale copy of it is worse than one
 * that shows nothing.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  if (!sessionId) {
    return NextResponse.json({ error: "session is required" }, { status: 400 });
  }
  const snapshot = await readBackgroundTasksSnapshot(sessionId, {
    limit: parseLimit(url.searchParams.get("limit")),
    cursors: parseCursors(url.searchParams.get("cursors")),
  });
  const sessionNames = await readSessionNames(snapshot.sessions.map((session) => session.sessionId));
  return NextResponse.json({ ...snapshot, sessionNames });
}

/**
 * POST /api/background-tasks { session, action, taskId | taskIds }
 *
 * One task operation: `stop`, `stop-all`, `rerun`, `mark-seen`. The answer is the extension's
 * — `stop` resolves only after the process settled, `rerun` answers `NOT_RERUNNABLE` for a
 * task kind whose owning tool must relaunch it, and `mark-seen` marks the same seen set the
 * extension's dock and `/bg-clear` use. A failure carries the documented `code`.
 */
export async function POST(request: Request) {
  let body: { session?: unknown; action?: unknown; taskId?: unknown; taskIds?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const sessionId = typeof body.session === "string" ? body.session : "";
  if (!sessionId) return NextResponse.json({ error: "session is required" }, { status: 400 });
  const kind = body.action;
  if (kind !== "stop" && kind !== "stop-all" && kind !== "rerun" && kind !== "mark-seen") {
    return NextResponse.json({ error: "action must be stop, stop-all, rerun or mark-seen" }, { status: 400 });
  }
  const payload: BackgroundTasksActionPayload = {
    kind,
    ...(typeof body.taskId === "string" ? { taskId: body.taskId } : {}),
    ...(Array.isArray(body.taskIds)
      ? { taskIds: body.taskIds.filter((id): id is string => typeof id === "string") }
      : {}),
  };
  const outcome = await runBackgroundTasksAction(sessionId, payload);
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 409 });
}
