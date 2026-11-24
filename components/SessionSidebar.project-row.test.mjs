import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * The rows the sidebar lists projects and sessions with, and the composer chips
 * that sit under a chat. Each of these was the user's complaint: a pinned project
 * marked by a glyph that had to be squeezed behind the name, a fork mark that
 * pushed the title, a project chip that outlived the moment it was useful, and a
 * menu that flashed.
 */

test("a pinned project is its orange folder icon, with no pin button in the row", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.ok(!sidebar.includes("sidebar-project-tree-pin"),
    "the pin button is gone: the row is dense and its trailing edge belongs to the hover-only ＋/…");
  assert.ok(!/\.sidebar-project-tree-pin \{/.test(css), "its CSS went with the button");
  assert.match(sidebar, /className=\{`sidebar-project-tree-row\$\{isMenuOpen \? " is-menu-open" : ""\}\$\{pinned \? " is-pinned" : ""\}`\}/,
    "the row carries the pin state");
  assert.match(css, /\.sidebar-project-tree-row\.is-pinned \.sidebar-project-tree-folder \{\n  color: var\(--warning\);\n\}/,
    "the folder icon takes the app's orange");
  // The state is announced, and unpinning is the project menu's item — a row with no
  // glyph must still say what it is and let the user change it.
  assert.match(sidebar, /aria-label=\{`\$\{displayName\}\$\{pinned \? ` · \$\{t\("sidebar\.pinnedProject"\)\}` : ""\} · \$\{rowTitle\}`\}/);
  assert.match(sidebar, /t\(pinnedProjects\.has\(projectRoot\) \? "sidebar\.unpinProject" : "sidebar\.pinProject"\)/);
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
