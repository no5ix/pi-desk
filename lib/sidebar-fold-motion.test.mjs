import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

// The sidebar's project fold.
//
// A fold is smooth only when the element's own height changes: the projects and sessions
// below it are laid out in the same column, so a height transition moves them with the
// content, from the first frame. The previous attempt animated `clip-path` and `opacity`
// (with an `interpolate-size` transition of an `auto` height where the browser knew it):
// the rows were clipped, the layout height never changed, and the list below jumped when
// the rows were finally unmounted. These tests pin the height mechanism on both sides.

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const mod = await jiti.import("./sidebar-fold-motion.ts");
const { applySidebarFold, SIDEBAR_FOLD_MS, SIDEBAR_FOLD_SETTLE_MS } = mod;

const source = readFileSync(new URL("./sidebar-fold-motion.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const sidebar = readFileSync(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

// --- a stand-in for the fold element, sufficient for applySidebarFold ---------------

const savedWindow = globalThis.window;
const savedComputedStyle = globalThis.getComputedStyle;
const savedRaf = globalThis.requestAnimationFrame;

function fakeFold({ contentHeight = 320, currentHeight = 320, fold = "opening" } = {}) {
  const listeners = new Map();
  return {
    // React writes the `data-fold` prop onto dataset; the module reads it and removes it
    // when an opening fold settles, so the stand-in models both sides.
    dataset: { fold },
    style: {},
    removeAttribute(name) {
      const key = name.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      delete this.dataset[key];
    },
    offsetHeight: currentHeight,
    scrollHeight: contentHeight,
    events: [],
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) listeners.delete(type);
    },
    listenerCount(type) {
      return listeners.has(type) ? 1 : 0;
    },
    emit(type, event) {
      const handler = listeners.get(type);
      if (handler) handler({ target: this, type, propertyName: "height", ...event });
    },
  };
}

function environment({ reducedMotion = false } = {}) {
  globalThis.window = { matchMedia: () => ({ matches: reducedMotion }) };
  globalThis.getComputedStyle = () => ({ paddingBottom: "4px" });
  const frames = [];
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  return {
    /** Runs the queued animation frames: this is where the end state is set. */
    flush() {
      const pending = frames.splice(0, frames.length);
      for (const frame of pending) frame();
    },
  };
}

test.afterEach(() => {
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
  if (savedComputedStyle === undefined) delete globalThis.getComputedStyle;
  else globalThis.getComputedStyle = savedComputedStyle;
  if (savedRaf === undefined) delete globalThis.requestAnimationFrame;
  else globalThis.requestAnimationFrame = savedRaf;
});

// --- the collapse bookkeeping -------------------------------------------------------

test("the fold's numbers are one step on both sides", () => {
  assert.equal(SIDEBAR_FOLD_MS, 240, "240ms: the user asked for 200-300ms of visible movement");
  assert.ok(SIDEBAR_FOLD_SETTLE_MS > SIDEBAR_FOLD_MS, "the safety net outlives the transition");
  assert.match(css, /--dur-fold: 240ms;/);
  assert.match(css, /--ease-fold: cubic-bezier\(0\.32, 0\.72, 0, 1\);/, "eases out like the native sidebar");
});

