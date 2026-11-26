import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// The composer's corner: a button in the card's top-right that turns the card into a
// tall editor, and the same mark turned around as the way back. The screenshots asked for
// the button collapsed and the button expanded; what is pinned here is the pair of states,
// the room the glyph takes out of the text, and the fact that folding the card shrinks it.

const chatInput = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const icon = readFileSync(new URL("./ComposerExpandIcon.tsx", import.meta.url), "utf8");
const prefs = readFileSync(new URL("../lib/app-prefs.ts", import.meta.url), "utf8");

test("the collapsed card carries the corner, and the expanded card carries the way back", () => {
  const button = /<button[\s\S]{0,700}?className="chat-composer-expand"[\s\S]*?<\/button>/.exec(chatInput);
  assert.ok(button, "the composer draws a corner button of its own");
  const markup = button[0];
  for (const state of ["chat.expandComposer", "chat.collapseComposer"]) {
    assert.ok(markup.includes(state), `the corner is labelled for both states (${state})`);
  }
  assert.ok(/data-expanded=\{expanded \? "true" : "false"\}/.test(markup), "the corner states which end of the gesture it is");
  assert.ok(/aria-expanded=\{expanded\}/.test(markup), "the corner tells a reader what is expanded");
  assert.ok(/<ComposerExpandIcon expanded=\{expanded\} \/>/.test(markup), "one glyph, turned by the state");
  assert.ok(chatInput.includes("className={`chat-composer${compact ? \" is-compact\" : \"\"}${expanded ? \" is-expanded\" : \"\"}"),
    "the card carries the expanded state, so the stylesheet owns the height");
  assert.ok(chatInput.includes('" has-expand"'), "and the state that reserves the text's gutter");
});

test("the corner is not drawn where there is no room to grow", () => {
  assert.ok(/!compact && onExpandedChange &&/.test(chatInput), "the quote composer's card gets no corner");
  assert.ok(/onExpandedChange\?: \(expanded: boolean\) => void;/.test(chatInput), "absent means no button, stated in the props");
  assert.ok(/onExpandedChange=\{panel \? undefined : handleComposerExpanded\}/.test(chatWindow),
    "a docked side chat has no corner: its column is a panel beside the chat");
  assert.ok(/expanded=\{panel \? false : composerExpanded\}/.test(chatWindow), "and it never opens expanded");
});

test("the corner's choice is remembered, because it is a way of writing", () => {
  assert.ok(/composerExpanded: "pi-composer-expanded"/.test(prefs), "the preference is a key of its own");
  assert.ok(/useState\(\(\) => getPrefBool\(APP_PREF_KEYS\.composerExpanded, false\)\)/.test(chatWindow),
    "the card opens as the device left it, collapsed by default");
  assert.ok(/setPrefBool\(APP_PREF_KEYS\.composerExpanded, next\)/.test(chatWindow), "and the corner writes it back");
});

test("folding the card runs the composer's own autosize again", () => {
  const effect = /useEffect\(\(\) => \{[\s\S]{0,700}\}, \[expanded\]\);/.exec(chatInput);
  assert.ok(effect, "an effect keyed to the corner's state");
  const body = effect[0];
  assert.ok(body.includes('ta.style.height = "auto"'), "expanded: the box is released to the stylesheet");
  // Reading `scrollHeight` inside the tall editor reports the editor's height, not the
  // text's; the fold releases the box first, pins the height the reader sees, flushes it,
  // and only then sets the height the collapsed card uses.
  assert.ok(body.includes('ta.style.height = "auto";') && /const target = Math\.min\(ta\.scrollHeight, 200\)/.test(body),
    "the collapsed height is measured with the box released");
  assert.ok(/const from = ta\.offsetHeight;/.test(body) && /void ta\.offsetHeight;/.test(body),
    "the pair the composer's height transition animates between is pinned and flushed");
});

test("Escape in the field folds the card, and a running agent keeps its abort", () => {
  const fold = /if \(e\.key === "Escape" && !isComposing && expanded && !isStreaming && onExpandedChange\)/.exec(chatInput);
  assert.ok(fold, "the fold is asked for while nothing is streaming");
  const foldAt = fold.index;
  const abortAt = chatInput.indexOf('e.key === "Escape" && !isComposing && isStreaming && onAbort');
  assert.ok(abortAt > foldAt, "the abort branch stays below it, so a run is never left without its Stop");
});

test("the corner's mark is the same shape turned around", () => {
  assert.ok(/expanded \? \(/.test(icon), "one component, two states");
  for (const path of ['d="M14 4h6v6"', 'd="M10 20H4v-6"', 'd="M4 10h6V4"', 'd="M20 14h-6v6"']) {
    assert.ok(icon.includes(path), `the glyph carries ${path}`);
  }
  assert.ok(icon.includes('aria-hidden="true"'), "the button's label carries the meaning, not the drawing");
});
