import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// The composer's corner: the way into the tall editor, and the same mark turned around is
// the way back. It is NOT part of the resting card — a short prompt is a one-row card with no
// affordance above it — so it arrives with the line past three (`COMPOSER_CORNER_MIN_LINES`,
// typed or wrapped, both measured) and leaves with it.
//
// The mark is a corner of the card, and the two rules that place it are pinned: it sits on
// Send's vertical line (the card's two right marks read as one column), and it keeps the same
// distance to the card's top edge as to its right edge. Only the FIRST line of text stops
// short of it, with `padding-right` on the field — never `padding-top` (a band of card the
// user clicks into and cannot type in) and never `padding-left` (a second, ragged left column).
//
// The card has two shapes, and they are pinned here too: one row (the `+`, the prompt, Send)
// while the prompt is one line, and the prompt on its own row above the `+` and Send once it
// wraps, so the typing happens in the block and the band between the two controls is the card,
// not the field. The line count is taken at the one-row width, so the layout cannot feed back
// on the measurement.
//
// What is pinned here: the pair of states, the measurement that decides when the corner exists,
// the room the mark takes out of the text, its placement, both shapes of the row, and the fact
// that the expanded card is the stacked shape the resting card grows into.

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
  assert.ok(/const COMPOSER_CORNER_MIN_LINES = 3;/.test(chatInput),
    "the corner's threshold is one exported number: more than three lines, the rule the user set, not a magic value in three places");
  assert.ok(/const cornerVisible = !compact && Boolean\(onExpandedChange\)\n\s*&& \(expanded \|\| textLines > COMPOSER_CORNER_MIN_LINES\);/.test(chatInput),
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
  assert.ok(/const properties = \[\s*"height", "min-height", "max-height",\s*"width", "flex", "margin", "order", "box-sizing",\s*\] as const;/.test(body),
    "all three height bounds AND the width pair are saved, by their CSS names: getPropertyValue and removeProperty speak CSS, and a camelCase name reads back empty — which leaves the released box behind and the expanded editor with no height of its own");
  assert.ok(/getPropertyPriority\(property\)/.test(body),
    "and each one's priority, because the box it returns to may be `!important`");
  for (const write of [
    'style.setProperty("height", "auto", "important")',
    'style.setProperty("min-height", "0px", "important")',
    'style.setProperty("max-height", "none", "important")',
  ]) {
    assert.ok(body.includes(write), `the release writes ${write}`);
  }
  // The width is pinned while the height is read, to the width the text has in the card's ONE
  // row. The stacked card gives the text the whole width, so a count taken at the live width
  // would drop to one line the moment the card stacked, un-stack it, wrap again, and loop.
  // Read at one fixed width, the answer describes the prompt, not the card showing it.
  assert.ok(/style\.setProperty\("width", "var\(--composer-text-row-width, 100%\)", "important"\)/.test(body),
    "the count is taken at `--composer-text-row-width`, the number app/native-theme.css owns (the card's width less the two discs and the row's gaps)");
  assert.ok(/style\.setProperty\("flex", "0 0 auto", "important"\)/.test(body)
    && /style\.setProperty\("margin", "0", "important"\)/.test(body)
    && /style\.setProperty\("box-sizing", "border-box", "important"\)/.test(body),
    "the pinned width is the USED width: `flex: 1 1 auto` would grow the item back to the row's free space, a margin would eat into it, and a content-box width would not include the padding");
  assert.ok(/style\.setProperty\("order", "0", "important"\)/.test(body),
    "and the stacked card's `order: -1` is neutralised while the box is released");
  const widthVar = /--composer-text-row-width: calc\(100% - \(2 \* var\(--composer-send-size\)\) - 12px\);/.exec(css);
  assert.ok(widthVar, "the card owns the number the count is taken at: the two discs and the row's two 6px gaps");
  const read = body.indexOf("textarea.scrollHeight");
  const restore = body.indexOf("for (const { property, value, priority } of saved)");
  assert.ok(read > 0 && restore > read,
    "the height is read between the release and the restore: nothing yields to the browser there, so no frame is painted released (a released box that paints is the flash the smooth growth was asked to replace)");
  assert.ok(/if \(value\) style\.setProperty\(property, value, priority\);\s*\n\s*else style\.removeProperty\(property\);/.test(body),
    "every property is put back, an empty one removed rather than written as \"\"");
  assert.ok(/const text = Math\.max\(0, content - paddingTop - paddingBottom\);\s*\n\s*return Math\.max\(1, Math\.round\(text \/ line\)\);/.test(body),
    "one line is one line-height, and the box's own vertical padding is subtracted exactly (the element's computed padding, not a guessed allowance): a padding rule must never raise the corner, because a one-line prompt counted as two kept the corner over a resting card and kept it there after the fold");
  for (const read of ["paddingTop", "paddingBottom", "lineHeight", "fontSize"]) {
    assert.ok(body.includes(`computed?.${read}`), `the count reads the box's own ${read}, so any font size and any padding shape is answered by the element`);
  }
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
  const fold = /const wasCornerRef = useRef\(false\);[\s\S]*?\}, \[textLines, expanded, onExpandedChange\]\);/.exec(chatInput);
  assert.ok(fold, "an effect keyed to the line count");
  const body = fold[0];
  assert.ok(/wasCornerRef\.current = true;/.test(body) && /textLines > COMPOSER_CORNER_MIN_LINES/.test(body),
    "the card remembers that the corner had arrived: the rule only closes a card the corner opened, on the same threshold that opened it");
  assert.ok(/if \(wasCornerRef\.current && expanded && onExpandedChange\) onExpandedChange\(false\);/.test(body),
    "and a prompt that falls back to the threshold folds the editor, so opening the editor on an empty box (to write a long prompt in) is kept");
  assert.ok(/wasCornerRef\.current = false;/.test(body), "and the memory is cleared, so one fold per gesture");
  assert.ok(!/textLines > 1\b/.test(chatInput),
    "no one-line threshold left behind: the corner's rule is one number, so a card of two or three lines stays a resting card");
});

