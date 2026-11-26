import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
// The composer's session row (the `+`, the prompt, the session controls, Send) must fit the
// width it is given on a phone and in a squeezed desktop window (the open workspace panel). It
// used to be a three-column grid whose first column was `auto`: a phone renders only
// two children there, so the controls block landed in the 1fr track while the model
// chip's untruncated max-content widened the first column. The "More controls" button
// (16px in a zero-width track) then painted on top of the context-usage ring, and on a
// desktop the model chip's fixed 220px box overflowed its own shrunken root onto the
// ring. The ring has since left this row for the conversation header
// (components/TopbarContextChip.tsx); the width rules that fixed it stay.
// 2026-11-25 (a phone ask): the strip leads the row, and the model chip collapsed into the
// group the phone opens behind a control.
// 2026-11-26 (the same person, looking at a phone screenshot): that row is not needed at
// all. An empty phone composer is ONE row — `+`, the prompt, Send — and every session
// control lives behind the `+`, in one menu; the project and branch chips move to a strip
// under the card; and the card grows smoothly as the prompt wraps.
// 2026-11-27 (the same person, looking at the desktop): the phone was right. The card is
// that one row on EVERY tier — the old wide-tier column (text on top, a control row under
// it) is gone, `+` is the row's leftmost control, the prompt is its filler, and the whole
// row is 80% of its old size. Only the quote dialog keeps a column. So `data-inline` is on
// every non-compact card, the phone's chips strip sits outside the card, and the row's
// geometry below — order, filler, sizes, ink edges — is one geometry, not two.
// 2026-11-28 (the same person, with two screenshots): one row is the ONE-LINE card. Past a
// line the prompt is the card's block ("I should be able to type in the red frame area") and
// the band between the `+` and Send is not the field ("I shouldn't be able to type in the
// space between the `+` button and Send button"). So the same flex row gets `data-stacked`
// with the prompt's second line: the text first at the full width, the `+` and Send in the
// row under it, Send still in the arc. The row's geometry below is unchanged; the stacked
// shape is pinned in components/ChatInput.composer-expand.test.mjs.
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const modelSource = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");
const plusSource = await readFile(new URL("./ComposerPlusMenu.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const plugins = await readFile(new URL("../lib/i18n/locale-plugins.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");

/** One CSS block, by selector. The fork indents whole sections, so the selector only has
    to open its own line; the block runs to the `}` that closes its line. */
function cssRule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const at = new RegExp(`\\n\\s*${escaped}\\s*\\{`).exec(source);
  if (!at) return null;
  return source.slice(at.index, source.indexOf("\n}", at.index));
}

const rowStart = chatInput.indexOf('className="chat-composer-controls"');
const leftCell = chatInput.match(/<div style=\{\{ flex: "0 1 auto"[\s\S]*?(?=\{\/\* THE CLUSTER:)/);
const controlsStyle = chatInput.match(/className="chat-composer-controls" style=\{\{([\s\S]*?)\}\}/);
const editorCard = chatInput.match(/className="chat-composer-editor"[\s\S]*?transition: "border-color/);
const textareaStyle = chatInput.match(/className="chat-input-textarea"[\s\S]*?minHeight: compact \? 96 : 24,/);

test("the card is ONE row while the prompt is one line, and only the quote box is a column", () => {
  assert.ok(rowStart > 0, "the composer controls cell renders");
  // The phone is not the inline tier any more: every card that is not the quote dialog
  // carries the marker. A per-tier marker is what made the two layouts drift apart — the
  // desktop kept its column, the phone grew a row, and every geometry fix had to be done
  // twice and was done once.
  assert.match(chatInput, /data-inline=\{compact \? undefined : "true"\}/,
    "every tier's card is marked for the row layout, and only the quote dialog is not");
  assert.ok(editorCard, "the editor's box is one style object");
  assert.doesNotMatch(editorCard[0], /display:|flexDirection:|alignItems:/,
    "the row's shape is the stylesheet's, not the JSX's: an inline `display: flex` beats the sheet, and a stacked card written in CSS then loses to it");
  assert.doesNotMatch(editorCard[0], /flexDirection: isNarrow|alignItems: isNarrow/,
    "no tier picks its own direction: the tier fork is what the row replaced");
  assert.ok(textareaStyle, "the text area's box is one style object");
  assert.doesNotMatch(textareaStyle[0], /\bflex:/,
    "no inline flex on the prompt: it buys its width from the row (`1 1 auto`) or takes the whole line (`0 0 100%`), and an inline value would beat both rules");
  assert.match(textareaStyle[0], /minWidth: 0/, "and it can shrink, which is what a long word must not survive");
  // The row is the card's own layout, not a JSX fork of the card: ChatInput marks the
  // editor and the stylesheet folds the action row's children into the card's flex row.
  // One JSX tree is what keeps Send in the corner in every tier.
  const inline = cssRule(css, ".chat-composer-editor[data-inline]");
  assert.ok(inline, "the row layout lives in the stylesheet");
  assert.match(inline, /display: flex;[\s\S]*flex-direction: row;/, "the card's row is declared, not inherited from a JSX style");
  assert.match(inline, /align-items: flex-end;/, "the one-row card's controls sit at the bottom edge of the growing text");
  assert.match(inline, /gap: 0;/, "the row's spacing is the text's own margins, not a gap that widens with the cards");
  const folded = cssRule(css, ".chat-composer-editor[data-inline] > .chat-composer-actions");
  assert.ok(folded, "the action row is folded into the card's row");
  assert.match(folded, /display: contents;/, "its children become the row's, on one line with the prompt");
  const text = cssRule(css, ".chat-composer-editor[data-inline] > .chat-input-textarea");
  assert.match(text, /flex: 1 1 auto;/, "the text takes the width the `+` and Send leave");
  assert.match(text, /margin: 0 6px;/, "the row's own gaps, not the column's insets");
  assert.match(text, /transition: height var\(--dur-base\) var\(--ease-native\);/,
    "the card grows as the prompt wraps and folds back with it, px -> px (a transition from `auto` is dismissed by the spec, which is why lib/composer-textarea-height.ts measures without painting)");
  assert.doesNotMatch(text, /width: 100%;/, "and buys it from the row, never from a full width + margin");
  // Nothing in the row may be taller than the two discs that set its height: the strip's
  // 32px floor, a 32px project chip, a 32px side-chat button — each alone makes the resting
  // card taller than the one-row card the ask is about.
  assert.match(cssRule(css, ".chat-composer-editor[data-inline] .chat-composer-controls") ?? "", /min-height: 0;/,
    "the controls cell grows no floor under the row");
  assert.match(cssRule(css, ".chat-composer-editor[data-inline] .chat-project-context") ?? "", /height: 26px;/,
    "nor does a project chip");
  const actions = cssRule(css, ".chat-composer-actions");
  assert.match(actions, /display: flex;/, "the folded box is a flex row of controls");
  assert.match(actions, /min-width: 0;/, "and it shrinks, which is what keeps a squeezed window honest");
});

test("the row's order: the `+`, the prompt, the session controls, Send", () => {
  // The user asked for the text to own the card's width and for every control to share its
  // row, icon-only; the `+` leads that row because the prompt starts where reading starts.
  const editorAt = chatInput.indexOf('className="chat-composer-editor"');
  const plusAt = chatInput.indexOf("<ComposerPlusMenu");
  const attachAt = chatInput.indexOf('className="native-toolbar-button composer-attach-button"');
  const textareaAt = chatInput.indexOf('className="chat-input-textarea"');
  const rowAt = chatInput.indexOf('className="chat-composer-actions"');
  const controlsAt = chatInput.indexOf('className="chat-composer-controls"');
  const sideAt = chatInput.indexOf('className="composer-side-chat-button"');
  // The send button's className is conditional (the compact composer has no
  // composer-send-button), so match the class list, not the attribute.
  const sendAt = chatInput.indexOf('"native-primary-button composer-send-button"');
  for (const [at, what] of [[editorAt, "the editor box"], [plusAt, "the phone's `+`"],
    [attachAt, "the attach button"], [textareaAt, "the text area"], [rowAt, "the action row"],
    [controlsAt, "the session controls"], [sideAt, "the side-chat button"], [sendAt, "Send"]]) {
    assert.ok(at > 0, `${what} renders`);
  }
  assert.ok(plusAt > editorAt && attachAt > editorAt, "both `+` are children of the editor box, not of the action row");
  assert.ok(attachAt < textareaAt && plusAt < textareaAt,
    "the `+` is the row's FIRST control: a prompt that wraps keeps its `+` under the text it belongs to");
  assert.ok(textareaAt < rowAt, "the controls follow the text, so the row reads left to right");
  assert.ok(rowAt < controlsAt && controlsAt < sideAt && sideAt < sendAt,
    "the session controls, the side chat, then Send");
  const beforeText = chatInput.slice(editorAt, textareaAt);
  assert.doesNotMatch(beforeText, /chat-composer-actions/,
    "no action box in front of the text: `display: contents` folds it after the prompt, and a box in front slid Send to the prompt's left");
  assert.match(chatInput, /\{!compact && \(isNarrow \? \(\s*<ComposerPlusMenu/,
    "the phone opens a menu, the wider tier picks a file, and the compact quote box gets neither");
  assert.match(chatInput, /\{!compact && !isNarrow && <div className="chat-composer-controls"/,
    "a phone renders no controls cell: its row is the `+`, the prompt and Send, and its controls are in the `+` menu");
});

test("the phone's `+` is Send's twin at the row's other end", () => {
  // One disc at each end of the prompt, so the text reads as the composer's subject. The
  // phone's `+` borrows Send's disc by rule, and its box is a flex item, not a positioned
  // box: the row's controls sit on the text's bottom edge.
  assert.match(plusSource, /className="composer-plus-anchor"/,
    "the phone's `+` is wrapped in an anchor of its own (the menu is placed against it)");
  assert.match(plusSource, /className="native-toolbar-button composer-plus-button"/,
    "the glyph is its own class, not the desktop's `composer-attach-button`: the attach rule's `data-active` plate would read as a toggle that is switched on");
  assert.match(plusSource, /aria-haspopup="menu"/, "it opens a menu, and says so");
  assert.match(plusSource, /aria-expanded=\{open\}/, "and reports whether it is open");
  const anchor = cssRule(css, ".chat-composer .composer-plus-anchor");
  assert.ok(anchor, "the anchor is styled");
  for (const declaration of ["position: relative;", "display: flex;", "flex: 0 0 auto;", "align-self: flex-end;"]) {
    assert.ok(anchor.includes(declaration), `the anchor keeps ${declaration}`);
  }
  const disc = cssRule(css, ".chat-composer .composer-plus-button");
  assert.ok(disc, "the `+` is styled against the card, so the phone gets Send's disc");
  for (const declaration of ["width: var(--composer-send-size);", "height: var(--composer-send-size);", "border-radius: 999px;", "background: none;"]) {
    assert.ok(disc.includes(declaration), `the disc keeps ${declaration}`);
  }
  const attach = cssRule(css, ".composer-attach-button");
  assert.ok(attach, "the wider tier's attach button has a rule of its own");
  assert.match(attach, /align-self: flex-end;/,
    "its controls sit at the bottom edge of the growing text, like the phone's `+`");
  assert.match(attach, /justify-content: center;/, "the `+` glyph stays centered in its disc");
  assert.match(attach, /width: var\(--composer-send-size\);/, "and the hit area keeps the disc's touch size");
  assert.match(cssRule(css, ".composer-side-chat-button") ?? "", /align-self: flex-end;/,
    "the side-chat bubble rides the same edge, in the row it was pulled into");
});

test("the row's filler is the prompt, not the chips", () => {
  // The wide tier used to spend the card's free width on an invisible spacer (and before
  // that on the controls strip as `flex: 1 1 auto`). A filler that is not the text puts a
  // band of empty card between the prompt and Send, and the card's width stops being the
  // prompt's. The controls take their own width and shrink when the row runs out, so a
  // one-line card stays one line at any window width.
  assert.ok(controlsStyle, "the controls cell is one styled div");
  assert.match(controlsStyle[1], /flex: "0 1 auto"/, "it takes its own width and gives the rest back to the text");
  assert.match(controlsStyle[1], /minWidth: 0/, "min-width:auto would stop it at the model name's content size");
  // The project and the branch are not in the row at all — they are the row under the card
  // (the next test) — so the row's cells are the prompt, the glyphs and Send.
  assert.ok(!leftCell, "the chips' cell is gone from the composer's row");
  assert.doesNotMatch(chatInput, /maxWidth=\{isCompact \? 110 : 150\}/, "the branch chip is not in the row");
  const cell = cssRule(css, ".chat-composer-actions > .chat-composer-controls");
  assert.ok(cell, "the cell's own rule is scoped to the action row");
  assert.match(cell, /flex: 0 1 auto;/, "the stylesheet agrees with the JSX");
  assert.match(cell, /min-width: 0;/);
  assert.match(cell, /margin-right: 6px;/, "the inset in front of Send is a row's gap, not a column's");
  assert.doesNotMatch(chatInput, /<div style=\{\{ flex: 1 \}\} \/>/,
    "the trailing spacer is gone: it ate the width the prompt was asking for");
  assert.doesNotMatch(chatInput, /\{\/\* spacer \*\/\}/, "and its comment left with it, so no rule points at a box that is not there");
  assert.doesNotMatch(css, /margin-right: 15px/, "no hardcoded band in front of Send either: the row's gaps are 6px");
  // Send keeps the card's bottom-right corner in every state of the strip. The row used to
  // lose its filler under the phone's keyboard (the fork hid the strip there): with the
  // filler gone every control packed to the left — measured on WebKit at 390px, Send sat at
  // x=130 of a card that ends at 366. `auto` pins the corner with the strip grown, shrunk,
  // hidden, or gone, and changes nothing when it is.
  const sendRule = cssRule(css, ".chat-composer-actions > .composer-send-button");
  assert.ok(sendRule && sendRule.includes("margin-left: auto"),
    "Send stays at the card's bottom-right corner with the controls shrunk, hidden, or removed");
});

test("the chips strip is under the card, on every tier", () => {
  // The chips are not in the row at all — the row is the `+`, the prompt and Send — so the
  // project and the branch get a strip under the card, rendered from the same chip
  // components, on a desktop exactly as on a phone. It is the WRAP's child, not the card's:
  // that is what makes the card one row everywhere, and it is the only thing
  // `.chat-composer-wrap:has(> .composer-context-row)` can match. Nested in the card, the
  // strip inherited #63's clipping and its menus opened under the header.
  assert.match(chatInput, /className="composer-context-row"/, "the composer has a chips strip");
  const stripAt = chatInput.indexOf('className="composer-context-row"');
  const sendEnd = chatInput.indexOf("</button>", chatInput.indexOf('"native-primary-button composer-send-button"')) + "</button>".length;
  const between = chatInput.slice(sendEnd, stripAt);
  assert.equal(between.split("</div>").length - 1, 3,
    "Send's box, the action row, the editor and the card are all closed before the strip opens: it is not in the card");
  assert.match(chatInput.slice(stripAt - 300, stripAt), /!compact && \(\(pickersIdle && \(showProjectChip \|\| branchChipCwd\)\) \|\| routedModelHint\)/,
    "every tier's card gets the strip, and only when it has something to show");
  assert.match(chatInput.slice(stripAt, stripAt + 1400), /\{pickersIdle && showProjectChip && projectLabel && \(/,
    "the project picker is drawn only while the session is idle: a running session hides it");
  assert.match(chatInput.slice(stripAt, stripAt + 2000), /\{pickersIdle && branchChipCwd && \(/,
    "and the branch picker goes with it");
  assert.match(chatInput, /const pickersIdle = !isStreaming && !isCompacting;/,
    "running is the composer's own state: a run, or a compaction, is what takes the pickers away");
  const rowRule = cssRule(css, ".composer-context-row");
  assert.ok(rowRule, "the strip is laid out by the stylesheet, not inline");
  assert.match(css, /^\.composer-context-row \{$/m,
    "its rule is at the sheet's top level, not inside a phone media block: a desktop gets the strip too");
  assert.match(css, /^\.chat-composer-wrap:has\(> \.composer-context-row\) \{$/m,
    "and the wrap's clip is lifted for it, so the strip's menus open past the wrap");
  const wrap = cssRule(css, ".chat-composer-wrap:has(> .composer-context-row)");
  assert.ok(wrap, "the strip's menus are allowed past the wrap");
  assert.match(wrap, /overflow: visible;/, "#63 clips the composer's strips on a phone; this row caps its own width, so clipping it only cut the menus off");
  assert.match(rowRule, /display: flex;/, "the strip is a flex row of chips");
  assert.match(rowRule, /gap: 4px;/, "one gap between the chips");
  assert.match(rowRule, /min-width: 0;/, "and it shrinks with the column, so a long branch name ellipsizes");
  assert.match(rowRule, /min-width: 0;/, "and it shrinks: the chips cap their own width");
  assert.ok(!/\.chat-composer-wrap \.composer-context-row/.test(css),
    "the rule is not scoped to the wrap: on a fresh session the strip is the composer's own child, and the wrap exists only in a chat");
  assert.doesNotMatch(rowRule, /--chat-content-max-width/,
    "the composer's padded column already carries the width; a second copy would drift");
  // The context moved to the header, so nothing may grow back into the strip.
  assert.doesNotMatch(chatInput, /ContextUsageRing/, "the composer renders no context ring");
  assert.doesNotMatch(chatInput, /contextUsage|sessionStats/, "and it is not given the numbers any more");
});

test("the resting row is 80% of what it was, and every control pays for it", () => {
  // The ask: the composer is too big for a chat. The card, the `+` and Send shrink
  // together, from ONE number, because the card's bottom-right arc is derived from the
  // Send disc's centre: a hardcoded radius drifts the moment the size is a ratio
  // (e2e/composer-geometry.mjs measures the arcs meeting in every theme and width).
  const card = cssRule(css, ".chat-composer");
  assert.match(card, /--composer-send-size: calc\(36px \* 0\.8\);/, "the row's disc is 80% of the 36px it was");
  assert.match(card, /--composer-inset: 8px;/, "and the band around it 8px, so the card shrinks with its controls");
  assert.match(card, /padding: var\(--composer-inset\);/, "the inset is used, not retyped");
  assert.match(card, /border-radius: calc\(var\(--composer-send-size\) \/ 2 \+ var\(--composer-inset\) \+ var\(--composer-border-width\)\) !important;/,
    "the arc is computed from the disc, and pays for the border this rule removes");
  // A finger's tier keeps the platform's minimum: the 80% is the pointer's card, and a
  // phone's controls never go under 44px.
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.chat-composer \{\s*--composer-send-size: 44px;/,
    "the coarse tier overrides the ratio with the touch size");
  // On that tier the row is 44px tall and its two discs ride the bottom edge, so a one-line
  // prompt (a 24px line box at the phone's 16px font) rode the same edge and the empty
  // placeholder sat under the discs. The text is centred in the band the discs define.
  const coarse = css.slice(css.indexOf("@media (pointer: coarse) {\n  .chat-composer {"));
  assert.match(
    coarse.slice(0, 1200),
    /\.chat-composer-editor\[data-inline\] > \.chat-input-textarea \{\s*align-self: center;/,
    "the phone's prompt is centred in the row, so `Message…` sits on the discs' line");
  // Every control in the row is that box, so the row is one height and the card's arcs
  // meet one centre. The 32px squares (`--control-h-lg`) in a 28.8px row grew the resting
  // card taller than the card the ask is about.
  for (const selector of [".composer-attach-button", ".chat-composer .composer-plus-button", ".composer-side-chat-button", ".native-primary-button.composer-send-button"]) {
    const rule = cssRule(css, selector);
    assert.ok(rule, `${selector} has a rule of its own`);
    for (const declaration of ["width: var(--composer-send-size);", "height: var(--composer-send-size);"]) {
      assert.ok(rule.includes(declaration), `${selector} is sized by the row's disc, not a fixed box`);
    }
  }
  // The icon buttons the composer styles inline (reasoning, the running compaction, the
  // tool preset) take the same size: the row's height is the text's line and the disc.
  assert.equal(chatInput.split('width: "var(--composer-send-size)"').length - 1, 3,
    "reasoning, the abort-compaction and the tool preset are discs too");
  assert.doesNotMatch(chatInput, /--control-h-lg/,
    "the row's own controls never fall back to the 32px control height");
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
  const rule = cssRule(css, ".chat-composer-controls");
  assert.ok(rule, "the composer row keeps its own rule");
  for (const declaration of ["min-width: 0;", "max-width: 100%;"]) {
    assert.ok(rule.includes(declaration), `the composer row keeps ${declaration}`);
  }
  assert.match(rule, /overflow: visible;/,
    "the row's menus are rendered inside it and open above it: clipping the row clips their option lists");
  // The keyboard used to hide this strip (the fork's own rule), which left the phone's
  // composer with only `+` and Send: the model, the reasoning and the tools had no way
  // in while typing, and the side-chat bubble vanished with them. The strip stays, so
  // nothing in the row moves when the keyboard opens.
  assert.ok(!/html\[data-keyboard-open\] \.chat-composer-controls\s*\{[^}]*display: none/.test(css),
    "the phone keeps the row's controls while the keyboard is up");
});

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
  assert.match(side, /margin-right: 6px;/, "and stands off Send, in the row it shares with Send");
  assert.match(css, /@media \(pointer: coarse\) \{ \.composer-side-chat-button \{ width: 44px; height: 44px; \} \}/,
    "a finger's 44px target, whatever the pointer's ratio is");
  assert.doesNotMatch(chatInput, /onClearDraft/, "and the composer is not handed a draft-clearing callback any more");
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
  // What replaced the button: every attachment names its own remove control, images
  // included (the image's × used to be an unlabelled glyph, readable only because the
  // clear button stood next to it).
  assert.match(chatInput, /onClick=\{\(\) => removeImage\(i\)\}\n\s*aria-label=\{t\("chat\.removeImage"\)\}/,
    "the image's × says what it removes");
  const key = /"chat\.removeImage": "(Remove image|移除图片|移除圖片)",/g;
  assert.equal(plugins.match(key)?.length, 3, "the key carries all three locales");
});

test("the row's controls are icon-only, and named by title", () => {
  // The words (the level, the preset) were what the user asked to drop: the row is a run
  // of glyphs, and the label is what a pointer and a reader get.
  const reasoning = chatInput.slice(chatInput.indexOf('aria-expanded={thinkingDropdownOpen}'), chatInput.indexOf("chat.thinkingHeading"));
  assert.match(reasoning, /padding: 0,\n\s*width: "var\(--composer-send-size\)"/, "the reasoning button is a square icon button, sized by the row's disc");
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

test("the glyphs are one cluster, in the order the `+` menu lists them", () => {
  // The ask (2026-11-25): the model chip collapses into the controls group in every tier.
  // The ask (2026-11-26): on a phone that group lives behind the `+`, in one menu — so the
  // order the desktop row prints (model, reasoning, tools, automation) is the order the
  // menu lists, and the phone has no second copy of any of it. The chips' cell is the only
  // thing that shares the desktop's row.
  const chipAt = chatInput.indexOf("{modelControl}");
  const reasoningAt = chatInput.indexOf('aria-expanded={thinkingDropdownOpen}');
  const toolsAt = chatInput.indexOf('aria-expanded={toolDropdownOpen}');
  const automationAt = chatInput.indexOf("<SessionAutomationMenu");
  assert.equal(chatInput.split("<ModelSelector").length - 1, 1, "one model control, not a second copy per tier");
  assert.doesNotMatch(chatInput, /(isNarrow|!isNarrow) && modelControl/,
    "the chip is in the cluster in every tier: no tier places it, so a phone has no bare model glyph of its own");
  assert.ok(chipAt > 0 && reasoningAt > chipAt && toolsAt > reasoningAt && automationAt > toolsAt,
    "model, reasoning, tools and automation are one unbroken run, in that order");
  const cluster = chatInput.slice(chatInput.indexOf("{/* THE CLUSTER"), chatInput.indexOf("{modelControl}"));
  assert.match(cluster, /flex: "0 0 auto"/, "the run takes its own width (the prompt is the filler)");
  assert.match(cluster, /marginLeft: 0,/, "and starts at the row's left, off the chips");
  // The phone's copy of the run is the `+` menu: the hub lists attach, then the same four,
  // in the same order, from the same rows.
  const plusAt = (name) => plusSource.indexOf(name);
  for (const name of ['label={t("chat.composerPlusModel")}', 'label={t("chat.reasoningHeading")}', 'label={t("chat.toolsHeading")}', 'label={t("chat.sessionAutomation")}']) {
    assert.ok(plusAt(name) > 0, `the \`+\` menu lists ${name}`);
  }
  const attachRow = plusSource.indexOf("label={attachLabel}");
  assert.ok(attachRow < plusAt('label={t("chat.composerPlusModel")}'), "attach leads the hub, as the `+` is the row's first control");
  assert.ok(plusAt('label={t("chat.composerPlusModel")}') < plusAt('label={t("chat.reasoningHeading")}'),
    "the menu's order is the row's order, so the same habit works on both tiers");
  // The phone's second control is gone with the `+`: a strip in the phone's row would
  // take the prompt's width back, and its close control was clipped to 15px.
  assert.doesNotMatch(chatInput, /chat\.moreControls/, "no \"More controls\" button next to the `+`");
  assert.doesNotMatch(chatInput, /composer-controls-close/,
    "and the strip's own close control is gone with the phone's page it closed");
  assert.doesNotMatch(chatInput, /data-strip-open/,
    "the desktop's strip carries no tier/state marker: the animation it drove was the phone's strip, and the CSS rule that read it is gone");
  // The `+` is the phone's only way in, so its name has to carry the whole hub.
  assert.equal(plugins.match(/"chat\.composerPlus": /g)?.length, 3,
    "the `+` names what it opens, in all three locales");
  assert.equal(plugins.match(/"chat\.composerPlusModel": /g)?.length, 3,
    "and the hub's model row is named in all three, so the row is not the bare model glyph the phone used to print");
});

test("the / @ # hint is the row's own item, clear of the controls", () => {
  // It used to be a flex child under the text: the card grew a second line for a sentence
  // that only reads once. Then it was an absolute overlay on the card's right edge, which
  // once the card became one row printed `/ commands · @ files · # sessions` under the
  // model, reasoning and tools glyphs. It is the row's item between the prompt and the
  // controls, which is the only place in the card that is its own.
  const hint = cssRule(css, ".composer-trigger-hint");
  assert.ok(hint, "the hint is styled");
  assert.doesNotMatch(hint, /position: absolute|right: 0;|top: /,
    "no overlay anchors: an overlay in the row paints over the glyphs that share the row");
  assert.match(hint, /flex: 0 1 auto;/, "it takes its own width and shrinks with the row; the prompt stays the filler");
  assert.match(hint, /min-width: 0;/, "it can shrink below its text");
  assert.match(hint, /text-overflow: ellipsis;/, "and ellipsizes when the row runs out, instead of pushing the controls out of the card");
  assert.match(hint, /height: var\(--composer-first-line-height\);/, "boxed to the row's first line");
  assert.match(hint, /align-items: center;/, "its text centered in that box, so it sits on the placeholder's row at 12px and at 24px chat font alike");
  assert.match(hint, /margin-right: 14px;/, "the row's gap to the controls that follow it — clear of Send's disc, and not a hardcoded inset");
  assert.doesNotMatch(hint, /padding-right: /, "no padding of its own: the row's gaps are the card's spacing");
  assert.match(hint, /pointer-events: none;/, "it never takes a click meant for the text");
  assert.match(hint, /opacity: 0;/, "and it fades in only on the focused, empty card");
  // The gates stay: an empty, idle, wide card only, and the item sits between the prompt
  // and the controls.
  const hintJsx = chatInput.slice(chatInput.indexOf('className="composer-trigger-hint"') - 220, chatInput.indexOf('className="composer-trigger-hint"'));
  assert.match(hintJsx, /!compact && !isNarrow && !isStreaming && value\.length === 0/,
    "the hint shows on a wide, idle, empty card");
  const textAt = chatInput.indexOf('className="chat-input-textarea"');
  const hintAt = chatInput.indexOf('className="composer-trigger-hint"');
  const actionsAt = chatInput.indexOf('className="chat-composer-actions"');
  assert.ok(textAt < hintAt && hintAt < actionsAt,
    "the hint is in the row after the text and before the controls, which is where it is laid out");
});

test("the text area's box: the row's, and the quote box's", () => {
  // `width: 100%` plus a horizontal margin pushed the text 8px past the card's right
  // edge, on the phone as much as on a desktop. The width is bought from the parent's
  // stretch, so a margin can only inset — that pairing is the invariant. What is left in
  // the base rule is the quote box: its column puts the control row UNDER the text, so
  // the 18px below is the room above it and the left margin stands the prompt's first
  // character on the `+` glyph's left edge. The row overrides both (its controls sit
  // beside the text, at its bottom edge), and a rule that kept the column's insets in the
  // row grew the resting card and left the caret off the glyph.
  const rule = cssRule(css, ".chat-composer-editor > .chat-input-textarea");
  assert.ok(rule, "the textarea has a rule of its own");
  assert.match(rule, /width: auto;/, "the width comes from the parent's stretch");
  assert.match(rule, /margin: 8px 0 18px calc\(var\(--composer-send-size\) \/ 2 - 10px\);/,
    "top, the room above the quote box's row, and the inset that meets the `+` glyph (half the disc less 10px, so the 44px tier follows it to 12px)");
  assert.match(rule, /padding-right: 13px;/, "the caret stays off the card's edge");
  assert.doesNotMatch(rule, /margin: 8px;/, "never one inset on all four sides");
  assert.doesNotMatch(rule, /width: 100%;/, "and no full width to pair with a horizontal margin");
  const inline = cssRule(css, ".chat-composer-editor[data-inline] > .chat-input-textarea");
  assert.doesNotMatch(inline, /padding-right: 13px;/, "the row's text is inset by the row's gaps, not by the quote box's padding");
  const column = cssRule(css, ".chat-composer-editor");
  assert.match(column, /align-items: stretch;/,
    "the column stretches its children, which is where the quote box's width comes from");
});

test("a finger makes the row the menu tier, at any width", async () => {
  // 2026-11-27, a phone screenshot: the row is the `+`, the prompt, the side chat and Send;
  // the model, the reasoning, the tools and the session automation are rows of the `+`'s
  // menu (Compacting…, Add files, Model, Reasoning, Tools, Session automation). The tier
  // used to be decided by width alone, so a phone in landscape and a tablet — both wide,
  // both fingered — kept the desktop's row of 28px glyphs. The pointer decides it.
  const hook = await readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");
  assert.match(hook, /const COARSE_POINTER_QUERY = "\(pointer: coarse\)";/, "the query is the media query for a touch device");
  assert.match(hook, /export function useCoarsePointer\(\): boolean \{[\s\S]*?useSyncExternalStore\(/,
    "it is a hook with the same SSR-safe shape as useIsMobile, so the server never picks the menu tier");
  assert.match(chatInput, /const coarsePointer = useCoarsePointer\(\);/, "the composer asks what the pointer is");
  assert.match(chatInput, /if \(isMobile \|\| coarsePointer \|\| width < 400\) \{/,
    "a touch device is the menu tier at any window width");
  assert.match(chatInput, /\}, \[isMobile, coarsePointer\]\);/,
    "and the tier is re-measured when the pointer changes (an external mouse on a tablet)");
  assert.match(chatInput, /\{!compact && !isNarrow && <div className="chat-composer-controls"/,
    "the cluster of glyphs is the pointer tier's: the menu tier renders none of it in the row");
  assert.match(plusSource, /className="native-popover app-menu composer-plus-menu"/,
    "the menu the `+` opens is the shared app-menu surface, with the controls as its rows");
});
