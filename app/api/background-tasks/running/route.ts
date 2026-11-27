import { NextResponse } from "next/server";
import { listBackgroundTasksRunning } from "@/lib/background-tasks/running-index";

export const dynamic = "force-dynamic";

/**
 * GET /api/background-tasks/running
 *
 * Which conversations in this process have background tasks running, as
 * `{ sessions: { [sessionId]: { running, unseenFailed, observedAt } } }`. The composer's stop
 * control and the sidebar's running mark read this, and the numbers are the extension's own
 * counts, recorded as its activations pushed them — this route adds nothing to them and keeps no
 * task list.
 */
export async function GET() {
  return NextResponse.json({ sessions: listBackgroundTasksRunning() });
}