test("a closing root stays mounted, and an opening root is recognised as a user action", () => {
  // The hook is a React hook, so its rules are pinned at the source: which roots stay
  // mounted, and the rule that a list that mounted open is not an expansion.
  assert.match(source, /const justClosed = \[\.\.\.collapsed\]\.filter\(\(root\) => !before\.has\(root\)\);/);
  assert.match(source, /const opening = useMemo\(\(\) => \{\n\s*const before = lastRendered\.current;\n\s*if \(before === collapsed\) return new Set<string>\(\);\n\s*return new Set\(\[\.\.\.before\]\.filter\(\(root\) => !collapsed\.has\(root\)\)\);\n\s*\}, \[collapsed\]\);/,
    "which roots open is known during render: the element's ref runs before any effect, so an effect-computed answer never plays the opening");
  assert.match(source, /const timer = setTimeout\(\(\) => \{[\s\S]*?for \(const root of justClosed\) next\.delete\(root\);[\s\S]*?\}, safetyMs\);/,
    "a transition that never reports (a hidden tab) must not pin the rows forever");
  assert.match(source, /const settle = \(root: string\) => \{\n\s*setClosing\(\(prev\) => \{\n\s*if \(!prev\.has\(root\)\) return prev;/,
    "the height transition, not the timer, is what normally unmounts the rows");
  assert.match(source, /if \(!options\.closed && !options\.animateOpen\) \{\n\s*element\.removeAttribute\("data-fold"\);\n\s*return;\n\s*\}/,
    "a project list that mounted open (a page load, a project added) does not play");
});

// --- the element animation ----------------------------------------------------------

test("closing sets a numeric height the browser can interpolate, then zero", () => {
  const frames = environment();
  const element = fakeFold({ currentHeight: 320, contentHeight: 320 });
  let settled = 0;
  applySidebarFold(element, { closed: true, animateOpen: false, onSettled: () => { settled += 1; } });
  assert.equal(element.style.height, "320px", "the start state is laid out before the end state is set");
  assert.equal(element.style.paddingBottom, "4px");
  assert.equal(settled, 0, "the rows are still mounted while it shrinks");
  frames.flush();
  assert.equal(element.style.height, "0px", "the layout height itself animates to zero");
  assert.equal(element.style.paddingBottom, "0px", "the resting padding is part of the movement, not a snap after it");
  element.emit("transitionend");
  assert.equal(settled, 1, "the caller unmounts the rows when the height arrives");
  assert.equal(element.listenerCount("transitionend"), 0, "the listener goes with the transition");
});

test("opening runs the same transition upward and hands the height back to the layout", () => {
  const frames = environment();
  const element = fakeFold({ currentHeight: 320, contentHeight: 320 });
  applySidebarFold(element, { closed: false, animateOpen: true, onSettled: () => { throw new Error("an opening fold has nothing to unmount"); } });
  assert.equal(element.style.height, "0px", "it starts closed");
  frames.flush();
  assert.equal(element.style.height, "320px", "to the measured content height");
  element.emit("transitionend");
  assert.equal(element.style.height, "", "back to an auto height, so a session added later is not trapped");
  assert.equal(element.dataset.fold, undefined, "the animation state does not linger on the element");
  assert.equal(element.dataset.foldApplied, "opening", "the element remembers the state, so a re-render does not replay it");
});

test("a rapid click replaces the transition instead of finishing it in the old direction", () => {
  const frames = environment();
  const element = fakeFold({ currentHeight: 320, contentHeight: 320 });
  applySidebarFold(element, { closed: false, animateOpen: true, onSettled: () => {} });
  frames.flush();
  assert.equal(element.style.height, "320px");
  // The user clicks closed halfway through, before any transitionend: React writes
  // `data-fold="closing"` and the ref runs. The height animates from where it is now, and
  // the opening transition's finisher must not run afterwards.
  element.dataset.fold = "closing";
  applySidebarFold(element, { closed: true, animateOpen: false, onSettled: () => { element.settled = true; } });
  assert.equal(element.style.height, "320px", "the new transition starts from the height reached");
  frames.flush();
  assert.equal(element.style.height, "0px");
  element.emit("transitionend");
  assert.equal(element.settled, true, "the closing transition's own finisher ran");
  assert.equal(element.style.height, "0px", "the opening finisher did not clear the height behind it");
  assert.equal(element.dataset.fold, "closing", "a closing fold keeps its state until it unmounts");
});

test("calling it on every render does not restart the animation", () => {
  const frames = environment();
  const element = fakeFold();
  const calls = [];
  const onSettled = () => calls.push("settled");
  applySidebarFold(element, { closed: true, animateOpen: false, onSettled });
  const heightAfterFirst = element.style.height;
  applySidebarFold(element, { closed: true, animateOpen: false, onSettled });
  applySidebarFold(element, { closed: true, animateOpen: false, onSettled });
  assert.equal(element.style.height, heightAfterFirst, "the element remembers the state it was put into");
  frames.flush();
  element.emit("transitionend");
  assert.deepEqual(calls, ["settled"], "one transition, one settle");
});

test("reduced motion jumps to the end state and releases the rows at once", () => {
  const frames = environment({ reducedMotion: true });
  const element = fakeFold();
  let settled = 0;
  applySidebarFold(element, { closed: true, animateOpen: false, onSettled: () => { settled += 1; } });
  assert.equal(element.style.height, undefined, "no height animation is started");
  assert.equal(settled, 1);
  frames.flush();
});

// --- the CSS and the sidebar wiring -------------------------------------------------

test("the CSS transitions the height, and nothing paints-only", () => {
  const foldRules = css.match(/\.sidebar-project-tree-children\[data-fold="opening"\],\n\.sidebar-project-tree-children\[data-fold="closing"\] \{[\s\S]*?\n\}/);
  assert.ok(foldRules, "one rule for both directions");
  assert.match(foldRules[0], /overflow: hidden;/, "the content is clipped by the shrinking box, not by clip-path");
  assert.match(foldRules[0], /transition:\s*\n?\s*height var\(--dur-fold\) var\(--ease-fold\),/);
  assert.match(foldRules[0], /padding-bottom var\(--dur-fold\) var\(--ease-fold\),/);
  assert.match(foldRules[0], /opacity var\(--dur-fold\) var\(--ease-fold\);/);
  assert.match(css, /\.sidebar-project-tree-children\[data-fold="closing"\] \{\n\s*pointer-events: none;\n\}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n\s*\/\* The module jumps to the end state[\s\S]*?\n\s*\.sidebar-project-tree-children\[data-fold\] \{ transition: none; \}/);
  assert.ok(!/sidebar-project-fold-open|sidebar-project-fold-close/.test(css), "no keyframes left behind: they were the paint-only animation");
  assert.ok(!/@supports \(interpolate-size|interpolate-size:/.test(css),
    "no @supports (interpolate-size) path: an `auto` height is not animatable on every Safari, and pixels are");
});

test("the sidebar drives the fold from the element, keeps the keyboard walk clean, and leaves Chats as it was", () => {
  assert.match(sidebar, /import \{ applySidebarFold, useProjectFold \} from "@\/lib\/sidebar-fold-motion";/);
  assert.match(sidebar, /const projectFold = useProjectFold\(collapsedProjects\);/, "one hook for the whole loop");
  assert.match(sidebar, /\{!isCollapsed \|\| projectFold\.closing\.has\(group\.projectRoot\) \? \(/,
    "a closing fold keeps its rows mounted, and only while it shrinks");
  assert.match(sidebar, /data-fold=\{isCollapsed \? "closing" : "opening"\}/);
  assert.match(sidebar, /ref=\{\(element\) => \{\n\s*if \(!element\) return;\n\s*applySidebarFold\(element, \{\n\s*closed: isCollapsed,\n\s*animateOpen: projectFold\.opening\.has\(group\.projectRoot\),\n\s*onSettled: \(\) => projectFold\.settle\(group\.projectRoot\),/,
    "the animation is applied to the element in the ref, so a rapid click starts from the current height");
  assert.match(sidebar, /\.filter\(\(row\) => !row\.closest\("\[data-fold=\\"closing\\"\]"\)\);/,
    "the row walk never focuses a row that is shrinking away");
  assert.match(sidebar, /<div className="sidebar-project-tree-children sidebar-chats-list">/,
    "the Chats fold keeps its own conditional render");
});
