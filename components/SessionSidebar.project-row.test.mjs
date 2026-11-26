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

test("a pinned project is its yellow folder icon, with no pin button in the row", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.ok(!sidebar.includes("sidebar-project-tree-pin"),
    "the pin button is gone: the row is dense and its trailing edge belongs to the hover-only ＋/…");
  assert.ok(!/\.sidebar-project-tree-pin \{/.test(css), "its CSS went with the button");
  assert.match(sidebar, /className=\{`sidebar-project-tree-row\$\{isMenuOpen \? " is-menu-open" : ""\}\$\{pinned \? " is-pinned" : ""\}`\}/,
    "the row carries the pin state");
  assert.match(css, /\.sidebar-project-tree-row\.is-pinned \.sidebar-project-tree-folder \{\n  color: #cdc12c;\n\}/,
    "the folder icon takes the pin yellow");
  // The state is announced, and unpinning is the project menu's item — a row with no
  // glyph must still say what it is and let the user change it.
  assert.match(sidebar, /aria-label=\{`\$\{displayName\}\$\{pinned \? ` · \$\{t\("sidebar\.pinnedProject"\)\}` : ""\} · \$\{rowTitle\}`\}/);
  assert.match(sidebar, /t\(pinnedProjects\.has\(projectRoot\) \? "sidebar\.unpinProject" : "sidebar\.pinProject"\)/);
});

test("a fork is marked at the row's end, before the subagent count", async () => {
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const fork = sidebar.indexOf("session-item-fork-glyph");
  // Match the title's class token, not one literal attribute: a span that marks a
  // pin by the title's ink spells the class as a template literal, and a missed
  // indexOf returns -1 — a -1 end makes the `leading` slice below run to the end of
  // the file, and the leading-glyph assertions then read the whole component.
  const title = sidebar.search(/className=\{?["`]session-item-title/);
  assert.ok(title > 0, "the row carries its title span");
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
  const placement = await readFile(new URL("../lib/menu-placement.ts", import.meta.url), "utf8");
  const hook = await readFile(new URL("../hooks/useMenuPlacement.ts", import.meta.url), "utf8");
  assert.match(chip, /placeMenuWithinViewport\(\s*\{ top: rect\.top, bottom: rect\.bottom, right: rect\.right \},\s*\{ width: MENU_WIDTH, height: menuExpectedHeightForViewport\(\) \}/,
    "placement is computed from the size the menu ends up at");
  assert.ok(!chip.includes("pos: { top: rect.bottom + 4"), "no below-placement left to be corrected after paint");
  // One cap, read by all three: the chip's estimate, the hook's first placement,
  // and the panel's own max-height. Estimating a number the panel cannot reach
  // (560 against its 420 cap) put the panel's top where no content lives, and the
  // measured placement moved the visible panel when the list landed.
  assert.match(chip, /menuExpectedHeight\(window\.innerHeight\)/);
  assert.match(hook, /const capFloor = firstRef\.current \|\| options\.growing\s*\?\s*menuExpectedHeight\(window\.innerHeight, MENU_MAX_HEIGHT_PX\)/,
    "the placement is bought for the settled height while the menu is born and while its list is in flight, not for the shape it is born at");
  assert.match(menu, /useMenuPlacement\(anchor, menuRef, \{ growing: loadingShape \}\)/,
    "the panel tells the hook its list is in flight: live in the app, the skeleton frame sat 343px from where the list landed");
  assert.match(hook, /sideRef\.current = next\.side;/, "the side is remembered: a growing list grows the far edge, it does not flip the panel");
  assert.match(menu, /maxHeight: MENU_MAX_HEIGHT_CSS/, "the panel carries the same cap placement starts from");
  // The list's shape is not painted on open: a fetch that lands in tens of
  // milliseconds must not show a shape the list then resizes.
  assert.match(menu, /const BRANCH_SKELETON_ROWS = 8;/);
  assert.match(menu, /\{!loaded && showLoadingShape && \(\s*<div className="sidebar-project-context-menu-branch-skeletons"/);
  assert.match(menu, /const hiddenPanel = loadingShape && !showLoadingShape;/);
  // A closing menu never shows the skeleton: it animates the rows it was showing.
  assert.match(menu, /data-loading=\{hiddenPanel && !closing \? "true" : undefined\}/);
  assert.ok(placement.includes("export const MENU_MAX_HEIGHT_PX = 420;"), "one constant");
});

test("a row whose subagent runs are live breathes", async () => {
  // The header's running bucket pulses; the sidebar's fold head sat still ten pixels
  // away, so a delegated run looked alive in one place and dead in the other.
  const sidebar = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
  const nodes = await readFile(new URL("../lib/sidebar-session-nodes.ts", import.meta.url), "utf8");
  const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(sidebar, /const runningChildren = hasChildren \? countRunningSubagentRuns\(node, runningSessionIds\) : 0;/,
    "the row counts its family's live runs from the tree, the same two sources the header reads");
  assert.match(sidebar, /childrenRunningCount=\{runningChildren\}/, "and hands the number to the row");
  assert.match(sidebar, /className=\{`session-item-children-glyph\$\{childrenRunningCount > 0 \? " agent-status-icon--pulse" : ""\}`\}/,
    "the fold head carries the app's one breathing class, and only while a run is live");
  assert.match(sidebar, /className=\{`session-item-children-toggle\$\{collapsed \? " is-collapsed" : ""\}\$\{childrenRunningCount > 0 \? " is-running" : ""\}`\}/,
    "the toggle itself carries the state for a rule that wants the whole pill");
  assert.match(sidebar, /childrenRunningCount > 0 \? t\("chat\.subagentsRunning", \{ running: childrenRunningCount \}\)/,
    "a breathing icon is also said: the tooltip and aria-label name how many are running");
  assert.match(nodes, /export function countRunningSubagentRuns\(/,
    "the count is a tree helper, so the row and the tests read one rule");
  assert.match(nodes, /relation\?\.kind === "subagent"/, "side chats stay out: a conversation the user drives is not a run");
  const pulse = css.match(/\.agent-status-icon--pulse \{[^}]*\}/);
  assert.ok(pulse, "the breathing rule is the shared one");
  assert.match(pulse[0], /animation: agent-run-pulse 1\.6s var\(--ease-native\) infinite;/, "one cycle, one speed");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.agent-status-icon--pulse \{ animation: none; \}/,
    "and a reduced-motion user gets the identical shape, unanimated");
});
