import { NextResponse } from "next/server";
import { buildDebugSnapshot } from "@/lib/debug-snapshot";
import { applyMemoryPressure, collectGarbage } from "@/lib/server-memory";

export const dynamic = "force-dynamic";
// The registries it reads live in this Node process.
export const runtime = "nodejs";

const MAX_SESSION_ID_LENGTH = 512;

interface AgentDebugParams {
  sessionId: string | null;
  /** The metered view (lib/server-memory.ts). */
  memory: boolean;
  /** Run the pressure valve before answering (`memory=1&pressure=1`). */
  pressure: boolean;
  /** Collect now, when the process has `--expose-gc` (`memory=1&gc=1`). */
  gc: boolean;
}

function parseAgentDebugParams(url: string): AgentDebugParams {
  const searchParams = new URL(url).searchParams;
  const requested = searchParams.get("session");
  return {
    sessionId: requested && requested.length <= MAX_SESSION_ID_LENGTH ? requested : null,
    memory: searchParams.get("memory") === "1",
    pressure: searchParams.get("pressure") === "1",
    gc: searchParams.get("gc") === "1",
  };
}

// GET /api/agent/debug?session=<id>&memory=1 - The debug panel's server view: the global layer and
// the selected session's detail in one request, since over HTTP/1.1 each request competes for the
// browser's six connections. Reads only (lib/debug-snapshot.ts): never starts a wrapper, opens
// a stream or moves an idle timer. `memory=1` adds the metered view (lib/server-memory.ts), kept
// off the panel's two-second poll because it walks the long-lived stores. With it, `pressure=1`
// runs the release valve and `gc=1` collects now — the two knobs a memory investigation needs to
// see what a store is worth, and the route is local-only, so they are not a remote control.
export async function GET(req: Request) {
  const { sessionId, memory, pressure, gc } = parseAgentDebugParams(req.url);
  if (memory && pressure) await applyMemoryPressure("requested");
  const snapshot = buildDebugSnapshot(sessionId, Date.now(), { memory });
  if (memory && gc && snapshot.server.memory) snapshot.server.memory.gcRequested = collectGarbage();
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
