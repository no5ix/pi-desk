import { NextResponse } from "next/server";
import { buildDebugSnapshot } from "@/lib/debug-snapshot";

export const dynamic = "force-dynamic";
// The registries it reads live in this Node process.
export const runtime = "nodejs";

const MAX_SESSION_ID_LENGTH = 512;

// GET /api/agent/debug?session=<id>&memory=1 - The debug panel's server view: the global layer and
// the selected session's detail in one request, since over HTTP/1.1 each request competes for the
// browser's six connections. Reads only (lib/debug-snapshot.ts): never starts a wrapper, opens
// a stream or moves an idle timer. `memory=1` adds the metered view (lib/server-memory.ts), kept
// off the panel's two-second poll because it walks the long-lived stores.
export async function GET(req: Request) {
  const searchParams = new URL(req.url).searchParams;
  const requested = searchParams.get("session");
  const sessionId = requested && requested.length <= MAX_SESSION_ID_LENGTH ? requested : null;
  return NextResponse.json(
    buildDebugSnapshot(sessionId, Date.now(), { memory: searchParams.get("memory") === "1" }),
    { headers: { "Cache-Control": "no-store" } },
  );
}
