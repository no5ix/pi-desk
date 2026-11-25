import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
// The composer's session row (project, model, controls) must fit the width it is
// given on a phone and in a squeezed desktop window (the open workspace panel). It
// used to be a three-column grid whose first column was `auto`: a phone renders only
// two children there, so the controls block landed in the 1fr track while the model
// chip's untruncated max-content widened the first column. The "More controls" button
// (16px in a zero-width track) then painted on top of the context-usage ring, and on a
// desktop the model chip's fixed 220px box overflowed its own shrunken root onto the
// ring. The ring has since left this row for the conversation header
// (components/TopbarContextChip.tsx); the width rules that fixed it stay.
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const modelSource = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");

const rowStart = chatInput.indexOf('className="chat-composer-controls"');
const row = chatInput.slice(rowStart, chatInput.indexOf("\n", rowStart) + 1200);
const leftCell = chatInput.match(/<div style=\{\{ flex: isNarrow \?[^]*?(?=\s*\{\/\* spacer \*\/\})/);
const moreButton = chatInput.match(/\{isNarrow && \(\s*<button[\s\S]*?<\/button>\s*\)\}/);

test("the narrow composer row gives the controls block its own track", () => {
  assert.ok(rowStart > 0, "the composer controls row renders");
  assert.match(row, /display: isNarrow \? "grid" : "flex"/);
  assert.match(row, /gridTemplateColumns: isNarrow \? "minmax\(0, 1fr\) auto" : undefined/,
    "the left cell takes the free width and shrinks; the controls keep an auto track");
  assert.ok(!/gridTemplateColumns:[^\n]*auto minmax/.test(row),
    "an `auto` first track sizes to the model chip's max-content and pushes the trailing cell out of the row");
});

test("the left cell can shrink, and no context control is left in the row", () => {
  assert.ok(leftCell, "the left cell is one styled div");
  assert.match(leftCell[0], /flex: isNarrow \? "1 1 auto" : "0 1 auto"/, "it shrinks in both tiers, so the chips truncate instead of pushing the controls out");
  assert.match(leftCell[0], /minWidth: 0/, "min-width:auto would stop it at the model name's content size");
  // The context moved to the header, so nothing may grow back into the strip the
  // phone's More button has to share.
  assert.doesNotMatch(chatInput, /ContextUsageRing/, "the composer renders no context ring");
  assert.doesNotMatch(chatInput, /contextUsage|sessionStats/, "and it is not given the numbers any more");
});

test("the More controls button keeps its 32px box", () => {
  assert.ok(moreButton, "the phone renders the More controls button");
  assert.match(moreButton[0], /width: "var\(--control-h-lg\)"/);
  assert.match(moreButton[0], /flexShrink: 0/, "a squeezed track must shrink the track, not the button");
});

test("the model chip never outgrows the cell that holds it", () => {
  // `220` alone is a cap, not a shrink: in a narrow row the trigger kept its
  // 220px box past the shrunken root and painted over the context ring.
  assert.match(modelSource, /maxWidth: isMobile \? "100%" : "min\(220px, 100%\)"/);
  assert.match(modelSource, /style=\{\{ position: "relative",[^\n]*minWidth: 0/, "the root can shrink in the row");
  assert.match(modelSource, /<span style=\{\{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" \}\}>\{currentName\}<\/span>/,
    "the label is the part that gives way");
});

test("the row itself cannot widen the page", () => {
  // `\n` anchors the real rule: `.chat-composer-actions > .chat-composer-controls`
  // contains the same name and is found first.
  const start = css.indexOf("\n.chat-composer-controls {");
  assert.ok(start >= 0, "the controls row keeps its own rule");
  const rule = css.slice(start, css.indexOf("}", start));
  for (const declaration of ["min-width: 0;", "max-width: 100%;"]) {
    assert.ok(rule.includes(declaration), `the composer row keeps ${declaration}`);
  }
  assert.match(css, /html\[data-keyboard-open\] \.chat-composer-controls/, "the phone hides the row's controls while the keyboard is up");
});

test("the card keeps one control row: attach, the session controls, then Send", () => {
  // The user asked for the text area to own the card's width and for every control
  // that used to sit under the composer to share the Send row, icon-only.
  const attachAt = chatInput.indexOf('className="native-toolbar-button composer-attach-button"');
  const rowAt = chatInput.indexOf('className="chat-composer-actions"');
  const controlsAt = chatInput.indexOf('className="chat-composer-controls"');
  // The send button's className is conditional (the compact composer has no
  // composer-send-button), so match the class list, not the attribute.
  const sendAt = chatInput.indexOf('"native-primary-button composer-send-button"');
  const textareaAt = chatInput.indexOf('className="chat-input-textarea"');
  assert.ok(rowAt > 0 && attachAt > rowAt, "the attach button is in the control row");
  assert.ok(controlsAt > attachAt, "the session controls follow the attach button");
  assert.ok(sendAt > controlsAt, "Send is the row's last control, in the card's corner");
  assert.ok(textareaAt < rowAt, "the text area is above the row, not beside a control");
  assert.match(chatInput, /flexDirection: "column",\n              gap: compact \? 8 : 0,\n              alignItems: "stretch"/,
    "the editor is a column: the text, then the row");
  // Icon-only controls: the words (the level, the preset) live in title/aria-label.
  const reasoning = chatInput.slice(chatInput.indexOf('aria-expanded={thinkingDropdownOpen}'), chatInput.indexOf("chat.thinkingHeading"));
  assert.match(reasoning, /padding: 0,\n                    width: "var\(--control-h-lg\)"/, "the reasoning button is a square icon button");
  assert.doesNotMatch(reasoning, /\{runSettingsLabel\}/, "the reasoning level is not printed");
  const tools = chatInput.slice(chatInput.indexOf('aria-expanded={toolDropdownOpen}'), chatInput.indexOf("chat.toolsHeading"));
  assert.doesNotMatch(tools, /\{toolPresetLabel\}<\/span>/, "the tool preset is not printed");
  assert.match(chatInput, /title=\{t\("chat\.changeToolPreset"\) \+ `: \$\{toolPresetLabel\}`\}/, "the preset is named in the title");
  // The model chip follows the same rule, with the model's name in its title.
  assert.match(chatInput, /iconOnly/, "the composer's model chip is icon-only");
  assert.match(modelSource, /const triggerTitle = iconOnly \? `\$\{currentName\} — \$\{buttonTitle\}` : buttonTitle/,
    "the model's name rides in the title and aria-label");
  assert.match(modelSource, /\{!iconOnly && <span/, "the name is only printed when the label is asked for");
});

/** One top-level CSS block, by selector. */
function cssRule(source, selector) {
  const at = source.indexOf(`\n${selector} {`);
  if (at === -1) return null;
  const end = source.indexOf("\n}", at);
  return source.slice(at, end);
}

test("the card has no clear button, and its row is quiet", async () => {
  // A textarea is selected and deleted; a trash icon in the row asked for a click to
  // do that, and the row is where the controls with no keyboard equivalent live.
  assert.doesNotMatch(chatInput, /className="composer-clear-button"/, "the clear button is gone from the composer");
  assert.doesNotMatch(chatInput, /composer-clear-button/,
    "and no leftover class in the row: the side-chat button borrowed the clear button's class, which kept the removed control's rules (and its 44px touch box) alive on a phone");
  assert.doesNotMatch(css, /\.composer-clear-button/, "and no rule survives for the removed control");
  assert.match(chatInput, /className="composer-side-chat-button"/);
  const side = cssRule(css, ".composer-side-chat-button");
  assert.ok(side, "the side-chat button owns its own box");
  assert.ok(side.includes("width: var(--control-h-lg)") && side.includes("height: var(--control-h-lg)"),
    "the row's icon control is one 32px square, like reasoning and the tool preset");
  assert.match(cssRule(css, "@media (pointer: coarse) { .composer-side-chat-button") ?? css, /@media \(pointer: coarse\) \{ \.composer-side-chat-button \{ width: 44px; height: 44px; \} \}/,
    "and a finger's 44px target on a phone");
  assert.doesNotMatch(chatInput, /onClearDraft/, "and the composer is not handed a draft-clearing callback any more");
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(chatWindow, /onClearDraft/, "the shell stops forwarding one");
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const messages = await readFile(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
    assert.doesNotMatch(messages, /"chat\.clearDraft"/, `${locale}: the key left with the button`);
  }
  // Attaching gets no plate: it is a quiet glyph in a row of quiet glyphs, and the
  // disc made it read as a toggle that was switched on.
  const active = cssRule(css, ".composer-attach-button[data-active]");
  assert.ok(active, "the attached state is styled");
  assert.match(active, /color: var\(--text\);/, "it says so in the glyph's colour");
  assert.doesNotMatch(active, /background/, "and grows no background of its own");
  assert.match(cssRule(css, ".composer-attach-button") ?? "", /background: none;/, "at rest the button is bare");
  // The phone's keyboard hides the controls strip, and the strip is the row's flex
  // filler: with it gone every control packed to the left, Send included (WebKit, 390px:
  // Send at x=130 of a card ending at 366). `auto` keeps Send in the card's corner.
  const sendRule = cssRule(css, ".chat-composer-actions > .composer-send-button");
  assert.ok(sendRule && sendRule.includes("margin-left: auto"),
    "Send stays at the card's bottom-right corner with the strip hidden or shown");
  // What replaced the button: every attachment names its own remove control, images
  // included (the image's × used to be an unlabelled glyph, readable only because the
  // clear button stood next to it).
  assert.match(chatInput, /onClick=\{\(\) => removeImage\(i\)\}\n\s*aria-label=\{t\("chat\.removeImage"\)\}/,
    "the image's × says what it removes");
  const plugins = await readFile(new URL("../lib/i18n/locale-plugins.ts", import.meta.url), "utf8");
  const key = /"chat\.removeImage": "(Remove image|移除图片|移除圖片)",/g;
  assert.equal(plugins.match(key)?.length, 3, "the key carries all three locales");
});

test("the / @ # hint rides the placeholder's row", () => {
  // It used to be a flex child under the text: the card grew a second line for a
  // sentence that only reads once, and the hint sat out of the eye's line.
  const hint = cssRule(css, ".composer-trigger-hint");
  assert.ok(hint, "the hint is styled");
  assert.match(hint, /position: absolute;/, "it is laid over the text's first line, not added under it");
  assert.match(hint, /top: calc\(8px \+ \(var\(--composer-line-height\) - 1\.4em\) \/ 2\);/,
    "centered on the first line, off the textarea's top margin, tracking the chat font size");
  assert.match(hint, /right: 0;/, "flush with the text's right edge");
  assert.match(hint, /pointer-events: none;/, "it never takes a click meant for the text");
  assert.doesNotMatch(hint, /flex: 0 0 auto|align-self: center/, "it is no longer a row of its own");
  assert.match(cssRule(css, ".chat-composer-editor") ?? "", /position: relative;/,
    "the card is the box the hint is placed in");
  // The gates stay: an empty, idle, wide card only.
  const hintJsx = chatInput.slice(chatInput.indexOf('className="composer-trigger-hint"') - 220, chatInput.indexOf('className="composer-trigger-hint"'));
  assert.match(hintJsx, /!compact && !isNarrow && !isStreaming && value\.length === 0/,
    "the hint shows on a wide, idle, empty card");
  assert.ok(chatInput.indexOf('className="chat-input-textarea"') < chatInput.indexOf('className="composer-trigger-hint"'),
    "the hint is in the card, after the text");
});

test("the full-width text area stays inside the card", () => {
  // `width: 100%` plus a horizontal margin pushed the text 8px past the card's right
  // edge, on the phone as much as on a desktop. The width is bought from the column's
  // stretch, so a margin can only inset — that pairing is the invariant, and it is what
  // lets the margins carry the card's insets: 8px on the left stands the text's ink on the
  // `+` glyph's left edge, 18px below is the room above the control row. This survived one
  // hand-edit of the margin in the stylesheet, which is how the overflow came back once.
  const rule = cssRule(css, ".chat-composer-editor > .chat-input-textarea");
  assert.ok(rule, "the textarea has a rule of its own");
  assert.match(rule, /width: auto;/, "the width comes from the column's stretch");
  assert.match(rule, /margin: 8px 0 18px calc\(var\(--composer-send-size\) \/ 2 - 10px\);/, "top, the room above the row, and the inset that meets the `+` glyph");
  assert.match(rule, /padding-right: 13px;/, "the caret stays off the card's edge");
  assert.doesNotMatch(rule, /margin: 8px;/, "never one inset on all four sides");
  assert.doesNotMatch(rule, /width: 100%;/, "and no full width to pair with a horizontal margin");
  assert.match(chatInput, /alignItems: "stretch"/, "the column stretches its children, which is where the width comes from");
});
test("the row's ink lines up with the text, not only its boxes", () => {
  // The `+` and Send are discs with no disc painted (`background: none`), so the only ink
  // in them is the glyph, and the hint's 23px padding used to leave its sentence 13px short
  // of Send's arrow: the card read as two left columns and a ragged right edge. The boxes
  // always lined up; the ink is what the eye compares, so the ink is what is pinned. The
  // `+` stays centered in its touch-sized disc — a finger aims at the disc, and Send's
  // arrow is centered in its own — and the text moves to it, at a left margin of half the
  // disc less 10px (8px on the desktop's 36px tier, 12px on the phone's 44px). The e2e
  // `composer-geometry.mjs` measures these ink edges in the browser at every tier.
  const attach = cssRule(css, ".composer-attach-button");
  assert.ok(attach, "the attach button has a rule of its own");
  assert.match(attach, /justify-content: center;/, "the `+` glyph stays centered in its disc");
  assert.match(attach, /width: var\(--composer-send-size\);/, "and the hit area keeps the disc's touch size");
  const text = cssRule(css, ".chat-composer-editor > .chat-input-textarea");
  assert.match(text, /margin: 8px 0 18px calc\(var\(--composer-send-size\) \/ 2 - 10px\);/,
    "the text's ink is inset to the glyph's left edge, off the disc's own size");
  const hint = cssRule(css, ".composer-trigger-hint");
  assert.ok(hint, "the hint has a rule of its own");
  assert.match(hint, /padding-right: 10px;/, "the hint's ink ends on Send's arrow, not 13px inside it");
  assert.match(hint, /right: 0;/, "the box stays at the text's right edge: the ink is moved, not the box");
});
