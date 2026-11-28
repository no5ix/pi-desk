export const VISIBLE_PAGE_SIZE = 50;
export const CHAT_SCROLL_TAIL_TOLERANCE = 8;
export const CHAT_SCROLL_REATTACH_TOLERANCE = 96;

export function getVisibleRenderWindow(totalCount: number, visibleCount: number): {
  startIndex: number;
  hasMore: boolean;
} {
  const clampedVisibleCount = Math.min(Math.max(visibleCount, 0), Math.max(totalCount, 0));
  const startIndex = Math.max(0, totalCount - clampedVisibleCount);
  return { startIndex, hasMore: startIndex > 0 };
}

export function getNextVisibleCount(currentVisibleCount: number, pageSize = VISIBLE_PAGE_SIZE): number {
  return currentVisibleCount + pageSize;
}

/**
 * The most history one chat page holds *by default*. The rendered window follows
 * the loaded count (a prepend must land inside the window the reader is scrolling
 * in), so the loaded count is what the tab keeps: rows, their DOM, their
 * highlighted code. A five-year session is thousands of entries.
 *
 * Phase 6 made this a real bound and not only a pagination hint: the loaded
 * window **slides**. Past the cap, the rows that fall off the head are dropped
 * from React state and the history cursor moves with them, so "load earlier"
 * keeps working (the rows come back from the server on demand) while the page
 * never holds more than the window it renders plus `LOADED_WINDOW_SLACK`.
 *
 * The cap follows an explicit navigation: jumping to a row the reader searched
 * for loads the rows that contain it, up to `MAX_NAVIGATED_LOADED_MESSAGES`.
 * `trimLoadedWindow` is the policy; `lib/chat-lazy-load.test.mjs` pins it.
 */
export const MAX_LOADED_MESSAGES = 600;

/** Rows kept behind the rendered window, so scrolling down needs no refetch. */
export const LOADED_WINDOW_SLACK = 120;

/** The most rows one explicit navigation (a search jump, a scroll restore) loads. */
export const MAX_NAVIGATED_LOADED_MESSAGES = 2_400;

/**
 * How many rows a page may keep loaded: what it renders plus slack, at least
 * `max`, never past the navigation bound. A cap that follows the window is the
 * only kind that cannot evict a row the reader is looking at.
 */
export function loadedWindowCap(
  visibleCount: number,
  max = MAX_LOADED_MESSAGES,
  navigated = MAX_NAVIGATED_LOADED_MESSAGES,
): number {
  const floor = Math.max(max, 0);
  const windowed = Math.max(0, visibleCount) + LOADED_WINDOW_SLACK;
  return Math.min(Math.max(floor, windowed), Math.max(floor, navigated));
}

/** What one pass of the retention policy left behind. */
export interface LoadedWindow<T> {
  messages: T[];
  entryIds: string[];
  /** Rows dropped from the head; 0 when the window still fits. */
  evicted: number;
  /** The oldest row this page has fetched: the "load earlier" cursor. */
  oldestEntryId: string | null;
}

/**
 * The loaded-window retention policy (Phase 6).
 *
 * Eviction is from the head only, because the rendered window is the tail
 * (`getVisibleRenderWindow`): the rows the reader stands on, the rows they are
 * reading, and the streaming tail are never touched. Rows named by
 * `keepEntryIds` (an anchor the viewport is attached to, a search target) are
 * protected too: eviction stops in front of the earliest of them, so a
 * navigation in flight cannot be evicted out from under the reader.
 *
 * A row that leaves the window is not lost: the session file is the store, the
 * history cursor names where to fetch from, and the sentinel keeps offering the
 * page. This is a window, not a ring buffer of the visible part: nothing is
 * dropped that the page is rendering.
 */
export function trimLoadedWindow<T>(
  messages: readonly T[],
  entryIds: readonly string[],
  options: {
    visibleCount: number;
    max?: number;
    navigated?: number;
    keepEntryIds?: Iterable<string>;
  },
): LoadedWindow<T> {
  const cap = loadedWindowCap(options.visibleCount, options.max, options.navigated);
  const kept = [...messages];
  const keptIds = [...entryIds];
  // The cursor is the fetch watermark: the oldest entry this page has asked the
  // server for. It is *not* the oldest kept row — a protected navigation target
  // pins the head of the window, and a cursor that followed the kept rows would
  // re-request the same page for ever.
  const fetchedOldestEntryId = entryIds.length ? entryIds[0] : null;
  let evict = Math.max(0, kept.length - cap);
  if (evict > 0) {
    const keep = options.keepEntryIds ? new Set(options.keepEntryIds) : null;
    if (keep && keep.size > 0) {
      for (let index = 0; index < keptIds.length; index += 1) {
        if (keptIds[index] && keep.has(keptIds[index])) {
          // Eviction stops in front of a protected row.
          evict = Math.min(evict, index);
          break;
        }
      }
    }
  }
  if (evict <= 0) return { messages: kept, entryIds: keptIds, evicted: 0, oldestEntryId: fetchedOldestEntryId };
  kept.splice(0, evict);
  keptIds.splice(0, evict);
  return { messages: kept, entryIds: keptIds, evicted: evict, oldestEntryId: fetchedOldestEntryId };
}

