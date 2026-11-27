import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { searchSessionContents } from "@/lib/session-search";
import { searchSessionPrompts } from "@/lib/session-prompt-search";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * `scope=text` (the default) scans the transcripts, which is the slow question and what Enter
 * asks. `scope=prompts` reads only what the user asked, through the calendar's cached prompt
 * reader, which is cheap enough for the sidebar's search box to run while typing.
 */
const SCOPES = new Set(["text", "prompts"]);

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim();
  const scope = params.get("scope") ?? "text";
  const headers = { "Cache-Control": "no-store" };
  if (!SCOPES.has(scope)) {
    return NextResponse.json({ error: "scope must be text or prompts" }, { status: 400, headers });
  }
  if (query.length > 200) {
    return NextResponse.json({ error: "Search query exceeds 200 characters" }, { status: 400, headers });
  }
  try {
    // Paths come only from the same catalog used by the sidebar. `allowStale`
    // keeps the request off the catalogue rebuild path: agent activity
    // invalidates the scan constantly, and rebuilding it costs hundreds of
    // milliseconds because loadAllSessions() re-reads every forked and subagent
    // session. The trade-off is that a session created in the last couple of
    // seconds is not searched yet; the stale read schedules the rebuild, so the
    // next search sees it.
    const sessions = query && !request.signal.aborted ? await listAllSessions({ allowStale: true }) : [];
    // A side chat copies its parent's whole text and never opens as the main chat.
    const searchable = sessions.filter((session) => session.relation?.kind !== "side");
    const search = scope === "prompts" ? searchSessionPrompts : searchSessionContents;
    return NextResponse.json(await search(searchable, query, request.signal), { headers });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500, headers });
  }
}
