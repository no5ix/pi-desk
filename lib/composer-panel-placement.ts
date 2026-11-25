/**
 * Where a composer menu lands, side to side.
 *
 * Every composer menu — Reasoning, Config, the session (gear) menu — hangs above the
 * 36px button that opened it. A `position: absolute` box with `right: 0` and only a
 * `minWidth` is shrink-to-fit against its containing block, and the containing block
 * here is the button's own `position: relative` wrapper: 36px. So the used width
 * collapses to the minimum, and every row wider than that is cut by the menu's own
 * `overflow: hidden`. On a desktop the Config menu opened as "n defaultTools" and the
 * Reasoning menu centred its rows: the panels' left halves reached into the sidebar's
 * column, which clips a composer menu at its right edge (the conversation column is
 * `overflow: hidden`) and paints over it (the sidebar's z-index is 200, the menus' is 100).
 *
 * Two things follow, and both live here:
 * - a menu is given the width its content wants, as a number, so shrink-to-fit cannot
 *   collapse it to the anchor's 36px;
 * - that width is placed inside the box the page can actually show: the visual viewport
 *   intersected with every ancestor that clips horizontally. The sidebar is a *sibling*
 *   of the conversation column, never an ancestor of the composer, so the clipper that
 *   decides the left edge is the column itself — a composer menu stops at the sidebar's
 *   edge instead of disappearing under it. The gutter keeps the menu's shadow on the page.
 *
 * Vertically the same rule runs the other way, and lives here too: a composer menu that
 * grows up is capped to the space between its anchor and the boundary above it
 * (`getVisibleTopBoundary` / `getUpwardMenuMaxHeight`, #63).
 */

/** Clear space kept from every edge the menu can be clipped by. */
export const COMPOSER_PANEL_EDGE_GUTTER = 16;

/**
 * The reading widths. The Reasoning menu carries a level, its description and the
 * default star on one line; the session menu carries a checkbox label that must not
 * wrap mid-sentence and a pair of segmented buttons. The Config menu keeps the width
 * it already shipped with.
 */
export const COMPOSER_RUN_MENU_WIDTH = 320;
export const COMPOSER_TOOL_MENU_WIDTH = 304;
export const COMPOSER_AUTOMATION_MENU_WIDTH = 300;
/**
 * The model picker. Its rows are `provider/model` identifiers a full 40 characters
 * long, so it asks for more than the reading menus and `placeComposerPanel` clamps
 * that to the whole box: on a phone the picker is as wide as the screen allows, and
 * on a desktop it stops at this width rather than running to the window.
 */
export const COMPOSER_MODEL_MENU_WIDTH = 420;

/** A horizontal box in viewport CSS pixels. */
export interface HorizontalBox {
  left: number;
  right: number;
}

/**
 * The box a menu may occupy: every clipper's box and the viewport, each shrunk by the
 * gutter. Returns null for an empty list, so a caller with no measurement falls back
 * to its own anchoring rather than to a zero-wide box.
 */
export function composerPanelBounds(
  boxes: HorizontalBox[],
  gutter: number = COMPOSER_PANEL_EDGE_GUTTER,
): HorizontalBox | null {
  if (boxes.length === 0) return null;
  let left = -Infinity;
  let right = Infinity;
  for (const box of boxes) {
    left = Math.max(left, box.left + gutter);
    right = Math.min(right, box.right - gutter);
  }
  if (!(right > left)) return null;
  return { left, right };
}

/**
 * Places a menu of `preferredWidth` next to its anchor, inside `bounds`.
 *
 * A desktop menu hangs from the anchor's right edge (the composer's control cluster is
 * at the row's right end, so the menu grows left, towards the text it configures). A
 * phone hangs from the anchor's left edge, like the phone's other popups. Either way a
 * menu that would leave the box is pulled back inside it, and a box narrower than the
 * menu takes the box's whole width: a menu is never wider than what can be shown.
 */
export function placeComposerPanel(
  anchor: HorizontalBox,
  preferredWidth: number,
  bounds: HorizontalBox,
  options: { alignLeft?: boolean } = {},
): { left: number; width: number } {
  const available = Math.max(0, bounds.right - bounds.left);
  const width = Math.min(Math.max(0, preferredWidth), available);
  const wanted = options.alignLeft ? anchor.left : anchor.right - width;
  const maxLeft = Math.max(bounds.left, bounds.right - width);
  return {
    left: Math.min(Math.max(wanted, bounds.left), maxLeft),
    width,
  };
}

const CLIPS_HORIZONTALLY = new Set(["auto", "scroll", "hidden", "clip"]);

