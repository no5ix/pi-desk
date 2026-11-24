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