test("the corner sits in the card's upper-RIGHT, on Send's line, and only the first line stops short of it", () => {
  const corner = cssRule(css, ".chat-composer > .chat-composer-expand");
  assert.ok(corner, "the corner is styled against the card, as its direct child");
  assert.match(corner, /position: absolute;/, "it is laid over the card's padding band, not added to the row");
  const inset = "calc(var(--composer-send-size) / 2 - 5px)";
  assert.ok(corner.includes(`top: ${inset};`),
    "the corner sits on Send's vertical line: the disc is `--composer-send-size` wide inside the card's 8px inset, so its centre is `8 + size/2`, and the 26px plate centres its 18px glyph there from `size/2 - 5px`");
  assert.ok(corner.includes(`right: ${inset};`), "and the same number is the RIGHT inset");
  const topInset = /top: ([^;]+);/.exec(corner)?.[1];
  const rightInset = /right: ([^;]+);/.exec(corner)?.[1];
  assert.equal(topInset, rightInset,
    "the **same distance to the card's top edge as to its right edge** — one inset read twice, so the mark reads as a corner of the card and not as a control pinned to the row");
  assert.doesNotMatch(corner, /left:/,
    "no left anchor: the card's left column is the `+`'s, and the ask put the corner in the upper-right, on Send's line");
  assert.match(corner, /width: 26px;[\s\S]*height: 26px;/, "a corner affordance, smaller than the row's discs");
  assert.match(corner, /border-radius: 9px;/, "a plate radius, not Send's disc");
  assert.match(corner, /background: transparent;/, "no plate at rest, so the card stays one surface");

  const coarse = cssRule(css, ".chat-composer > .chat-composer-expand", 1);
  assert.ok(coarse, "a finger's tier is its own block");
  const fingerInset = "calc(var(--composer-send-size) / 2 - 10px)";
  assert.match(coarse, /width: 36px;[\s\S]*height: 36px;/,
    "the glyph is 18px, so the plate it lives on is the touch target");
  assert.ok(coarse.includes(`top: ${fingerInset};`) && coarse.includes(`right: ${fingerInset};`),
    "the phone's disc is 44px inside the card's 8px inset, so the 36px plate centres on it from `size/2 - 10px` = 12px — written twice: 12px to the top edge, 12px to the right");
  assert.match(coarse, /border-radius: 12px;/, "a plate radius, not Send's disc");

  // The corner sits on the text's first line, so only that FIRST line stops short of it,
  // with `padding-right` on the field: the glyph is on the field's right, and `text-indent`
  // can only step text right, never off a right-side mark. What stays forbidden is what the
  // earlier shape did: a `padding-top` of 26px pushed the text under the glyph and left a band
  // of card that clicked into nothing — "I should be able to type in the red frame area" — and
  // a `padding-left` opened a second, ragged left column.
  const gutter = cssRule(css, ".chat-composer.has-expand .chat-composer-editor > .chat-input-textarea");
  assert.ok(gutter, "the card steps the first line clear of the corner only when it is drawn");
  assert.match(gutter, /padding-right: 34px;/, "the plate's left edge is ~35px in, the row's field ends 14px in: 34px of right padding stands the ink clear of the glyph");
  for (const dead of ["padding-top", "padding-left"]) {
    assert.ok(!gutter.includes(`${dead}:`), `no ${dead}: the box is the editor from its first pixel, so every line is typeable`);
  }
  const stackedGutter = cssRule(css, ".chat-composer.has-expand .chat-composer-editor[data-stacked] > .chat-input-textarea");
  assert.match(stackedGutter ?? "", /padding-right: 40px;/,
    "the stacked block carries no right margin (its field ends 8px in), so it needs 40px for the same clearance");
  const coarseGutter = cssRule(css, ".chat-composer.has-expand .chat-composer-editor > .chat-input-textarea", 1);
  assert.match(coarseGutter ?? "", /padding-right: 40px;/, "and the gutter follows the finger's plate (36px from 12px in: its edge is 48px)");
  const coarseStacked = cssRule(css, ".chat-composer.has-expand .chat-composer-editor[data-stacked] > .chat-input-textarea", 1);
  assert.match(coarseStacked ?? "", /padding-right: 46px;/, "and the finger's stacked block keeps the same clearance");
  assert.ok(!/\.chat-composer\.has-expand[^\n]*\{[^}]*padding-top/.test(css),
    "no band above the text anywhere on the expanded card: a band outside the box is not typeable, and it is what the ask called out");
});

