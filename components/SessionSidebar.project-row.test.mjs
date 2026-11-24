import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * The rows the sidebar lists projects and sessions with, and the composer chips
 * that sit under a chat. Each of these was the user's complaint: a pin that was
 * decoration and not a control, a fork mark that pushed the title, a project
 * chip that outlived the moment it was useful, and a menu that flashed.
 */

test("a pinned project's pin sits behind the name and unpins on click", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const pin = sidebar.match(/\{pinned && \(\s*<button[\s\S]*?className="sidebar-project-tree-pin"[\s\S]*?<\/button>\s*\)}/);
  assert.ok(pin, "the pin is a real button, not a glyph");
  assert.match(pin[0], /aria-label=\{t\("sidebar\.unpinProject"\)\}/, "it says what clicking it does");
  assert.match(pin[0], /setPinnedProjects\(\(current\) => toggleId\(current, group\.projectRoot\)\)/, "it toggles the pin off");
  assert.ok(!sidebar.includes('<span className="sidebar-project-tree-pin"'), "no dead pin glyph is left behind");
  // The row packs the name to the left, so the glyph rides right behind the text
  // instead of parking at a fixed offset from the row's right edge.
  assert.match(css, /\.sidebar-project-tree-row\.is-pinned \.sidebar-project-tree-row-main \{\n\s*flex: 0 1 auto;/);
  assert.match(css, /\.sidebar-project-tree-pin \{\n((?:[^}]*\n)*?)\s*cursor: pointer;/, "a pointer, because it is a control");
  assert.ok(!/\.sidebar-project-tree-pin \{[^}]*position: absolute;/.test(css), "the fixed slot is gone");
});

test("a fork is marked at the row's end, before the subagent count", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const fork = sidebar.indexOf("session-item-fork-glyph");
  const title = sidebar.indexOf('className="session-item-title"');
  const toggle = sidebar.indexOf("session-item-children-toggle");
  assert.ok(fork > title, "the mark follows the title, it does not push it right");
  assert.ok(toggle > fork, "and sits right before the subagent count");
  const leading = sidebar.slice(sidebar.indexOf("{isRunning ? ("), title);
  assert.ok(!leading.includes("session-item-fork-glyph"), "the row's leading glyph is the plain bubble again");
  assert.ok(!leading.includes(") : isFork ? ("), "the leading chain no longer branches on forks");
  // The source session is still named, in the title's tooltip.
  assert.match(sidebar, /isFork \? \(forkSourceTitle \? t\("sidebar\.forkedFrom", \{ title: forkSourceTitle \}\)/);
});

test("the composer's project chip is only on a new-session composer", async () => {
  // A session that has run is pinned to its project and the header names it, so a
  // second, inert chip under its composer is noise.
  const input = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(chat, /showProjectChip=\{!chatOnly && isNew\}/, "only a new session asks for the chip");
  assert.match(input, /\{showProjectChip && projectLabel && \(\s*<ComposerProjectChip/, "the chip is gated on it");
  assert.match(input, /showProjectChip\?: boolean;/, "the composer spells the prop out");
});

test("the branch chip opens on the side the loaded list fits on", async () => {
  // It used to open below the composer at the height of the loading menu, then
  // flip above when the branch list arrived: a flash on every click.
  const chip = await readFile(new URL("./ComposerBranchMenu.tsx", import.meta.url), "utf8");
  const menu = await readFile(new URL("./ProjectContextMenu.tsx", import.meta.url), "utf8");
  assert.match(chip, /placeMenuWithinViewport\(\s*\{ top: rect\.top, bottom: rect\.bottom, right: rect\.right \},\s*\{ width: MENU_WIDTH, height: MENU_EXPECTED_HEIGHT \}/,
    "placement is computed from the size the menu ends up at");
  assert.ok(!chip.includes("pos: { top: rect.bottom + 4"), "no below-placement left to be corrected after paint");
  // The page is born at the list's shape, so nothing swaps in under a placed menu.
  assert.match(menu, /const BRANCH_SKELETON_ROWS = 8;/);
  assert.match(menu, /\{!loaded && \(\s*<div className="sidebar-project-context-menu-branch-skeletons"/);
});
