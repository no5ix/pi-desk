// The sidebar's search box answers a prompt the tree cannot: a phrase the user typed three
// turns ago. The tree sees a session's title and its first message (`lib/session-title-search.ts`);
// this reads every session's own prompts — the calendar's cached reader (`cachedSessionPrompts`),
// so a machine's files are parsed once and the second search over the same phrases is a memory
// walk. A whole-transcript search is a different, heavier question: `lib/session-search.ts`,
// which the box runs when Enter is pressed.
import { cachedSessionPrompts } from "./session-prompts";
import type { SessionSearchResponse, SessionSearchResult } from "./session-search";
import type { SessionInfo } from "./types";

const MAX_FILES = 500;
const MAX_RESULTS = 30;
const MAX_CONCURRENT_SCANS = 8;
/** A first pass over cold files is bounded; the cache makes the next pass a memory walk. */
const TIME_BUDGET_MS = 4000;
const SNIPPET_CHARS = 80;

/**
 * Sessions whose own prompts contain the query, newest session first. One result per session —
 * the row is the session, and picking it jumps to the prompt that answered.
 */
export async function searchSessionPrompts(
  sessions: readonly SessionInfo[],
  query: string,
  requestSignal?: AbortSignal,
): Promise<SessionSearchResponse> {
  const response: SessionSearchResponse = { results: [], truncated: false };
  const needle = query.trim();
  if (!needle) return response;
  if (needle.length > 200) throw new RangeError("Search query exceeds 200 characters");
  // Literal search: the snippet's offsets are counted in the prompt's own text.
  const matcher = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const deadline = Date.now() + TIME_BUDGET_MS;
  const candidates = sessions
    .filter((session) => !session.transient && session.path && session.relation?.kind !== "side")
    .sort((a, b) => b.modified.localeCompare(a.modified))
    .slice(0, MAX_FILES);

  let next = 0;
  const found: SessionSearchResult[] = [];
  const worker = async () => {
    while (next < candidates.length && !requestSignal?.aborted && Date.now() < deadline && found.length < MAX_RESULTS) {
      const session = candidates[next++];
      let prompts;
      try {
        prompts = await cachedSessionPrompts(session.path);
      } catch {
        response.truncated = true;
        continue;
      }
      const hit = prompts.find((prompt) => matcher.test(prompt.text));
      if (!hit) continue;
      const match = matcher.exec(hit.text)!;
      const start = match.index;
      const end = start + match[0].length;
      found.push({
        session,
        entryId: hit.entryId,
        blockIndex: 0,
        promptMatch: true,
        before: (start > SNIPPET_CHARS ? "..." : "") + hit.text.slice(Math.max(0, start - SNIPPET_CHARS), start).trimStart(),
        match: match[0],
        after: hit.text.slice(end, end + SNIPPET_CHARS) + (end + SNIPPET_CHARS < hit.text.length ? "..." : ""),
      });
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_SCANS, candidates.length) }, worker));
  if (next < candidates.length || found.length >= MAX_RESULTS || Date.now() >= deadline) response.truncated = true;
  // The scans run concurrently, so the order is imposed once they are in.
  response.results = found.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
  return response;
}