test("the card has two shapes: one row for one line, the prompt above the controls past it", () => {
  // The ask, from the two screenshots: a one-line prompt is one row (`+`, the text, Send);
  // past one line the text is the card's block and the typing happens there, and the band
  // between the `+` and Send is the card, not the field — a click there reaches nothing. The
  // tall editor is the same stacked shape, taken further, so the expanded card is NOT a third
  // geometry.
  assert.match(chatInput, /const stacked = !compact && \(expanded \|\| textLines > 1\);/,
    "the stacked shape is the card's own state: the prompt's second line, or the open editor; the quote box keeps its column");
  assert.match(chatInput, /data-stacked=\{stacked \? "true" : undefined\}/,
    "the card marks the shape and the stylesheet lays it out");
  assert.match(chatInput, /useLayoutEffect\(resizeTextarea, \[value, fontSize, stacked, resizeTextarea\]\);/,
    "the autosize runs again when the shape changes: the text's width changes with it, so the height it grew is stale");
  const row = cssRule(css, ".chat-composer-editor[data-inline]");
  assert.ok(row, "the row is styled in the stylesheet");
  for (const declaration of ["display: flex;", "flex-direction: row;", "gap: 0;", "align-items: flex-end;"]) {
    assert.ok(row.includes(declaration), `the one-row card keeps ${declaration}`);
  }
  const stacked = cssRule(css, ".chat-composer-editor[data-stacked]");
  assert.ok(stacked, "the stacked card is a rule of its own");
  assert.match(stacked, /flex-wrap: wrap;/, "one wrapping row is both shapes: the text's basis is the whole width, so the row breaks after it");
  assert.match(stacked, /column-gap: 6px;/, "the controls' row keeps the row's 6px gaps");
  const stackedText = cssRule(css, ".chat-composer-editor[data-stacked] > .chat-input-textarea");
  assert.ok(stackedText, "the text's stacked box is a rule of its own");
  assert.match(stackedText, /order: -1;/, "the text leads the wrapped row while the DOM keeps the row's order: the `+`, the prompt, Send");
  assert.match(stackedText, /flex: 0 0 100%;/, "the text takes the card's whole width on its own row (the ask: type in the block)");
  assert.match(stackedText, /margin: 0 0 6px;/, "no horizontal margin in the stacked shape — a full basis plus a margin is what pushed the text past the card's edge; the 6px below is the room above the controls");
  assert.match(stackedText, /padding: 8px 13px 0 calc\(var\(--composer-send-size\) \/ 2 - 8px\);/,
    "the block is inset by PADDING, not margins (a margin on a whole-width basis crosses the card's right edge): 8px of air over the first line, the caret 13px off the edge, and the left inset stands the prompt's first character on the `+` glyph's edge — half the disc less 8px");
  // The inline style must not fight either shape: an inline `flex` beats the stylesheet, so a
  // `1 1 auto` basis kept the text on the controls' line and the card never stacked.
  const textareaStyle = /className="chat-input-textarea"[\s\S]*?overflow: "auto",/.exec(chatInput);
  assert.ok(textareaStyle, "the text area's box is one style object");
  assert.doesNotMatch(textareaStyle[0], /\bflex:/, "no inline flex: the stylesheet owns both shapes, and an inline `flex` beats them");
  assert.match(textareaStyle[0], /minHeight: compact \? 96 : 24,/, "the height the autosize grew, and the card's cap, stay inline");
  const editorCard = /className="chat-composer-editor"[\s\S]*?transition: "border-color/.exec(chatInput);
  assert.ok(editorCard, "the editor's box is one style object");
  assert.doesNotMatch(editorCard[0], /display:|flexDirection:|alignItems:/,
    "the row and its two shapes are not written in the JSX: a second copy of the layout in the component is what drifts");
  const column = cssRule(css, ".chat-composer-editor");
  assert.ok(column, "the editor's base shape is a rule");
  for (const declaration of ["display: flex;", "flex-direction: column;", "align-items: stretch;", "gap: 8px;"]) {
    assert.ok(column.includes(declaration), `the quote box's column keeps ${declaration}`);
  }
  // Send keeps the card's bottom-right arc in both shapes, so the card's radius arithmetic
  // (Send's centre at the arc's centre) survives the wrap.
  const send = cssRule(css, ".chat-composer-actions > .composer-send-button");
  assert.ok(send && send.includes("margin-left: auto"),
    "Send is pushed to the right end of the controls' row, in the card's bottom-right arc");
  // The shape change is a band of card appearing under the text, and the card's height is its
  // content's height: pinned and flushed, the same px -> px pair the text's own height
  // animates, is what keeps "one line to two lines" from reading as a jump (the ask: 生硬).
  const cardHeight = cssRule(css, "\.chat-composer");
  assert.match(cardHeight, /box-shadow var\(--dur-base\) var\(--ease-native\),\s*\n\s*height var\(--dur-fold\) var\(--ease-fold\),/,
    "the card animates its height on the fold's own duration and easing: a whole band of card appearing in --dur-base is what read as a jump");
  assert.ok(/const cardHeightRef = useRef\(0\);/.test(chatInput), "the card's height is kept in a ref");
  const heightKeeper = /const cardHeightRef = useRef\(0\);[\s\S]*?\}, \[\]\);/.exec(chatInput);
  assert.ok(heightKeeper && /new ResizeObserver/.test(heightKeeper[0]) && /observer\.observe\(card\)/.test(heightKeeper[0]),
    "and a ResizeObserver on the card refreshes it on every box change, mid-animation frames included");
  const shape = /useLayoutEffect\(\(\) => \{[\s\S]*?\}, \[stacked, expanded\]\);/.exec(chatInput);
  assert.ok(shape, "an effect keyed to the card's shape AND the corner's open: the tall editor is the same move, taken further");
  const shapeBody = shape[0];
  assert.ok(/const from = cardHeightRef\.current \|\| card\.offsetHeight;/.test(shapeBody),
    "the height the card STOOD AT is read from the ref, not from `offsetHeight`: a layout effect runs after the DOM carries the new shape, so `offsetHeight` in it is the target, and pinning that to itself (`from === to`) silently kills the animation — which is why one line to two landed as a jump");
  assert.ok(/cardHeightRef\.current = to;/.test(shapeBody),
    "and the animation's end is written back, so a quick reverse starts where the box finished");
  assert.ok(/growComposerTextarea\(ta, \{ animate: false \}\);/.test(shapeBody),
    "the text is put at its final height first, so the card's target is measured over the height the text is about to keep (the textarea's own transition animates a px -> px write)");
  assert.ok(/card\.style\.height = "auto";\s*\n\s*const to = card\.offsetHeight;/.test(shapeBody),
    "the target is the content's height, read with the box open");
  assert.ok(/card\.style\.height = `\$\{from\}px`;\s*\n\s*void card\.offsetHeight;\s*\n\s*if \(prefersReducedMotion\(\) \|\| from === to\)/.test(shapeBody),
    "pinned, flushed, and a reduced-motion reader (or a change with no height in it) gets the box back and the jump");
  assert.ok(/card\.style\.overflow = "hidden";/.test(shapeBody) && /card\.style\.overflow = "";/.test(shapeBody),
    "the taller content stays inside the card's own surface while the box grows, and the box goes back to `overflow: visible` (the `+`'s menu escapes the card)");
  // The measured target must BE the resting height. A child mid-transition is read at the value
  // it is leaving, and the stacked shape moves the text's bottom margin by 6px: the card animated
  // 45 -> 96px, landed at 101.8px, and the 6px arrived as a jump 240ms after the fold (measured
  // in a real browser). So the target is read with the card's transitions off.
  assert.ok(/card\.classList\.add\("is-measuring"\);\s*\n\s*card\.style\.height = "auto";\s*\n\s*const to = card\.offsetHeight;\s*\n\s*card\.classList\.remove\("is-measuring"\);/.test(shapeBody),
    "the target is measured with every box in the card already at its final value");
  assert.ok(/\.chat-composer\.is-measuring,[\s\S]{0,80}\.chat-composer\.is-measuring \*\s*\{[^}]*transition: none !important;/.test(css),
    "the measure frame is a rule in the sheet, not a style written in the component");
  // And while the box is smaller than its content, the content is pinned to the card's BOTTOM
  // edge: the discs keep the card's bottom inset at every frame, instead of sitting 48px below
  // the card's edge (clipped) and sliding up for the whole fold — the padding that read as
  // wrong, then fixed itself.
  assert.ok(/card\.dataset\.folding = "true";/.test(shapeBody), "the fold is a state of the card, for its duration");
  assert.ok(/delete card\.dataset\.folding;/.test(shapeBody),
    "and it is cleared on the transition's end and on an unmount mid-fold");
  assert.match(css, /\.chat-composer\[data-folding\] \{[^}]*justify-content: flex-end;/,
    "the content is pinned to the bottom edge while the box grows");
  assert.match(css, /\.chat-composer\[data-folding\] > \.chat-composer-editor \{[^}]*flex: 0 0 auto;/,
    "the editor keeps its natural height, so the card clips rather than squashing the field");
  assert.match(css, /\.chat-composer-editor\[data-inline\] > \.chat-input-textarea \{[\s\S]*?transition:\s*\n\s*height var\(--dur-base\) var\(--ease-native\),\s*\n\s*padding-right var\(--dur-fold\) var\(--ease-native\);/,
    "the text's margins are NOT transitioned: the card's measured fold is the animation, and a margin mid-flight is what made the measurement lie");
  assert.ok(/event\.target !== card \|\| event\.propertyName !== "height"/.test(shapeBody),
    "the box is handed back on the card's own height transition, not on a child's");
  assert.ok(/return \(\) => \{[\s\S]*?card\.style\.height = "";/.test(shapeBody),
    "and unmounted mid-transition, no inline height is left behind");
  const tall = cssRule(css, ".chat-composer.is-expanded .chat-composer-editor > .chat-input-textarea");
  assert.ok(tall, "the editor's height is a rule, not the composer's inline box");
  assert.match(tall, /height: auto !important;/, "it out-inlines the box the composer grew to the text");
  assert.match(tall, /min-height: min\(42dvh, 300px\) !important;/, "the bounds are the card's, not the text's");
  assert.match(tall, /max-height: min\(58dvh, 520px\) !important;/, "so a longer prompt scrolls inside the editor instead of pushing the card past the screen");
  const keyboard = cssRule(css, "html[data-keyboard-open] .chat-composer.is-expanded .chat-composer-editor > .chat-input-textarea");
  assert.match(keyboard, /min-height: clamp\(224px, calc\(var\(--app-viewport-height, 100dvh\) \* 0\.52\), calc\(var\(--app-viewport-height, 100dvh\) \* 0\.72\)\) !important;/,
    "with the keyboard up the editor is measured against the keyboard's own height, and floored above the collapsed box's 200px: the keyboard may not size the open editor back under the box it grew out of (the phone's report: it 'changes back' when the keyboard pops out)");
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
  for (const path of ['d="M14 4h6v6"', 'd="M10 20H4v-6"', 'd="M20 10h-6V4"', 'd="M4 14h6v6"']) {
    assert.ok(icon.includes(path), `the glyph carries ${path}`);
  }
  // The expand mark runs 左下斜向右上 (bottom-left to top-right): the mark lives in the card's
  // upper-RIGHT corner, and a corner glyph reads along the diagonal that starts at the corner
  // it sits in — the old top-left/bottom-right pair read against the card's own left edge. The
  // collapse mark is the same inward fold mirrored onto that diagonal, so the two states stay
  // one shape turning around its centre, and the old pair stays out of the file.
  for (const gone of ['d="M10 4H4v6"', 'd="M14 20h6v-6"', 'd="M4 10h6V4"', 'd="M20 14h-6v6"']) {
    assert.ok(!icon.includes(gone), `the top-left/bottom-right pair no longer ships: ${gone}`);
  }
  assert.ok(icon.includes('aria-hidden="true"'), "the button's label carries the meaning, not the drawing");
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const messages = readFileSync(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
    for (const key of ['"chat.expandComposer"', '"chat.collapseComposer"']) {
      assert.ok(messages.includes(key), `${locale}: the corner's two states are named in ${locale}`);
    }
  }
});

test("the long prompt gets no second mark in the card's corner: the side chat stays a row of the `+` menu", () => {
  // The corner is one mark, the editor's. A running session's side chat used to wear the same
  // corner (the card's upper-right, on Send's line), and two marks on one line read as a
  // toolbar: the ask took it back. The action stays where the row's other controls live — a
  // row of the `+`'s menu — and the card keeps one corner glyph.
  assert.ok(!/chat-composer-side-chat-corner/.test(chatInput),
    "the card draws no side-chat corner");
  assert.ok(!/chat-composer-side-chat-corner/.test(css),
    "and no stylesheet carries it: a rule for a mark that is not drawn is how a merge brings it back");
  assert.match(chatInput, /sideChat=\{isStreaming && onSideChat \? \{/, "the side chat is the `+` menu's row while the run streams");
  const menu = readFileSync(new URL("./ComposerPlusMenu.tsx", import.meta.url), "utf8");
  assert.match(menu, /sideChat/, "and the hub renders that row");
});
