import type { SessionInfo } from "./types";
import { sessionMentionTitle } from "./session-reference";

// The sidebar's search box, the project groups' folds and the archive's rows answer one
// question: does this session match what the user typed? The rule lives here so the title
// search, the prompt search, and the row's own title (the rule `#<title>` mentions use,
// lib/session-reference.ts) cannot drift apart. The server-side whole-transcript search
// (lib/session-search.ts, the sidebar's "search all" confirmation) is a different question.

/** The query as the search reads it: trimmed, case-folded. An empty query matches everything. */
export function normalizeSessionQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * The text a query can match for one session: the title the row shows (the name the user gave
 * it, else the first prompt cut the way the row cuts it) and the whole first prompt. Whitespace
 * is folded, so a query typed on one line finds a prompt that wrapped over several.
 */
export function sessionSearchNeedles(session: SessionInfo): string[] {
  const prompt = (session.firstMessage ?? "").replace(/\s+/g, " ").trim();
  const title = sessionMentionTitle({
    ...(session.name ? { name: session.name } : {}),
    firstMessage: prompt,
    id: session.id,
  }).replace(/\s+/g, " ").trim();
  return [...new Set([title, prompt].filter((needle) => needle.length > 0))];
}

/** True when the query is empty, or one of the session's needles contains it, case-insensitively. */
export function matchesSessionQuery(session: SessionInfo, query: string): boolean {
  const needle = normalizeSessionQuery(query);
  if (!needle) return true;
  return sessionSearchNeedles(session).some((text) => text.toLowerCase().includes(needle));
}

/**
 * The sessions a query keeps, in the order it was given: the caller groups them into projects
 * and chats, and a filter that re-sorted them would reorder the sidebar for a search alone.
 */
export function filterSessionsByQuery(sessions: readonly SessionInfo[], query: string): SessionInfo[] {
  const needle = normalizeSessionQuery(query);
  if (!needle) return [...sessions];
  return sessions.filter((session) => matchesSessionQuery(session, needle));
}
