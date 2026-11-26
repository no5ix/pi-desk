import type { SessionFamily } from "./session-family";

/**
 * The three sets a sidebar list reads to place a row: the pins the user set, the unread
 * results, the live work. All three are per-list state the sidebar already holds.
 */
export interface SidebarPreviewState {
  pinnedIds: ReadonlySet<string>;
  unreadIds?: ReadonlySet<string>;
  runningIds?: ReadonlySet<string>;
}

/** The last tier: everything the user neither pinned, nor left unread, nor is running. */
export const PREVIEW_TIER_PLAIN = 3;

/** How the predicates answer for one row (a project group's tree node, a chat family). */
export interface PreviewPredicates<T> {
  isPinned: (item: T) => boolean;
  isUnread: (item: T) => boolean;
  isRunning: (item: T) => boolean;
}

/**
 * A row's place in the sidebar's preview window, in order:
 * 0 a pin the user put at the top, 1 an unread result they have not read yet,
 * 2 live work, 3 everything else (recency).
 *
 * An unread row that is *still running* has nothing to read yet, so it belongs to the running
 * tier; a finished row with unread output leads, because it is an answer waiting for the user.
 */
export function previewTier<T>(item: T, { isPinned, isUnread, isRunning }: PreviewPredicates<T>): number {
  if (isPinned(item)) return 0;
  if (isUnread(item) && !isRunning(item)) return 1;
  if (isRunning(item)) return 2;
  return PREVIEW_TIER_PLAIN;
}

/**
 * The rows in preview order — pins, unread finished rows, running rows, the rest — with every
 * tier keeping the order it was given (`Array.prototype.sort` is stable, so a list already in
 * recency order stays in it inside its tier).
 */
export function previewOrder<T>(items: readonly T[], predicates: PreviewPredicates<T>): T[] {
  const tierOf = new Map<T, number>();
  for (const item of items) tierOf.set(item, previewTier(item, predicates));
  return [...items].sort((a, b) => (tierOf.get(a) ?? 0) - (tierOf.get(b) ?? 0));
}

/**
 * The rows the preview window must always show: a pin, an unread result, live work. The order and
 * the window size come from the same tier rule, so the two can never drift apart.
 */
export function previewRowIsAlwaysVisible<T>(item: T, predicates: PreviewPredicates<T>): boolean {
  return previewTier(item, predicates) < PREVIEW_TIER_PLAIN;
}

/** The pinned items first, each part in its given order (a project's pinned sessions, S2). */
export function pinnedFirst<T>(items: readonly T[], isPinned: (item: T) => boolean): T[] {
  return [...items.filter(isPinned), ...items.filter((item) => !isPinned(item))];
}

/** A family is live when its own session, or a run under it, is running. */
export function familyHasRunningSession(
  family: { root: { id: string }; subagents: readonly { id: string }[] },
  runningIds: ReadonlySet<string> | undefined,
): boolean {
  return !!runningIds && (
    runningIds.has(family.root.id)
    || family.subagents.some((session) => runningIds.has(session.id))
  );
}

/** A family has a result to read when its own session, or a run under it, is unread. */
export function familyHasUnreadSession(
  family: { root: { id: string }; subagents: readonly { id: string }[] },
  unreadIds: ReadonlySet<string> | undefined,
): boolean {
  return !!unreadIds && (
    unreadIds.has(family.root.id)
    || family.subagents.some((session) => unreadIds.has(session.id))
  );
}

/** The predicates the Chats list uses for one family, from the sidebar's three sets. */
export function chatFamilyPredicates(state: SidebarPreviewState): PreviewPredicates<SessionFamily> {
  return {
    isPinned: (family) => state.pinnedIds.has(family.root.id),
    isUnread: (family) => familyHasUnreadSession(family, state.unreadIds),
    isRunning: (family) => familyHasRunningSession(family, state.runningIds),
  };
}

/**
 * How the sidebar's Chats section orders its chats: pins first, then the unread finished chats,
 * then the running ones, then by how recently they were active. Rows already show their own
 * relative time, so there are no date groups.
 */
export function orderChatFamilies(
  families: readonly SessionFamily[],
  state: SidebarPreviewState,
): SessionFamily[] {
  const byRecency = [...families].sort((a, b) => b.latestModified.localeCompare(a.latestModified));
  return previewOrder(byRecency, chatFamilyPredicates(state));
}

/** Toggle one id in an id set, returning a new set (React state friendly). */
export function toggleId(ids: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
