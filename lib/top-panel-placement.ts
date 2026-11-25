/**
 * Where a header dropdown lands.
 *
 * The header's controls open panels, and a panel belongs under the control that opened
 * it. The Agents panel used to be a sheet: it was pinned to the topbar's right edge at
 * the column's full width, so on a desktop a 420px card sat over the file panel — the
 * one place a user is not reading a run, and a screen away from the subagent count that
 * opened it. It is a card now (`.app-menu`: rounded corners, an elevated surface, the
 * menu's shadow), and a card hangs where its control is.
 *
 * The two shapes the app ships:
 * - a desktop or a pad: the card opens under the count, its left edge in line with it,
 *   clamped so its right edge never leaves the conversation column;
 * - a phone: the header's project row wraps and the count can land anywhere, so the card
 *   centres itself under the header, the way the phone's other popups read.
 *
 * The gutter is not decoration. The card's shadow leaves its box, and a panel flush with
 * the window's edge loses the shadow on that side — the flat grey sheet the user called
 * ugly. A gap under the header does the same for the top.
 */

/** The card's own width; a narrower column caps it. */
export const AGENT_PANEL_WIDTH = 420;
/** How far the card hangs below the header, so its top edge and shadow are on the page. */
export const AGENT_PANEL_DROP_GAP = 8;
/** The clear space kept from the column's (and the window's) edges. */
export const AGENT_PANEL_EDGE_GUTTER = 10;

export interface TopPanelPlacement {
  top: number;
  left: number;
  width: number;
  /** A floating card, not a sheet: the layer must not scroll, or it clips the shadow. */
  floating?: boolean;
}

/** The box the placement is measured against — a `DOMRect` fits. */
export interface PanelBox {
  left: number;
  right: number;
  bottom: number;
  width: number;
}

/**
 * Places the Agents panel.
 *
 * `topBar` is the header's box: it spans exactly the conversation column, because the
 * sidebar and the file panel are full-height siblings of that column. `chip` is the
 * subagent count that opens the panel, or null when there is none to anchor to (an
 * empty family renders no chip) — then the card centres, as on a phone.
 */
export function placeAgentsPanel(
  topBar: PanelBox,
  chip: { left: number } | null,
  isMobile: boolean,
): TopPanelPlacement {
  const gutter = AGENT_PANEL_EDGE_GUTTER;
  const width = Math.min(AGENT_PANEL_WIDTH, topBar.width - gutter * 2);
  const anchor = isMobile || !chip
    ? (topBar.left + topBar.right) / 2 - width / 2
    : chip.left;
  // Keep the card inside the column: a count near the row's end moves the card left so
  // its right edge stays off the window, never off the conversation. The inner max is a
  // column narrower than the card plus both gutters: the left gutter wins there.
  const left = Math.min(
    Math.max(anchor, topBar.left + gutter),
    Math.max(topBar.left + gutter, topBar.right - width - gutter),
  );
  return { top: topBar.bottom + AGENT_PANEL_DROP_GAP, left, width, floating: true };
}
