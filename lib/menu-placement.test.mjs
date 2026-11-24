import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { placeMenuWithinViewport, MENU_GAP, MENU_MARGIN, MENU_MAX_HEIGHT_PX, MENU_MAX_HEIGHT_CSS, menuExpectedHeight } = await jiti.import("./menu-placement.ts");

const viewport = { width: 1000, height: 800 };
const anchor = { top: 100, bottom: 128, right: 260 };

test("a menu with room below opens downward", () => {
  const placed = placeMenuWithinViewport(anchor, { width: 168, height: 200 }, viewport);
  assert.deepEqual(placed, { top: anchor.bottom + MENU_GAP, left: anchor.right - 168, side: "below" });
});

test("a menu that does not fit below flips above the anchor", () => {
  const nearBottom = { top: 700, bottom: 728, right: 260 };
  const placed = placeMenuWithinViewport(nearBottom, { width: 168, height: 200 }, viewport);
  assert.equal(placed.top, nearBottom.top - MENU_GAP - 200);
  assert.ok(placed.top + 200 <= viewport.height - MENU_MARGIN);
});

test("the menu never leaves the viewport when neither side fits", () => {
  const tall = { width: 168, height: 900 };
  const placed = placeMenuWithinViewport({ top: 380, bottom: 408, right: 260 }, tall, viewport);
  assert.ok(placed.top >= MENU_MARGIN);
  assert.ok(placed.top <= viewport.height - MENU_MARGIN);
});

test("the menu keeps its right edge aligned with the anchor and stays inside the window", () => {
  const aligned = placeMenuWithinViewport({ top: 100, bottom: 128, right: 990 }, { width: 168, height: 100 }, viewport);
  assert.equal(aligned.left, 990 - 168);
  assert.ok(aligned.left + 168 <= viewport.width - MENU_MARGIN);
  const beyond = placeMenuWithinViewport({ top: 100, bottom: 128, right: 1200 }, { width: 168, height: 100 }, viewport);
  assert.equal(beyond.left, viewport.width - 168 - MENU_MARGIN);
  const farLeft = placeMenuWithinViewport({ top: 100, bottom: 128, right: 4 }, { width: 168, height: 100 }, viewport);
  assert.equal(farLeft.left, MENU_MARGIN);
});

test("a menu keeps the side it opened on as its content grows", () => {
  // The composer's chip sits at the bottom of the window and its branch list
  // arrives a moment after the panel opens. Placed from the loading shape, the
  // panel lands below; the list then does not fit, and the placement flips it
  // above — the flash the user reported ("pop out below, then show up above, it
  // just flashed"). The side is chosen once and kept; the far edge is what grows.
  const nearBottom = { top: 640, bottom: 668, right: 500 };
  const opened = placeMenuWithinViewport(nearBottom, { width: 240, height: 60 }, viewport);
  assert.equal(opened.side, "below");
  const grown = placeMenuWithinViewport(nearBottom, { width: 240, height: 420 }, viewport, { side: opened.side });
  assert.equal(grown.side, "below", "a height change does not move the panel to the anchor's other side");
  assert.equal(grown.top, Math.min(nearBottom.bottom + MENU_GAP, Math.max(MENU_MARGIN, viewport.height - MENU_MARGIN - 420)));
  // A side chosen above is kept too, and the panel's bottom stays at the anchor:
  // that is the edge the user's pointer is on.
  const above = placeMenuWithinViewport(nearBottom, { width: 240, height: 420 }, viewport, { side: "above" });
  assert.equal(above.top, nearBottom.top - MENU_GAP - 420);
  const aboveShrunk = placeMenuWithinViewport(nearBottom, { width: 240, height: 200 }, viewport, { side: "above" });
  assert.equal(aboveShrunk.top + 200, above.top + 420);
});

test("placement is bought from the height a menu settles at, not the shape it is born at", () => {
  // 420 is the panel's own cap (`MENU_MAX_HEIGHT_CSS`). Estimating 560 — the
  // number this shipped with — puts the panel's top 140px above where its content
  // can reach, so the measured placement moves the visible panel when the list lands.
  assert.equal(MENU_MAX_HEIGHT_PX, 420);
  assert.equal(MENU_MAX_HEIGHT_CSS, `min(70vh, ${MENU_MAX_HEIGHT_PX}px)`);
  assert.equal(menuExpectedHeight(800), 420);
  assert.equal(menuExpectedHeight(600), 420);
  assert.equal(menuExpectedHeight(500), 350, "a short window places for 70% of itself");
  assert.ok(menuExpectedHeight(500) <= 500 - 2 * MENU_MARGIN);
  // One constant, so the chip's estimate, the hook's first placement, and the
  // panel's cap agree; a menu placed from a number the panel cannot reach jumps.
  assert.ok(menuExpectedHeight(800, MENU_MAX_HEIGHT_PX) === MENU_MAX_HEIGHT_PX);
});
