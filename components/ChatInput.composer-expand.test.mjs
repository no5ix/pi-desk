import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// The composer's corner: the way into the tall editor, and the same mark turned around as
// the way back. It is NOT part of the resting card: a one-line prompt is a one-row card and
// carries no affordance above it, so the corner arrives with the second line — typed or
// wrapped, both measured — and leaves when the prompt shrinks back to a line. It sits in the
// card's UPPER-LEFT (the card's right corner is Send's arc, and a glyph there sat on top of
// the arrow), and the text stops short of it. What is pinned here: the pair of states, the
// measurement that decides when the corner exists, the gutter the glyph takes out of the
// text, and the fact that the expanded card is still the one row the resting card is.

const chatInput = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const icon = readFileSync(new URL("./ComposerExpandIcon.tsx", import.meta.url), "utf8");
const heightSource = readFileSync(new URL("../lib/composer-textarea-height.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8");

/** One CSS block, by selector. The fork indents whole sections, so the selector only has
    to open its own line; the block runs to the `}` that closes its line. `nth` walks past
    the first match, which is how a `pointer: coarse` override is read next to its base. */
function cssRule(source, selector, nth = 0) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\n\\s*${escaped}\\s*\\{`, "g");
  let seen = 0;
  for (let at = re.exec(source); at; at = re.exec(source)) {
    if (seen++ === nth) return source.slice(at.index, source.indexOf("\n}", at.index));
  }
  return null;
}

test("the corner exists, and it is drawn only when there is a second line", () => {
  const corner = /cornerVisible && \(\s*<button[\s\S]*?className="chat-composer-expand"[\s\S]*?<\/button>/.exec(chatInput);
  assert.ok(corner, "the composer draws a corner button of its own, and it is gated");
  const markup = corner[0];
  for (const state of ["chat.expandComposer", "chat.collapseComposer"]) {
    assert.ok(markup.includes(state), `the corner is labelled for both states (${state})`);
  }
  assert.ok(/data-expanded=\{expanded \? "true" : "false"\}/.test(markup), "the corner states which end of the gesture it is");
  assert.ok(/aria-expanded=\{expanded\}/.test(markup), "the corner tells a reader what is expanded");
  assert.ok(/onClick=\{\(\) => onExpandedChange\?\.\(!expanded\)\}/.test(markup), "the host owns the state: the composer only asks");
  assert.ok(/<ComposerExpandIcon expanded=\{expanded\} \/>/.test(markup), "one glyph, turned by the state");
  // The resting card is a one-row card: a corner above a one-line prompt is a glyph for a
  // gesture that does nothing, and it pushed the text into a gutter it did not need.
  assert.ok(/const cornerVisible = !compact && Boolean\(onExpandedChange\) && \(expanded \|\| textLines > 1\);/.test(chatInput),
    "compact (the quote box) has no corner, no host means no corner, and the corner needs the editor open OR a prompt past one line");
  assert.ok(/const \[textLines, setTextLines\] = useState\(1\);/.test(chatInput),
    "the line count is the composer's own measurement, not a `\\n` count: a long sentence WRAPS, and a wrapped sentence must raise the corner like a typed newline");
  assert.ok(chatInput.indexOf("const cornerVisible") < chatInput.indexOf('className={`chat-composer'),
    "the card's class list is built from the same answer the corner is drawn from");
  assert.ok(/className=\{`chat-composer\$\{compact \? " is-compact" : ""\}\$\{expanded \? " is-expanded" : ""\}\$\{cornerVisible \? " has-expand" : ""\}`\}/.test(chatInput),
    "the card carries the expanded state, so the stylesheet owns the height, and the gutter class only with the corner: `has-expand` on a resting card indents a one-line prompt for a glyph that is not there");
});

