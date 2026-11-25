import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./top-panel-placement.ts");
  } catch {
    return import("./top-panel-placement.ts");
  }
}

const { AGENT_PANEL_DROP_GAP, AGENT_PANEL_EDGE_GUTTER, AGENT_PANEL_WIDTH, placeAgentsPanel } = await loadSubject();

/** The window the app ships: a 260px sidebar, then the conversation column. */
function topBar(viewportWidth, columnLeft = 260) {
  return { left: columnLeft, right: viewportWidth, bottom: 72, width: viewportWidth - columnLeft };
}

test("a desktop card opens under the count that opens it", () => {
  const bar = topBar(1440);
  const chip = { left: 560 };
  const placed = placeAgentsPanel(bar, chip, false);
  assert.equal(placed.left, 560, "the card's left edge is in line with the count");
  assert.equal(placed.width, AGENT_PANEL_WIDTH, "a wide column gives the card its width");
  assert.equal(placed.top, bar.bottom + AGENT_PANEL_DROP_GAP, "it hangs below the header, not welded to it");
  assert.equal(placed.floating, true, "a card: its layer must not scroll, or the shadow is clipped");
});

test("a count near the column's end keeps the card off the window", () => {
  const bar = topBar(1200);
  const placed = placeAgentsPanel(bar, { left: 1180 }, false);
  assert.equal(placed.left, bar.right - AGENT_PANEL_WIDTH - AGENT_PANEL_EDGE_GUTTER,
    "the card is pulled left so its right edge and its shadow stay inside the column");
  assert.ok(placed.left + placed.width <= bar.right - AGENT_PANEL_EDGE_GUTTER, "nothing of the card is off the window");
});

test("a phone centres the card under the header", () => {
  // The phone's header is the whole page, and its project row wraps: the count can be at
  // either end, so the card centres, the way the phone's other popups read.
  const bar = topBar(390, 0);
  const placed = placeAgentsPanel(bar, { left: 8 }, true);
  assert.ok(Math.abs((placed.left + placed.width / 2) - 390 / 2) < 0.5,
    "the card is centred on the page, not on the header's left edge");
  assert.ok(placed.left >= AGENT_PANEL_EDGE_GUTTER && placed.left + placed.width <= 390 - AGENT_PANEL_EDGE_GUTTER,
    "and it keeps a gutter from both edges, so the shadow is not cut by the screen");
  assert.ok(placed.width < AGENT_PANEL_WIDTH, "a phone's column caps the card's width");
});

test("a narrow column, a missing count, and a phone's cap all stay inside", () => {
  const narrow = topBar(900, 700);
  const placed = placeAgentsPanel(narrow, null, false);
  assert.ok(placed.left >= narrow.left + AGENT_PANEL_EDGE_GUTTER, "the left gutter is the floor");
  assert.ok(placed.width > 0, "a column narrower than the card plus both gutters never inverts the cap");
  const noChip = placeAgentsPanel(topBar(1440), null, false);
  assert.ok(Math.abs((noChip.left + noChip.width / 2) - (topBar(1440).left + topBar(1440).right) / 2) < 0.5,
    "no count to anchor to (an empty family) centres in the column");
});
