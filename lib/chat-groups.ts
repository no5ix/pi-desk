import type { SessionFamily } from "./session-family";

/**
 * How the sidebar's Chats section orders its chats: pinned ones first, then by how recently
 * they were active. Rows already show their own relative time, so there are no date groups.
 */
export function orderChatFamilies(
  families: readonly SessionFamily[],
  pinnedIds: ReadonlySet<string>,
  runningIds?: ReadonlySet<string>,
): SessionFamily[] {
  const byRecency = [...families].sort((a, b) => b.latestModified.localeCompare(a.latestModified));
  return pinnedThenRunning(
    byRecency,
    (family) => pinnedIds.has(family.root.id),
    (family) => (runningIds ? familyHasRunningSession(family, runningIds) : false),
  );
}

/** The pinned items first, each part in its given order (a project's pinned sessions, S2). */
export function pinnedFirst<T>(items: readonly T[], isPinned: (item: T) => boolean): T[] {
  return [...items.filter(isPinned), ...items.filter((item) => !isPinned(item))];
}

/**
 * Pinned items first, then the running ones, then the rest; every part keeps the order it was
 * given (a project's session rows, in recency order). The running tier exists because a folded
 * preview must never bury a session that is live right now: pins, then runs, then plain recency.
 */
export function pinnedThenRunning<T>(
  items: readonly T[],
  isPinned: (item: T) => boolean,
  isRunning: (item: T) => boolean,
): T[] {
  const unpinned = items.filter((item) => !isPinned(item));
  return [
    ...items.filter((item) => isPinned(item)),
    ...unpinned.filter((item) => isRunning(item)),
    ...unpinned.filter((item) => !isRunning(item)),
  ];
}

/** A family is live when its own session, or a run under it, is running. */
export function familyHasRunningSession(
  family: { root: { id: string }; subagents: readonly { id: string }[] },
  runningIds: ReadonlySet<string>,
): boolean {
  return runningIds.has(family.root.id)
    || family.subagents.some((session) => runningIds.has(session.id));
}

/** Toggle one id in an id set, returning a new set (React state friendly). */
export function toggleId(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
