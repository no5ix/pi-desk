import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (file) => (await readFile(new URL(file, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/**
 * The phone's expand button, in the shell's own words.
 *
 * Upstream hides the panel's expand button on a phone, because there the card
 * already spans the width. This fork keeps it: the Git view (a branch tree, a
 * commit list, a diff) is the view that cannot live in a short card, so on a phone
 * "expand" means the whole viewport. Two things made the button a lie: the shell
 * computed the full-width class with `&& !isMobile`, and the phone's CSS pinned the
 * card to the viewport with `top: 0 !important`. The button was pressed, its state
 * moved, and the card did not.
 *
 * `e2e/mobile-panel-expand.mjs` measures the boxes in a real browser at 390px.
 * These assertions keep the shell's rule — the class, the words, the state — which
 * a browser measurement of a fixture cannot see.
 */

test("a phone's expanded panel is the viewport, and the same class carries it", async () => {
  const shell = await read("./AppShell.tsx");
  assert.match(shell, /const rightPanelFullWidth = rightPanelOpen && rightPanelExpanded && !isMobile;/,
    "the desktop's full width stays the desktop's");
  assert.match(shell, /const rightPanelViewportFull = rightPanelOpen && rightPanelExpanded && isMobile;/,
    "the phone's expanded panel is its own state, not an exclusion");
  assert.match(shell, /\$\{rightPanelFullWidth \|\| rightPanelViewportFull \? " right-panel-full-width" : ""\}/,
    "one class carries both, and the phone's CSS answers it with the viewport");
  assert.match(shell, /const rightPanelExpandedVisual = rightPanelFullWidth \|\| rightPanelViewportFull;/,
    "the button's pressed state and icon follow what the reader sees, in either shell");
});

test("the state is cleared when it stops meaning anything, not because the shell is a phone", async () => {
  const shell = await read("./AppShell.tsx");
  assert.doesNotMatch(shell, /if \(!rightPanelOpen \|\| isMobile\) setRightPanelExpanded\(false\);/,
    "clearing the state whenever the shell is a phone is what made the button a press that changed nothing");
  assert.match(shell, /if \(!rightPanelOpen\) setRightPanelExpanded\(false\);/,
    "a closed panel starts unexpanded");
  assert.match(shell, /setRightPanelExpanded\(false\);\s*\}, \[isMobile\]\);/,
    "crossing the phone/desktop boundary starts fresh: the word changes meaning");
});

test("the phone's button says what it does, in three languages", async () => {
  const shell = await read("./AppShell.tsx");
  assert.match(shell, /aria-pressed=\{rightPanelExpandedVisual\}/, "the pressed state is the visible one");
  assert.match(shell, /isMobile\s*\n\s*\? \(rightPanelExpandedVisual \? "files\.shrinkPanel" : "files\.expandViewport"\)/,
    "on a phone the button says the screen and the card, not the width");
  const packs = await read("../lib/i18n/locale-plugins.ts");
  for (const key of ["files.expandViewport", "files.shrinkPanel"]) {
    const hits = packs.match(new RegExp(`"${key}": "[^"]+"`, "g")) ?? [];
    assert.equal(hits.length, 3, `${key} exists in en, zh-CN and zh-TW`);
  }
});

test("the phone's card leaves the conversation above it, and expanded is the screen", async () => {
  const css = await read("../app/native-theme.css");
  const block = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\.right-panel-container\.right-panel-open\.right-panel-full-width \{[\s\S]*?\}\s*\}/);
  assert.ok(block, "the phone block carries both panel states");
  assert.match(block[0], /\.file-panel-expand-button \{\s*display: inline-flex;/,
    "the button is kept on the phone, in the corner it has on the desktop");
  assert.match(block[0], /\.right-panel-container\.right-panel-open:not\(\.right-panel-full-width\) \{\s*top: 52px !important;\s*height: auto !important;/,
    "unexpanded carries !important: the phone block pins the card with !important, and a rule without it loses");
  assert.match(block[0], /\.right-panel-container\.right-panel-open\.right-panel-full-width \{\s*top: 0;\s*bottom: 0;\s*height: var\(--app-viewport-height, 100dvh\);/,
    "expanded is the viewport");
});
