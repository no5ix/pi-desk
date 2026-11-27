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
/** The two read-only panels opened from the header's More button that keep a reading
 *  width of their own: the prompt is prose, the tool list plus its detail pane needs two
 *  panes. The session stats card takes the whole column instead. */
export const SYSTEM_PROMPT_PANEL_WIDTH = 680;
export const TOOLS_PANEL_WIDTH = 780;
/** The session stats card fills the conversation column. Below this width its three
 *  columns no longer fit side by side — the first column's floor, the two numbers
 *  columns' content, the gaps and the card's padding — and the caller stacks them
 *  (AppShell). */
export const SESSION_STATS_STACK_WIDTH = 760;
/**
 * The Background Tasks card's own width. A monitor, so a band rather than a document: a task
 * row carries a name, a command, a state and a clock, and below this the clock wraps out of
 * the row. The column caps it, and `placeHeaderCard` keeps the gutters, so a narrow window
 * narrows the card instead of pushing it off the conversation.
 */
export const BACKGROUND_TASKS_PANEL_WIDTH = 500;
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
 * Places the Agents panel, and any card that follows its rule (the Background Tasks card is
 * one): a card that opens under the chip which opens it.
 *
 * `topBar` is the header's box: it spans exactly the conversation column, because the
 * sidebar and the file panel are full-height siblings of that column. `chip` is the
 * control that opens the panel, or null when there is none to anchor to (an
 * empty family renders no chip) — then the card centres, as on a phone. `width` is the card's
 * own width; the Agents card and the task monitor are not the same shape.
 */
export function placeAgentsPanel(
  topBar: PanelBox,
  chip: { left: number } | null,
  isMobile: boolean,
  width = AGENT_PANEL_WIDTH,
): TopPanelPlacement {
  const gutter = AGENT_PANEL_EDGE_GUTTER;
  const cardWidth = Math.min(width, topBar.width - gutter * 2);
  const anchor = isMobile || !chip
    ? (topBar.left + topBar.right) / 2 - cardWidth / 2
    : chip.left;
  // Keep the card inside the column: a count near the row's end moves the card left so
  // its right edge stays off the window, never off the conversation. The inner max is a
  // column narrower than the card plus both gutters: the left gutter wins there.
  const left = Math.min(
    Math.max(anchor, topBar.left + gutter),
    Math.max(topBar.left + gutter, topBar.right - cardWidth - gutter),
  );
  return { top: topBar.bottom + AGENT_PANEL_DROP_GAP, left, width: cardWidth, floating: true };
}

/**
 * Places one of the read-only panels the header's **More** button opens (system prompt,
 * tools, session stats). The button sits at the topbar's right end, so the card opens
 * under it: its right edge keeps the gutter, exactly like the More menu's own popup.
 * On a phone the same rule as the Agents card — the row is the whole page, so the card
 * centres on the page and keeps a gutter from both edges.
 *
 * `width` is the card's own width, capped by the column; pass "fill" for a card that
 * takes the column's whole width — the session stats card is three columns of numbers
 * and wants the horizontal space the conversation has. The caller lays its content out
 * for the width it gets (the stats card drops from three columns to one below
 * SESSION_STATS_STACK_WIDTH).
 */
export function placeHeaderCard(topBar: PanelBox, isMobile: boolean, maxWidth: number | "fill"): TopPanelPlacement {
  const gutter = AGENT_PANEL_EDGE_GUTTER;
  const available = topBar.width - gutter * 2;
  const width = maxWidth === "fill" ? available : Math.min(maxWidth, available);
  const left = isMobile
    ? (topBar.left + topBar.right) / 2 - width / 2
    : topBar.right - gutter - width;
  // A column narrower than the card plus both gutters: the left gutter is the floor.
  return {
    top: topBar.bottom + AGENT_PANEL_DROP_GAP,
    left: Math.max(left, topBar.left + gutter),
    width,
    floating: true,
  };
}
