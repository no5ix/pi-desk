/**
 * Placement for the sidebar's fixed-position menus.
 *
 * The previous code estimated a menu's height from a constant (42px for the
 * project menu, a rough item count for the session menu). A guess that small
 * always reports "there is room below", so a menu opened near the bottom of
 * the window ran off the screen and its last items could not be clicked.
 * These helpers work from the menu's measured size instead.
 */

export interface MenuAnchor {
  /** Anchor rectangle in viewport coordinates. */
  top: number;
  bottom: number;
  right: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

/** Gap between the anchor and the menu. */
export const MENU_GAP = 4;
/**
 * The height cap the app's menu panels carry (`ProjectContextMenuPanel`), as CSS
 * and as the number placement starts from. One constant on purpose: placement
 * from a *smaller* number than the panel can reach puts the panel on a side, and
 * at a top, the real list does not fit — and the panel jumps when the list
 * arrives. That jump is the flash the user reported.
 */
export const MENU_MAX_HEIGHT_PX = 420;
export const MENU_MAX_HEIGHT_CSS = "min(70vh, 420px)";
/** The height a menu is placed for: the cap it settles at, inside the window. */
export function menuExpectedHeight(viewportHeight: number, maxHeight = MENU_MAX_HEIGHT_PX): number {
  return Math.min(maxHeight, Math.round(viewportHeight * 0.7));
}
/** Which side of the anchor a menu sits on. */
export type MenuSide = "above" | "below";
/** Minimum distance kept between the menu and the viewport edge. */
export const MENU_MARGIN = 8;

/**
 * Place a menu next to its anchor: below it when there is room, above it when
 * there is not, and always fully inside the viewport.
 */
export function placeMenuWithinViewport(
  anchor: MenuAnchor,
  menu: MenuSize,
  viewport: { width: number; height: number },
  options: { gap?: number; margin?: number; side?: MenuSide } = {},
): { top: number; left: number; side: MenuSide } {
  const gap = options.gap ?? MENU_GAP;
  const margin = options.margin ?? MENU_MARGIN;
  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const left = Math.min(Math.max(anchor.right - menu.width, margin), maxLeft);

  const below = anchor.bottom + gap;
  const above = anchor.top - gap - menu.height;
  const fitsBelow = below + menu.height <= viewport.height - margin;
  const fitsAbove = above >= margin;
  // The side is chosen once and kept. A menu's height is not final when it opens
  // (a list arrives a moment later), and a side recomputed from each measured
  // height flips the panel from below the anchor to above it mid-flight.
  const side: MenuSide = options.side
    ?? (fitsBelow ? "below" : fitsAbove ? "above" : menu.height >= viewport.height - 2 * margin ? "above" : "below");

  // Clamped into the window on its own side, so a menu that outgrows the space
  // scrolls internally instead of running off the screen.
  const top = side === "below"
    ? Math.min(below, Math.max(margin, viewport.height - margin - menu.height))
    : Math.max(margin, above);
  return { top, left, side };
}

/** A node that answers `contains`, as a DOM node does. */
interface NodeLike {
  contains(other: unknown): boolean;
}

/**
 * Does this scroll event move the element a menu is anchored to?
 *
 * A capture-phase `scroll` listener on the window hears every scroller in the app, and
 * on a running session page the chat scrolls itself on each streamed chunk. A menu that
 * closes for "the view moved" therefore closed the sidebar's "…" a second after every
 * open, and the same listener shuts a combobox's suggestions while the conversation
 * streams. Only a scroller that contains the anchor — or the page itself, which moves
 * everything — detaches a menu from the control it belongs to.
 *
 * With no anchor (a menu opened at a point, not beside a control) only the page counts.
 */
export function scrollMovesAnchor(scroller: unknown, anchor: unknown): boolean {
  if (scroller == null) return false;
  if (typeof window !== "undefined" && scroller === window) return true;
  if (typeof document !== "undefined"
    && (scroller === document || scroller === document.documentElement || scroller === document.body)) {
    return true;
  }
  if (anchor == null) return false;
  const node = scroller as NodeLike;
  if (typeof node.contains !== "function") return false;
  return node.contains(anchor);
}