test("the corner is measured out of the box, released and restored", () => {
  // Counting lines in the string never sees a wrap, and reading `scrollHeight` on the box
  // the composer sized reports that size, not the text's: the corner stayed hidden on a
  // wrapped sentence and appeared on a card that was only tall. So the count comes from the
  // element, released from every height bound it carries. `!important` inline declarations
  // are the only thing that beats the expanded editor's stylesheet `!important`.
  assert.match(chatInput, /import \{ growComposerTextarea, measureComposerTextLines \} from "@\/lib\/composer-textarea-height";/,
    "the count is asked of the module that owns the composer's height, next to the autosize it shares the box with");
  const measure = /export function measureComposerTextLines\(textarea: HTMLTextAreaElement\): number \{[\s\S]*?\n\}/.exec(heightSource);
  assert.ok(measure, "the measurement is exported");
  const body = measure[0];
  assert.ok(/const properties = \["height", "min-height", "max-height"\] as const;[\s\S]*?const saved = properties\.map/.test(body),
    "all three bounds are saved, by their CSS names: getPropertyValue and removeProperty speak CSS, and a camelCase name reads back empty — which leaves the released box behind and the expanded editor with no height of its own");
  assert.ok(/getPropertyPriority\(property\)/.test(body),
    "and each one's priority, because the box it returns to may be `!important`");
  for (const write of [
    'style.setProperty("height", "auto", "important")',
    'style.setProperty("min-height", "0px", "important")',
    'style.setProperty("max-height", "none", "important")',
  ]) {
    assert.ok(body.includes(write), `the release writes ${write}`);
  }
  const read = body.indexOf("textarea.scrollHeight");
  const restore = body.indexOf("for (const { property, value, priority } of saved)");
  assert.ok(read > 0 && restore > read,
    "the height is read between the release and the restore: nothing yields to the browser there, so no frame is painted released (a released box that paints is the flash the smooth growth was asked to replace)");
  assert.ok(/if \(value\) style\.setProperty\(property, value, priority\);\s*\n\s*else style\.removeProperty\(property\);/.test(body),
    "every property is put back, an empty one removed rather than written as \"\"");
  assert.ok(/const slack = Math\.max\(6, line \* 0\.4\);\s*\n\s*return Math\.max\(1, Math\.round\(\(content - slack\) \/ line\)\);/.test(body),
    "one line is one line-height, and the box's own vertical padding (plus a subpixel line box) is taken off before the rounding: a raw round counted a one-line prompt as two, and the corner rose over a resting card");
  const call = /const measureTextLines = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[\]\);/.exec(chatInput);
  assert.ok(call, "the composer wraps the measurement in a callback");
  assert.ok(/measureComposerTextLines\(ta\)/.test(call[0]), "it is the module's function doing the counting");
  assert.ok(/setTextLines\(\(current\) => \(current === lines \? current : lines\)\)/.test(call[0]),
    "the state only moves on a real change: a resize fires on every pixel, and a new array each time would re-render the composer mid-typing");
  assert.ok(/useEffect\(\(\) => \{\s*\n\s*measureTextLines\(\);\s*\n\s*\}, \[value, expanded, composerTier, measureTextLines\]\);/.test(chatInput),
    "the prompt, the tier and the card's own state are what the count depends on");
  assert.ok(/new ResizeObserver\(\(\) => measureTextLines\(\)\)/.test(chatInput) && /observer\.observe\(ta\)/.test(chatInput),
    "and the box is observed: a window drag, a keyboard or an open panel re-wraps the same text, and the corner has to follow");
});

test("a prompt that shrinks back to one line folds the card again", () => {
  // The corner that arrived with the second line has to leave with it, and a card left open
  // as the editor after the last line was deleted kept a tall box around one character.
  const fold = /const wasMultilineRef = useRef\(false\);[\s\S]*?\}, \[textLines, expanded, onExpandedChange\]\);/.exec(chatInput);
  assert.ok(fold, "an effect keyed to the line count");
  const body = fold[0];
  assert.ok(/wasMultilineRef\.current = true;/.test(body) && /textLines > 1/.test(body),
    "the card remembers that it was multiline: the rule only closes a card the corner opened");
  assert.ok(/if \(wasMultilineRef\.current && expanded && onExpandedChange\) onExpandedChange\(false\);/.test(body),
    "and a prompt that returns to one line folds the editor, so opening the editor on an empty box (to write a long prompt in) is kept");
  assert.ok(/wasMultilineRef\.current = false;/.test(body), "and the memory is cleared, so one fold per gesture");
});

test("the corner sits in the card's upper-LEFT, and the text stops short of it", () => {
  const corner = cssRule(css, ".chat-composer > .chat-composer-expand");
  assert.ok(corner, "the corner is styled against the card, as its direct child");
  assert.match(corner, /position: absolute;/, "it is laid over the card's padding band, not added to the row");
  assert.match(corner, /top: 4px;/, "the card's own corner");
  assert.match(corner, /left: 4px;/, "the LEFT corner");
  assert.doesNotMatch(corner, /right:/,
    "no right anchor: the card's right corner is Send's arc, and a corner glyph there sat on the arrow the row is built around");
  assert.match(corner, /width: 26px;[\s\S]*height: 26px;/, "a corner affordance, smaller than the row's discs");
  assert.match(corner, /border-radius: 9px;/, "a plate radius, not Send's disc");
  assert.match(corner, /background: transparent;/, "no plate at rest, so the card stays one surface");
  const coarse = cssRule(css, ".chat-composer > .chat-composer-expand", 1);
  assert.ok(coarse, "a finger's tier is its own block");
  assert.match(coarse, /width: 36px;[\s\S]*height: 36px;[\s\S]*top: 2px;[\s\S]*left: 2px;[\s\S]*border-radius: 12px;/,
    "the glyph is 18px, so the plate it lives on is the touch target");
  // The corner sits in the card's upper-left, ON the text's first line, so the first line
  // steps right of the glyph with `text-indent`. Two shapes failed before it: a
  // `padding-left` of 34px (44px under a finger) moved the whole prompt far from the `+`
  // and opened a second, ragged left column; a `padding-top` of 26px pushed the text under
  // the glyph and left a band of card that clicked into nothing — "I should be able to type
  // in the red frame area".
  const gutter = cssRule(css, ".chat-composer.has-expand .chat-composer-editor > .chat-input-textarea");
  assert.ok(gutter, "the card indents only when the corner is drawn");
  assert.match(gutter, /text-indent: 20px;/, "the 26px plate ends 30px in, the ink starts ~22px in: 20px stands the first line past it");
  for (const dead of ["padding-top", "padding-left", "padding-right"]) {
    assert.ok(!gutter.includes(`${dead}:`), `no ${dead}: the box is the editor from its first pixel, so every line is typeable`);
  }
  const coarseGutter = cssRule(css, ".chat-composer.has-expand .chat-composer-editor > .chat-input-textarea", 1);
  assert.match(coarseGutter ?? "", /text-indent: 30px;/, "and the indent follows the 36px finger plate (its edge is 38px in)");
  assert.ok(!/\.chat-composer\.has-expand[^\n]*\{[^}]*padding-/.test(css),
    "no padding shape anywhere on the expanded card: padding is not typeable, and it is what the ask called out");
});

