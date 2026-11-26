import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");

// The topbar's More menu must live in a <body> portal: .app-topbar is a
// z-index 90 stacking context and the open file panel (z-index 100) used to
// paint over the inline menu, so every real pointer click hit the panel instead
// of the menu. An "inline menu + panel open" click was unclickable.
test("the More menu is portaled to the body so the open file panel cannot cover it", () => {
  // The menu is mounted while the *transition* says so, not while the click flag is set:
  // the closing menu has to stay on screen for the exit to be seen (hooks/usePopTransition).
  assert.match(source, /topMorePop\.mounted && topMorePos && createPortal\(/);
  assert.match(source, /document\.body/);
  // Fixed positioning is computed from the trigger rect, not the old absolute
  // "calc(100% + 7px) / right: -2px" that only worked inside the topbar.
  assert.match(source, /position: "fixed", zIndex: 700/);
  // The menu measures itself and flips above the trigger when the space below
  // is too small, so its last entries never fall off the window.
  assert.match(source, /useMenuPlacement\(topMoreOpen \? topMoreAnchor : null, topMoreMenuRef\)/);
  assert.match(source, /placedTopMorePos\.top, left: placedTopMorePos\.left/);
  assert.match(source, /setTopMorePos\(\{ top: rect\.bottom \+ 7, right: window\.innerWidth - rect\.right - 2 \}\)/);
});

test("outside-click containment covers both the trigger and the portaled menu", () => {
  assert.match(source, /topMoreRef\.current\?\.contains\(event\.target as Node\)/);
  assert.match(source, /topMoreMenuRef\.current\?\.contains\(event\.target as Node\)/);
});
// The trigger is icon-only, and two rules make its box wider than the glyph: the
// coarse-pointer 44px minimum for topbar buttons and the 1120px padding trim. The
// inline flex-start then left the three dots ~8px left of the box's centre on a
// phone (iPhone 16 Pro Max) and on a coarse-pointer desktop.
test("the More trigger centres its dots in the box the touch rules give it", () => {
  const trigger = source.match(/<button\s+className="native-toolbar-button app-topbar-more-trigger"[\s\S]*?<\/button>/);
  assert.ok(trigger, "the More trigger renders with its class");
  assert.ok(!/justifyContent/.test(trigger[0]), "the inline style leaves justify-content to the CSS rule");
  const rule = css.slice(css.indexOf(".app-topbar-more-trigger {"), css.indexOf("}", css.indexOf(".app-topbar-more-trigger {")));
  assert.ok(css.includes(".app-topbar-more-trigger {"), "the fork CSS centres the trigger");
  assert.match(rule, /justify-content: center;/);
  // The rules that widen the box, so a change here means re-checking the centring.
  assert.match(css, /@media \(pointer: coarse\) \{[\s\S]*?\.app-topbar \.native-toolbar-button \{ min-width: 44px; min-height: 44px; \}/);
  assert.match(css, /@media \(max-width: 1120px\) \{[\s\S]*?\.app-topbar-actions \.native-toolbar-button \{\s*padding: 0 7px !important;/);
});
test("the dots stay an SVG, not text that rides the baseline", () => {
  // "···" as text sits on the text baseline, so it reads high in a 44px box on
  // iOS; the glyph is three circles that flex-centre with the box.
  const trigger = source.match(/<button\s+className="native-toolbar-button app-topbar-more-trigger"[\s\S]*?<\/button>/)[0];
  assert.match(trigger, /<circle cx="5" cy="12" r="1\.65" \/>\s*<circle cx="12" cy="12" r="1\.65" \/>\s*<circle cx="19" cy="12" r="1\.65" \/>/);
  assert.ok(!/[·⋯…]/.test(trigger), "no text dots in the trigger");
});
