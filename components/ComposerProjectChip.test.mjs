import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The composer's project menu.
 *
 * It hangs above the chip, and the project list is the composer's longest one — every
 * recent project, and on a phone a 44px row per project. Uncapped it grew past the top of
 * the chat column, whose box starts under the app topbar, and the header (which is drawn
 * above the chat column) covered the leading rows: the filter box and the current project
 * were unreachable. The cap is the composer's vertical placement rule, so the numbers are
 * checked in lib/composer-panel-placement.test.mjs; what is checked here is that this menu
 * actually applies it.
 */

const source = readFileSync(new URL("./ComposerProjectChip.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function panelBlock() {
  const at = source.indexOf("composer-project-menu");
  assert.notEqual(at, -1, "the panel exists");
  // The style object is written after the element's own markup.
  return source.slice(at - 600, at + 1600);
}

test("the project list is capped to the measured space above the chip", () => {
  assert.match(source, /getUpwardMenuMaxHeight\(/, "the chip asks for the space above it");
  assert.match(source, /getVisibleTopBoundary\(/, "the space stops at the header, not at the window");
  const block = panelBlock();
  assert.match(block, /min\(60vh, 420px, \$\{cap\}px\)/,
    "the list's own cap, and the measured space: the shorter one wins");
  assert.equal(block.includes('maxHeight: "min(60vh, 420px)"'), false,
    "the old cap alone was the whole height of a phone screen, header included");
});

test("the cap is measured from the chip, so it cannot feed back into itself", () => {
  assert.match(source, /menuRef\.current\.getBoundingClientRect\(\)\.top - MENU_GROW_GAP|chip\.getBoundingClientRect\(\)\.top - MENU_GROW_GAP/,
    "the panel's bottom edge comes from the chip, not from the panel's own rect");
  assert.match(source, /const menuBottom = chip\.getBoundingClientRect\(\)\.top - MENU_GROW_GAP;/);
  // The panel is watched (its rows arrive, the composer's row changes height), so the cap
  // is re-measured, on one frame at a time.
  assert.match(source, /new ResizeObserver\(schedule\)/);
  assert.match(source, /requestAnimationFrame\(measure\)/);
  assert.match(source, /window\.visualViewport/, "the keyboard and a rotation move the composer");
});

test("the panel stays on the composer layer, under the chrome", () => {
  const block = panelBlock();
  assert.match(block, /zIndex: COMPOSER_MENU_Z_INDEX/, "the composer popovers' layer");
  assert.equal(block.includes("zIndex: 500"), false,
    "a panel above the chrome paints through the header when it grows");
  assert.match(source, /const COMPOSER_MENU_Z_INDEX = 100;/);
});

test("the rows scroll inside the shared surface", () => {
  const block = panelBlock();
  assert.match(block, /overflow: "hidden"/, "the panel's own rounded surface clips");
  assert.match(block, /flexDirection: "column"/);
  assert.match(block, /className="app-menu-list"/, "one padded surface owns the inset; the list scrolls");
  const rows = source.slice(source.indexOf('<div className="app-menu-list">'));
  assert.match(rows, /role="menuitem"/, "the projects are menu items");
});