test("the expanded card stays the row the resting card is", () => {
  // The tall editor is the same composer, taller: the `+`, the controls and Send stay
  // pinned to the text's bottom edge, Send in its arc. A `flex-direction: column` on the
  // expanded card put the controls back under the text and moved Send out of the corner —
  // two geometries for one card, and the animation between them jumped.
  assert.doesNotMatch(css, /\.chat-composer\.is-expanded \.chat-composer-editor\s*\{[^}]*flex-direction: column/,
    "the expanded editor does not become a column");
  const tall = cssRule(css, ".chat-composer.is-expanded .chat-composer-editor > .chat-input-textarea");
  assert.ok(tall, "the editor's height is a rule, not the composer's inline box");
  assert.match(tall, /height: auto !important;/, "it out-inlines the box the composer grew to the text");
  assert.match(tall, /min-height: min\(42dvh, 300px\) !important;/, "the bounds are the card's, not the text's");
  assert.match(tall, /max-height: min\(58dvh, 520px\) !important;/, "so a longer prompt scrolls inside the editor instead of pushing the card past the screen");
  const keyboard = cssRule(css, "html[data-keyboard-open] .chat-composer.is-expanded .chat-composer-editor > .chat-input-textarea");
  assert.match(keyboard, /min-height: calc\(var\(--app-viewport-height, 100dvh\) \* 0\.4\) !important;/,
    "with the keyboard up the editor is measured against the keyboard's own height, never under it");
});

test("the corner's choice is remembered, because it is a way of writing", () => {
  const prefs = readFileSync(new URL("../lib/app-prefs.ts", import.meta.url), "utf8");
  assert.ok(/composerExpanded: "pi-composer-expanded"/.test(prefs), "the preference is a key of its own");
  assert.ok(/useState\(\(\) => getPrefBool\(APP_PREF_KEYS\.composerExpanded, false\)\)/.test(chatWindow),
    "the card opens as the device left it, collapsed by default");
  assert.ok(/setPrefBool\(APP_PREF_KEYS\.composerExpanded, next\)/.test(chatWindow), "and the corner writes it back");
});

test("the corner is not drawn where there is no room to grow", () => {
  assert.ok(/onExpandedChange\?: \(expanded: boolean\) => void;/.test(chatInput), "absent means no button, stated in the props");
  assert.ok(/onExpandedChange=\{panel \? undefined : handleComposerExpanded\}/.test(chatWindow),
    "a docked side chat has no corner: its column is a panel beside the chat");
  assert.ok(/expanded=\{panel \? false : composerExpanded\}/.test(chatWindow), "and it never opens expanded");
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
  for (const path of ['d="M10 4H4v6"', 'd="M14 20h6v-6"', 'd="M4 10h6V4"', 'd="M20 14h-6v6"']) {
    assert.ok(icon.includes(path), `the glyph carries ${path}`);
  }
  // The expand mark runs 左上斜向右下 (top-left to bottom-right): the old outward pair sat
  // on the bottom-left/top-right diagonal, which read against the card's own left edge —
  // the column where the corner and the `+` stand. The collapse mark is NOT mirrored onto
  // that diagonal (the same ask reverted it: the inward fold is the shape the eye reads as
  // "back to the row", and mirroring it made the two states look like one glyph), so the
  // old outward paths stay out of the file while the inward pair comes back.
  for (const gone of ['d="M14 4h6v6"', 'd="M10 20H4v-6"']) {
    assert.ok(!icon.includes(gone), `the expanded state's outward pair no longer ships: ${gone}`);
  }
  assert.ok(icon.includes('aria-hidden="true"'), "the button's label carries the meaning, not the drawing");
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const messages = readFileSync(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
    for (const key of ['"chat.expandComposer"', '"chat.collapseComposer"']) {
      assert.ok(messages.includes(key), `${locale}: the corner's two states are named in ${locale}`);
    }
  }
});