function clipBoxesOfAncestors(anchor: HTMLElement): HorizontalBox[] {
  const boxes: HorizontalBox[] = [];
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    const { overflowX } = window.getComputedStyle(parent);
    if (!CLIPS_HORIZONTALLY.has(overflowX)) continue;
    const rect = parent.getBoundingClientRect();
    // clientLeft/clientTop is the border the box's own content is clipped behind.
    boxes.push({ left: rect.left + parent.clientLeft, right: rect.right - parent.clientLeft });
  }
  return boxes;
}

function viewportBox(): HorizontalBox | null {
  if (typeof window === "undefined") return null;
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const width = viewport?.width ?? window.innerWidth;
  if (!(width > 0)) return null;
  return { left, right: left + width };
}

/**
 * The `left` and `width` to put on an open menu, in the anchor's own coordinates (CSS
 * `left` is relative to its containing block). Null when nothing can be measured —
 * a server render, a detached anchor, a box too narrow to place anything — and the
 * caller then keeps its plain `right: 0` / `left: 0` anchoring.
 */
export function composerPanelAnchoring(
  anchorEl: HTMLElement | null,
  preferredWidth: number,
  options: { alignLeft?: boolean } = {},
): { left: number; width: number } | null {
  if (typeof window === "undefined" || !anchorEl?.isConnected) return null;
  const viewport = viewportBox();
  if (!viewport) return null;
  const bounds = composerPanelBounds([viewport, ...clipBoxesOfAncestors(anchorEl)]);
  if (!bounds) return null;
  const rect = anchorEl.getBoundingClientRect();
  const placed = placeComposerPanel(rect, preferredWidth, bounds, options);
  if (!(placed.width > 0)) return null;
  return { left: placed.left - rect.left, width: placed.width };
}

/** The space kept between an upward menu's top edge and whatever bounds it from above. */
export const UPWARD_MENU_GAP = 8;

/**
 * The height a menu that grows up from `menuBottom` may take: the distance down to
 * `visibleTop`, less the gap.
 *
 * A menu is short enough by the time its rows are few (the Reasoning menu is six rows), so
 * the cap only bites on a long list — and a long list is exactly what reaches the boundary.
 * A menu taller than the space paints past it, and the boundary is the app's own chrome,
 * which is drawn above the menu: the leading rows are cut and cannot be scrolled to.
 */
export function getUpwardMenuMaxHeight(
  menuBottom: number,
  visibleTop: number,
  gap = UPWARD_MENU_GAP,
): number {
  return Math.max(0, Math.floor(menuBottom - visibleTop - gap));
}

/** A box in viewport CSS pixels, as a DOM rectangle reports it. */
interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The bottom edge of every `.app-topbar` that can cover a popup at `element`.
 *
 * The topbar is a sibling of the chat column, never an ancestor of the composer, so a walk
 * over the composer's clippers cannot see it: on a short viewport an upward menu clamped
 * only to the viewport top opens underneath the topbar and its leading items are covered
 * (#63). Only a bar drawn above the popup counts — one beside it (the phone's split
 * layouts) or below must not shrink the menu.
 */
export function getTopbarBoundary(element: { getBoundingClientRect(): Rect }): number {
  if (typeof document === "undefined") return 0;
  const rect = element.getBoundingClientRect();
  let boundary = 0;
  for (const topbar of document.querySelectorAll<HTMLElement>(".app-topbar")) {
    const topbarRect = topbar.getBoundingClientRect();
    const overlapsHorizontally = rect.left < topbarRect.right && rect.right > topbarRect.left;
    // Only a topbar drawn above the menu can clip it; one beside (mobile
    // split layouts) or below must not shrink the menu.
    const sitsAbove = topbarRect.bottom <= rect.bottom;
    if (overlapsHorizontally && sitsAbove) {
      boundary = Math.max(boundary, topbarRect.bottom + topbar.clientTop);
    }
  }
  return boundary;
}

/**
 * The top edge a composer menu can paint at: the visual viewport, every ancestor that
 * clips vertically (the chat column is one, and its box starts under the topbar), and the
 * bottom edge of a topbar that overlaps the menu horizontally.
 */
export function getVisibleTopBoundary(element: HTMLElement): number {
  let visibleTop = window.visualViewport?.offsetTop ?? 0;

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      visibleTop = Math.max(visibleTop, parent.getBoundingClientRect().top + parent.clientTop);
    }
  }

  visibleTop = Math.max(visibleTop, getTopbarBoundary(element));

  return visibleTop;
}
