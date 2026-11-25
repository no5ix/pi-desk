import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

async function loadSubject() {
  try {
    const { createJiti } = await import("jiti");
    return createJiti(import.meta.url).import("./composer-panel-placement.ts");
  } catch {
    return import("./composer-panel-placement.ts");
  }
}

const {
  COMPOSER_AUTOMATION_MENU_WIDTH,
  COMPOSER_MODEL_MENU_WIDTH,
  COMPOSER_PANEL_EDGE_GUTTER,
  COMPOSER_RUN_MENU_WIDTH,
  COMPOSER_TOOL_MENU_WIDTH,
  composerPanelBounds,
  placeComposerPanel,
} = await loadSubject();

/** The window this fork ships on: a sidebar, then the conversation column. */
function column(viewportWidth, sidebarWidth = 260) {
  return { left: 0, right: viewportWidth };
}

/** The clipper that decides a composer menu's left edge: the conversation column. */
function columnBounds(viewportWidth, sidebarWidth = 260) {
  return { left: sidebarWidth + COMPOSER_PANEL_EDGE_GUTTER, right: viewportWidth - COMPOSER_PANEL_EDGE_GUTTER };
}

/** A composer control: a 36px button at the row's right end. */
function button(viewportWidth, gap = 12) {
  return { left: viewportWidth - gap - 36, right: viewportWidth - gap };
}

test("the menus are placed by a width, not by shrink-to-fit on a 36px anchor", () => {
  // A `position: absolute` box with `right: 0` and only a minWidth is shrink-to-fit
  // against its containing block, and the containing block is the button's own
  // relative wrapper: 36px. The panels shipped that way and cut their rows mid-glyph.
  const placed = placeComposerPanel(button(1440), COMPOSER_TOOL_MENU_WIDTH, columnBounds(1440));
  assert.equal(placed.width, COMPOSER_TOOL_MENU_WIDTH, "the menu gets the width it asked for");
  assert.ok(placed.width > 36, "and never the anchor's 36px");
});

test("a desktop menu hangs left from the button that opened it", () => {
  const anchor = button(1440);
  const bounds = columnBounds(1440);
  const placed = placeComposerPanel(anchor, COMPOSER_RUN_MENU_WIDTH, bounds);
  assert.equal(placed.left + placed.width, Math.min(anchor.right, bounds.right),
    "its right edge is in line with the button, kept off the window by the gutter");
  assert.ok(placed.left < anchor.left, "and it grows left, over the text it configures");
});

test("the sidebar is the limit: nothing of a composer menu reaches under it", () => {
  // The bug the user photographed: Reasoning, Config and the session menu all opened
  // with their left half in the sidebar's column. The column clips at its own left
  // edge and the sidebar (z-index 200) paints over the menus (z-index 100).
  const bounds = columnBounds(900, 260);
  for (const width of [COMPOSER_RUN_MENU_WIDTH, COMPOSER_TOOL_MENU_WIDTH, COMPOSER_AUTOMATION_MENU_WIDTH]) {
    const placed = placeComposerPanel(button(900, 300), width, bounds);
    assert.ok(placed.left >= bounds.left, `the menu's left edge stops at the column, not at the window (width ${width})`);
    assert.ok(placed.left + placed.width <= bounds.right, `and its right edge stays inside (width ${width})`);
  }
});

test("a menu is never wider than the box it is allowed in", () => {
  const narrow = { left: 300, right: 460 };
  const placed = placeComposerPanel({ left: 320, right: 356 }, COMPOSER_RUN_MENU_WIDTH, narrow);
  assert.equal(placed.width, narrow.right - narrow.left, "a narrow column caps the menu's width");
  assert.equal(placed.left, narrow.left, "and it fills the box from its left edge");
});

test("a phone's model picker takes the screen's width, and the strip's box caps it", () => {
  // The picker's rows are `provider/model` identifiers, and the phone's composer opens
  // it from the control strip. It asks for more than a phone's page is wide, so the
  // clamp gives it the page: 16px of gutter on each side, nothing cut.
  const phone = 440;
  const bounds = { left: COMPOSER_PANEL_EDGE_GUTTER, right: phone - COMPOSER_PANEL_EDGE_GUTTER };
  const stripChip = { left: 18, right: 50 };
  const placed = placeComposerPanel(stripChip, COMPOSER_MODEL_MENU_WIDTH, bounds, { alignLeft: true });
  assert.equal(placed.width, bounds.right - bounds.left, "the whole box, because the picker asked for more than the page");
  assert.equal(placed.left, COMPOSER_PANEL_EDGE_GUTTER, "flush with the gutter, like the phone's other popups");
  assert.ok(placed.width > 380, `the model names read whole (${placed.width}px)`);
  // The desktop keeps the picker at its own width.
  const desktop = placeComposerPanel({ left: 1100, right: 1132 }, COMPOSER_MODEL_MENU_WIDTH, columnBounds(1440));
  assert.equal(desktop.width, COMPOSER_MODEL_MENU_WIDTH, "a wide page does not stretch it");
  assert.ok(desktop.left + desktop.width <= 1440 - COMPOSER_PANEL_EDGE_GUTTER, "and it stays inside the page");
});