/**
 * Whether "load earlier" is still offered after a page lands.
 *
 * Since Phase 6 the loaded window slides (rows past the cap are evicted and the
 * cursor moves with them), so the cap does not end the reader's reach: the
 * sentinel stays while the server has more. Kept as a named rule because the
 * page's sentinel is the affordance, and a spinner at the top of a list that
 * never moves is the failure this function exists to prevent.
 */
export function hasEarlierAfterPrepend(
  loadedCount: number,
  serverHasMore: boolean,
  max = MAX_LOADED_MESSAGES,
): boolean {
  void max;
  void loadedCount;
  return serverHasMore;
}

/**
 * How long a prepend keeps re-attaching the viewport to its anchor row. Sized to
 * outlast what grows the content *above* after the page lands: the highlight queue
 * hands a long reply to Prism, an image reports its intrinsic size, a Mermaid block
 * renders. Measured live, a 600 ms window left a 90px drift on a page whose content
 * grew around the second mark.
 */
export const CHAT_SCROLL_ANCHOR_WINDOW_MS = 1500;

/** One rendered message row, measured against the scroller's own box. */
export interface ChatScrollRow {
  entryId: string;
  /** Distance from the scroller's top edge to the row's top. */
  top: number;
  bottom: number;
}

/**
 * The row the viewport is standing on: the first row with a visible part, kept
 * with its distance from the top edge.
 *
 * A prepend pushes rows down, so the position worth preserving is a row's
 * distance, not a scroll offset. `scrollHeight - scrollTop` (the distance
 * restore below) is only exact while the content above is final: a prepended
 * page arrives before deferred code highlighting, images, and a Mermaid render
 * have grown it, and each of those moves the viewport again.
 */
export function pickScrollAnchor(
  rows: readonly ChatScrollRow[],
  viewportHeight: number,
  tolerance = 2,
): { entryId: string; top: number } | null {
  for (const row of rows) {
    if (row.bottom > tolerance && row.top < viewportHeight - tolerance) {
      return { entryId: row.entryId, top: row.top };
    }
  }
  return null;
}

/**
 * The scrollTop that puts the anchored row back at the distance it had from the
 * top edge.
 *
 * The sign is the prepend: with `scrollTop` untouched, prepending content above
 * the anchor pushes its viewport-relative top down by exactly the prepended
 * height, so the offset has to grow by that same amount. `scrollTop + saved -
 * now` (the sign this first shipped with) asks for a negative scroll on the
 * common case — the user at the top of the window, the first row as the anchor —
 * gets clamped to 0, and the viewport shows the oldest loaded page instead of
 * the row they were reading. Clamped into the scroller, because content is still
 * arriving when the re-attach runs.
 */
export function scrollTopForAnchor(
  scrollTop: number,
  anchorTopNow: number,
  anchorTopSaved: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  return Math.max(0, Math.min(max, scrollTop + (anchorTopNow - anchorTopSaved)));
}

export function captureScrollDistance(scrollHeight: number, scrollTop: number): number {
  return scrollHeight - scrollTop;
}

export function restoreScrollTop(scrollHeight: number, savedDistance: number): number {
  return Math.max(0, scrollHeight - savedDistance);
}

export function isScrollAtTail(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = CHAT_SCROLL_TAIL_TOLERANCE,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - tolerance;
}

export function getLiveFollowAttached(
  wasAttached: boolean,
  previousScrollTop: number,
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  reattachTolerance = CHAT_SCROLL_REATTACH_TOLERANCE,
): boolean {
  if (isScrollAtTail(scrollTop, clientHeight, scrollHeight)) return true;
  if (scrollTop < previousScrollTop) return false;
  if (
    !wasAttached
    && scrollTop > previousScrollTop
    && isScrollAtTail(scrollTop, clientHeight, scrollHeight, reattachTolerance)
  ) return true;
  return wasAttached;
}

export function shouldShowScrollToLatest(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  tolerance = CHAT_SCROLL_TAIL_TOLERANCE,
): boolean {
  if (scrollHeight <= clientHeight) return false;
  return !isScrollAtTail(scrollTop, clientHeight, scrollHeight, tolerance);
}

export function getPromptAnchorSpacerHeight(
  targetTop: number,
  contentEnd: number,
  clientHeight: number,
  composerInset = 0,
): number {
  const clampedTargetTop = Math.max(0, targetTop);
  if (clampedTargetTop === 0) return 0;

  return Math.max(0, Math.ceil(
    // The separate composer spacer already contributes to scrollHeight.
    clampedTargetTop + clientHeight - Math.max(0, contentEnd) - Math.max(0, composerInset),
  ));
}
