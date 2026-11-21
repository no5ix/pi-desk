import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { SIDEBAR_FOLD_MS } = await createJiti(import.meta.url, { interopDefault: true, moduleCache: false })
  .import("./sidebar-fold-motion.ts");

// The sidebar's project fold animates. A closing fold needs its rows mounted for the
// animation, and the rest of the sidebar treats a folded project as having no rows, so
// the mount window is the whole contract of this module.

const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const source = readFileSync(new URL("./sidebar-fold-motion.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the JS unmount delay outlives the CSS animation, and both are one step", () => {
  const durBase = css.match(/^\s*--dur-base: (\d+)ms;$/m);
  assert.ok(durBase, "--dur-base is the fork's animation length token");
  assert.equal(SIDEBAR_FOLD_MS, Number(durBase[1]), "the module's length is the CSS token, not a second opinion");
  assert.match(source, /durationMs = SIDEBAR_FOLD_MS \+ 20/, "the unmount happens after the animation ends, never during it");
});

test("only the roots that just closed stay mounted, and they are cleared", () => {
  assert.match(source, /export function useCollapseExit\(collapsed: Set<string>, durationMs = SIDEBAR_FOLD_MS \+ 20\): Set<string>/);
  assert.match(source, /const closing = \[\.\.\.collapsed\]\.filter\(\(root\) => !before\.has\(root\)\);/,
    "expanding adds nothing to the mounted set");
  assert.match(source, /if \(closing\.length === 0\) return;/, "an unrelated state change starts no timer");
  assert.match(source, /for \(const root of closing\) next\.delete\(root\);/, "the rows unmount when the animation is over");
  assert.match(source, /return \(\) => clearTimeout\(timer\);/, "a re-render mid-animation drops the stale timer");
  assert.match(source, /if \(!mounted\.current\) return;/, "an unmounted sidebar never sets state");
  assert.match(source, /Call it once with the whole collapsed set/,
    "the sidebar renders projects in a loop, so a per-project hook would change the hook count");
});

test("the sidebar wires the fold, keeps the keyboard walk clean, and leaves Chats as it was", () => {
  assert.match(sidebar, /import \{ useCollapseExit \} from "@\/lib\/sidebar-fold-motion";/);
  assert.match(sidebar, /const closingProjects = useCollapseExit\(collapsedProjects\);/);
  assert.match(sidebar, /\{!isCollapsed \|\| closingProjects\.has\(group\.projectRoot\) \? \(\s*<div\s*className="sidebar-project-tree-children"\s*data-fold=\{isCollapsed \? "closing" : "open"\}/);
  assert.match(sidebar, /\.filter\(\(row\) => !row\.closest\("\[data-fold=\\"closing\\"\]"\)\)/,
    "the arrow-key row walk never lands on a row that is folding away");
  assert.match(sidebar, /\{!chatsFolded && \(\s*<div className="sidebar-project-tree-children sidebar-chats-list">/,
    "the Chats fold keeps the conditional render its test pins");
});

test("the CSS animates both ways, degrades to the old instant fold, and honours reduced motion", () => {
  assert.match(css, /@keyframes sidebar-project-fold-open \{/);
  assert.match(css, /@keyframes sidebar-project-fold-close \{/);
  assert.match(css, /\.sidebar-project-tree-children\[data-fold="open"\] \{\s*animation: sidebar-project-fold-open var\(--dur-base\) var\(--ease-native\) both;/);
  assert.match(css, /\.sidebar-project-tree-children\[data-fold="closing"\] \{[\s\S]*?pointer-events: none;/, "a closing fold stops taking clicks");
  assert.match(css, /@starting-style \{\s*\.sidebar-project-tree-children\[data-fold="open"\] \{ height: 0; opacity: 0; \}/,
    "a mounted fold starts closed, so opening is a transition and not a jump");
  assert.match(css, /@supports \(interpolate-size: allow-keywords\) \{[\s\S]*?transition: height var\(--dur-base\)/,
    "where an auto height can be animated, the rows below slide");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.sidebar-project-tree-children\[data-fold\] \{ animation: none; transition: none; \}/);
});
