import { NextResponse } from "next/server";
import {
  readBackgroundTaskDetail,
  readBackgroundTaskLogs,
} from "@/lib/background-tasks/service";
import { backgroundTaskLogWindowBytes } from "@/lib/background-tasks/session-view";

export const dynamic = "force-dynamic";

/**
 * GET /api/background-tasks/task?session=&taskId=&type=detail|logs
 *
 * One task, read from the activation that owns it.
 *
 * `type=logs` returns one bounded window (`maxBytes`, at most the extension's 64 KiB, and
 * `tail` — the end is what a following view wants) and reports the exact byte range, so the
 * viewer knows when the log is longer than what it shows. The panel asks for a small window
 * on a timer while a task runs; it never re-downloads a whole log, because the host interface
 * answers a window and says how many bytes the task has written.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session");
  const taskId = url.searchParams.get("taskId");
  if (!sessionId) return NextResponse.json({ error: "session is required" }, { status: 400 });
  if (!taskId) return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  const type = url.searchParams.get("type") ?? "detail";
  if (type === "logs") {
    const maxBytes = backgroundTaskLogWindowBytes(
      url.searchParams.get("maxBytes") === null
        ? undefined
        : Number.parseInt(url.searchParams.get("maxBytes") ?? "", 10),
    );
    const tail = url.searchParams.get("tail") !== "false";
    const result = await readBackgroundTaskLogs(sessionId, taskId, { maxBytes, tail });
    return NextResponse.json({ ...result, maxBytes }, { status: result.ok ? 200 : 409 });
  }
  if (type !== "detail") {
    return NextResponse.json({ error: "type must be detail or logs" }, { status: 400 });
  }
  const result = await readBackgroundTaskDetail(sessionId, taskId);
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
