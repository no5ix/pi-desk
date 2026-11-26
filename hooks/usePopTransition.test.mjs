import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { POP_EXIT_MS, popStep } from "./usePopTransition.ts";

/**
 * Every popup that opens on a click or a hover arrives and leaves with motion
 * (app/native-theme.css, `app-pop-in` / `app-pop-out`).
 *
 * A disappearance cannot be animated by CSS alone when the owner unmounts the node on the
 * click that closed it: the node is gone. So the popup's owner keeps it for the length of
 * the animation and puts `is-closing` on it — the idiom the settings dialog introduced,
 * now shared through hooks/usePopTransition.ts, whose machine is checked here, together
 * with the sheet that plays it and the call sites that use it.
 */

const css = (await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
const cssText = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies = [];
  for (const match of css.matchAll(new RegExp(`(^|[,\\s])${escaped}\\s*(?=,|\\{)`, "g"))) {
    const open = css.indexOf("{", match.index + match[0].length);
    assert.ok(open > 0, `${selector} has a rule`);
    bodies.push(css.slice(open + 1, css.indexOf("}", open)));
  }
  return bodies.join("\n");
};
const declared = (selector, property) =>
  cssText(selector).split(";").map((d) => d.replace(/\s+/g, " ").trim())
    .filter((d) => d.startsWith(`${property}:`));

test("the machine only exits from a popup that is showing", () => {
  assert.equal(popStep(false, true), "open", "a click opens");
  assert.equal(popStep(true, false), "exit", "a click on an open popup starts its exit");
  assert.equal(popStep(true, true), "idle", "a popup that stays open takes no step");
  // Re-opened mid-exit: the owner's flag went false and true again, so the way back in is
  // the open step, and the node never left.
  assert.equal(popStep(false, true), "open", "a popup re-opened mid-exit takes the open step");
  assert.equal(popStep(false, false), "idle", "a popup that has never opened mounts nothing and animates nothing");
});

test("the hold lasts exactly as long as the animation it waits for", () => {
  const [duration] = declared(".native-popover.is-closing", "animation");
  assert.match(duration, /animation: app-pop-out var\(--dur-fast\) var\(--ease-native\) both/,
    "the exit is the app's shared out motion at the shared length");
  const fast = /--dur-fast: (\d+)ms/.exec(css);
  assert.ok(fast, "--dur-fast is a length in ms");
  assert.equal(Number(fast[1]), POP_EXIT_MS,
    `the unmount (POP_EXIT_MS=${POP_EXIT_MS}) fires as the animation ends (${fast[1]}ms), not before`);
  const shift = /--pop-shift: (\d+)px/.exec(css);
  assert.ok(shift && Number(shift[1]) <= 8, "a popup travels a hand's width, not across the page");
});

test("both shared surfaces arrive and leave, and the exit is click-dead", () => {
  // The composer's menus already grew in; every other `.app-menu` (the menus, the
  // header's cards, the pickers) now does too, from the edge the trigger is at.
  assert.match(cssText(".native-popover:not(.animated-native-popover)"), /animation: native-popover-in/);
  assert.match(cssText(".app-menu:not(.native-popover):not(.animated-native-popover)"),
    /animation: app-pop-in var\(--dur-fast\) var\(--ease-native\) both/);
  assert.match(cssText(".app-menu:not(.native-popover):not(.animated-native-popover)"),
    /transform-origin: var\(--pop-origin, top center\)/,
    "a menu grows down out of the control that opened it");
  for (const selector of [".native-popover.is-closing", ".app-menu.is-closing"]) {
    assert.match(cssText(selector), /animation: app-pop-out/);
    assert.match(cssText(selector), /pointer-events: none/, "a closing popup never swallows a tap meant for what is under it");
  }
  // The exit rules sit after the entrances, at equal specificity, so they win.
  const entrances = css.indexOf("@keyframes app-pop-in");
  assert.ok(css.indexOf(".native-popover.is-closing") > entrances, "the exit is declared after the entrance");
  assert.ok(
    css.indexOf(".app-menu:not(.native-popover):not(.animated-native-popover)") < css.indexOf(".app-menu.is-closing"),
    "in source order: entrance, then exit");

  const reduced = css.split("@media (prefers-reduced-motion: reduce)").slice(1)
    .map((block) => block.slice(0, block.indexOf("}") + 2)).join("\n");
  for (const selector of [".app-menu:not(.native-popover):not(.animated-native-popover)", ".native-popover.is-closing", ".app-menu.is-closing"]) {
    assert.ok(reduced.includes(selector), `${selector} is listed in a reduced-motion block`);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app-menu\.is-closing \{\s*animation: none;/,
    "the motion is opt-out, as everywhere else in the app");
});

test("the popups route through the hook, and keep their node only while closing", async () => {
  // The owner of a popup calls the hook; a panel component the owner renders animates from
  // the `closing` flag it is handed. Both halves are named, because a popup that lost its
  // half blinks out again, and the pairing is the point.
  const owners = [
    "AppShell.tsx", "ChatInput.tsx", "ModelSelector.tsx", "SessionAutomationMenu.tsx",
    "SessionSidebar.tsx", "ComposerBranchMenu.tsx", "DomContextMenuHost.tsx",
    "ComposerProjectChip.tsx", "BranchNavigator.tsx", "TopbarTip.tsx", "path-ui.tsx",
    "AppCombobox.tsx",
  ];
  const sources = await Promise.all(
    owners.map((name) => readFile(new URL(`../components/${name}`, import.meta.url), "utf8")),
  );

  for (const [index, source] of sources.entries()) {
    assert.match(source, /usePopTransition\(/, `${owners[index]} holds its popup for the exit`);
    // The state goes on the popup's own class, or into a panel component that puts it there.
    assert.match(
      source,
      /\.className\b|is-closing|popClass\(|closing=\{pop\.closing\}|closing=\{\w+\.closing\}/,
      `${owners[index]} puts the closing state on the popup`,
    );
  }
  for (const name of ["ProjectContextMenu.tsx", "ProjectViewMenu.tsx", "ChatsSectionMenu.tsx"]) {
    const panel = await readFile(new URL(`../components/${name}`, import.meta.url), "utf8");
    assert.match(panel, /closing\??\s*:\s*boolean/, `${name} takes the closing flag from its owner`);
    assert.match(panel, /is-closing|popClass\(/, `${name} plays the shared exit`);
  }
  // A popup that is kept mounted must not keep listening, or a closing menu closes the
  // menu opened on top of it: every outside handler is keyed on the open flag, not on
  // the mounted flag.
  const shell = sources[0];
  const handlers = [...shell.matchAll(/useEffect\(\(\) => \{[\s\S]*?addEventListener\("mousedown"[\s\S]*?\}, \[([^\]]*)\]\);/g)]
    .map((m) => m[1]);
  assert.ok(handlers.length > 0, "the shell has outside-click handlers");
  for (const deps of handlers) {
    assert.ok(!/Transition|\.mounted/.test(deps), `an outside-click effect keys on open (${deps})`);
  }
});
