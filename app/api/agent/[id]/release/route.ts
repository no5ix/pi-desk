import { NextResponse } from "next/server";
import { getRpcSession } from "@/lib/rpc-manager";

// POST /api/agent/[id]/release — the page reported that it left this session
// (a switch to another session, a closed tab, a closed side chat). While a page
// has a session selected it renews the lease every 30 seconds, and every renewal
// starts the idle countdown over, so "I am gone" is news the server only learns
// here. The wrapper answers by shortening its own countdown to the release grace
// (PI_WEB_RELEASE_GRACE_MS), which outlives the reconnect a session switch
// causes and never touches a run in progress: the timer re-arms while the
// session runs.
//
// A release with an event stream attached is not a release: another tab is
// watching. Nothing is started here — a session the server holds nothing for
// stays a session the server holds nothing for.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getRpcSession(id);
  const alive = Boolean(session?.isAlive());
  // A wrapper built before a hot reload lacks the method; its own timer still runs.
  const released = alive
    && !session!.hasEventListeners()
    && typeof session!.releaseIdleTimer === "function";
  if (released) session!.releaseIdleTimer();
  return NextResponse.json({
    success: true,
    released,
    // What the wrapper is doing, for a page that logs the release of a session it
    // just left: a running session is not shut down by this.
    running: alive && session!.isRunning(),
  }, { headers: { "Cache-Control": "no-store" } });
}