test("a phone hangs the menu from the button's left edge and keeps both gutters", () => {
  const bounds = { left: COMPOSER_PANEL_EDGE_GUTTER, right: 390 - COMPOSER_PANEL_EDGE_GUTTER };
  const anchor = { left: 300, right: 336 };
  const placed = placeComposerPanel(anchor, COMPOSER_RUN_MENU_WIDTH, bounds, { alignLeft: true });
  assert.ok(placed.left >= bounds.left && placed.left + placed.width <= bounds.right,
    "a phone's 390px page cannot show 320px at x=300, so the menu is pulled inside");
  assert.ok(placed.left < anchor.left, "it slides left, the way the phone's other popups land");
  const roomy = placeComposerPanel({ left: 12, right: 48 }, 240, bounds, { alignLeft: true });
  assert.equal(roomy.left, COMPOSER_PANEL_EDGE_GUTTER, "with room, it hangs from the button's own left edge, kept off the screen by the gutter");
});

test("every clipper and the viewport are intersected, so the tightest wins", () => {
  const viewport = column(1440);
  const chatWindow = { left: 300, right: 1200 };
  const panel = { left: 900, right: 1200 };
  const bounds = composerPanelBounds([viewport, chatWindow, panel]);
  assert.deepEqual(bounds, {
    left: 900 + COMPOSER_PANEL_EDGE_GUTTER,
    right: 1200 - COMPOSER_PANEL_EDGE_GUTTER,
  }, "the innermost clipper sets the box, and each edge keeps its gutter");
  assert.equal(composerPanelBounds([]), null, "no measurement: the caller keeps its plain anchoring");
  assert.equal(composerPanelBounds([{ left: 0, right: 20 }]), null,
    "a box thinner than two gutters places nothing, rather than a negative width");
});

test("every composer menu goes through the helper", () => {
  const composer = readFileSync(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
  const automation = readFileSync(new URL("../components/SessionAutomationMenu.tsx", import.meta.url), "utf8");
  const model = readFileSync(new URL("../components/ModelSelector.tsx", import.meta.url), "utf8");
  // `back` is how far above the panel's own markup its placement is computed; the
  // model picker builds a whole position object before the JSX.
  const styles = [
    [composer, "composer-run-menu", "COMPOSER_RUN_MENU_WIDTH", 700],
    [composer, "composer-tool-menu", "COMPOSER_TOOL_MENU_WIDTH", 700],
    [automation, "native-popover app-menu", "COMPOSER_AUTOMATION_MENU_WIDTH", 700],
    [model, "native-popover app-menu", "COMPOSER_MODEL_MENU_WIDTH", 1600],
  ];
  for (const [source, className, widthConst, back] of styles) {
    const at = source.indexOf(className);
    assert.ok(at >= 0, `the ${className} panel exists`);
    const block = source.slice(at - back, at + 700);
    assert.match(block, /composerPanelAnchoring\(/, `${className} is placed by the helper`);
    assert.match(block, new RegExp(widthConst), `${className} passes ${widthConst}`);
    assert.match(block, /anchoring \? \{ left: anchoring\.left, width: anchoring\.width \}/,
      `${className} sets an explicit width and left`);
  }
  // The Config menu's old clamp was to the window: 16px from the window's left edge
  // is under the sidebar, which is where its labels were cut.
  assert.doesNotMatch(composer, /const left = Math\.max\(16, Math\.min\(anchorRight - width, vw - width - 16\)\);/);
});

test("a server render falls back to the plain anchoring", () => {
  // The panels render on the server (components/ChatInput.automation.test.mjs reads
  // their markup), where there is no window and no measured anchor.
  const composer = readFileSync(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");
  const automation = readFileSync(new URL("../components/SessionAutomationMenu.tsx", import.meta.url), "utf8");
  assert.match(composer, /: isMobile \? \{ left: 0 \} : \{ right: 0 \}\)/, "Reasoning keeps its fallback");
  assert.match(composer, /: \{ right: 0 \}\)/, "Config keeps its fallback");
  assert.match(automation, /: alignLeft \? \{ left: 0 \} : \{ right: 0 \}\)/, "the session menu keeps its fallback");
  const helper = readFileSync(new URL("./composer-panel-placement.ts", import.meta.url), "utf8");
  assert.match(helper, /typeof window === "undefined" \|\| !anchorEl\?\.isConnected\) return null/);
});
