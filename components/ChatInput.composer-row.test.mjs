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
// 2026-11-25 (a phone ask): the strip leads the row, and the model chip collapsed into the
// group the phone opens behind a control.
// 2026-11-26 (the same person, looking at a phone screenshot): that row is not needed at
// all. An empty phone composer is ONE row — `+`, the prompt, Send — and every session
// control lives behind the `+`, in one menu; the project and branch chips move to a strip
// under the card; and the card grows smoothly as the prompt wraps. So the controls cell
// this file used to lay out in two tiers is now the wider tiers' row, and the phone's
// geometry is `data-inline` (app/native-theme.css). The width rules below still guard the
// desktop row, which is where the squeezed-window case lives.
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const modelSource = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");

const rowStart = chatInput.indexOf('className="chat-composer-controls"');
const row = chatInput.slice(rowStart, chatInput.indexOf("\n", rowStart) + 1200);
const leftCell = chatInput.match(/<div style=\{\{ flex: "0 1 auto"[\s\S]*?(?=\{\/\* THE CLUSTER:)/);
const plusMenu = chatInput.match(/<ComposerPlusMenu[\s\S]*?\n            \/>/);
const plusSource = await readFile(new URL("./ComposerPlusMenu.tsx", import.meta.url), "utf8");
const heightSource = await readFile(new URL("../lib/composer-textarea-height.ts", import.meta.url), "utf8");
const plusSource = await readFile(new URL("./ComposerPlusMenu.tsx", import.meta.url), "utf8");
const heightSource = await readFile(new URL("../lib/composer-textarea-height.ts", import.meta.url), "utf8");
const editorCard = chatInput.match(/className="chat-composer-editor"[\s\S]*?alignItems: isNarrow && !compact \? "flex-end" : "stretch",/);

test("the control row is the wider tiers', and the phone's card is one row", () => {
  assert.ok(rowStart > 0, "the composer controls row renders");
  assert.match(row, /display: "flex"/);
  assert.match(row, /flex: "1 1 auto"/, "the row takes the width the chips leave");
  assert.match(row, /minWidth: 0/, "and it can shrink, which is what keeps a squeezed window honest");
  assert.match(chatInput, /\{!compact && !isNarrow && <div className="chat-composer-controls"/,
    "a phone renders no controls cell: its row is the `+`, the prompt and Send");
  // The phone's one row is the card's own layout, not a JSX fork of the card: ChatInput
  // marks the editor and the stylesheet folds the action row's children into the card's
  // flex row. Keeping one JSX tree is what keeps Send in the corner in every tier.
  assert.match(chatInput, /data-inline=\{isNarrow && !compact \? "true" : undefined\}/,
    "the inline tier is marked, and only there");
  const inline = cssRule(css, ".chat-composer-editor[data-inline] > .chat-composer-actions");
  assert.ok(inline, "the action row is folded into the card's row");
  assert.match(inline, /display: contents;/);
  const text = cssRule(css, ".chat-composer-editor[data-inline] > .chat-input-textarea");
  assert.match(text, /flex: 1 1 auto;/, "the text takes the width the `+` and Send leave");
  assert.doesNotMatch(text, /width: 100%;/, "and buys it from the row, never from a full width + margin");
});

test("the left cell can shrink, and no context control is left in the row", () => {
  assert.ok(leftCell, "the left cell is one styled div");
  assert.match(leftCell[0], /flex: "0 1 auto"/, "it shrinks, so the chips truncate instead of pushing the controls out");
  assert.match(leftCell[0], /minWidth: 0/, "min-width:auto would stop it at the model name's content size");
  // 2026-11-26: on a phone the chips are not in the row at all — the row is the prompt —
  // so they get a strip under the card, and it is rendered from the same chip components.
  assert.match(chatInput, /className="composer-context-row"/, "the phone has a chips strip under the card");
  assert.ok(chatInput.indexOf('className="chat-composer-editor"') < chatInput.indexOf('className="composer-context-row"'),
    "the strip is below the card, not inside it");
  const strip = cssRule(css, ".chat-composer-wrap .composer-context-row");
  assert.ok(strip, "the strip is a flex row of chips");
  assert.match(strip, /min-width: 0;/, "and it shrinks: the chips cap their own width");
  assert.doesNotMatch(strip, /--chat-content-max-width/,
    "the composer's padded column already carries the width; a second copy would drift");
  // The context moved to the header, so nothing may grow back into the strip the
  // phone's More button has to share.
  assert.doesNotMatch(chatInput, /ContextUsageRing/, "the composer renders no context ring");
  assert.doesNotMatch(chatInput, /contextUsage|sessionStats/, "and it is not given the numbers any more");
});

test("the phone's `+` is a disc, and it names what it opens", () => {
  assert.ok(plusMenu, "the phone composer renders the `+` menu");
  assert.match(plusMenu[0], /className="native-toolbar-button composer-attach-button composer-plus-button"/,
    "it is the attach button's disc: one touch target, one rule, in the row beside Send");
  assert.match(plusMenu[0], /aria-haspopup="menu"/, "it opens a menu, and says so");
  assert.match(plusMenu[0], /aria-expanded=\{open\}/, "and reports whether it is open");
  assert.match(cssRule(css, ".composer-attach-button") ?? "", /width: var\(--composer-send-size\);/,
    "the disc keeps the touch size the row is built around");
  assert.match(chatInput, /\{!compact && \(isNarrow \?\s*<ComposerPlusMenu/,
    "the compact composer (the side chat) keeps no `+`");
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
  // The keyboard used to hide this strip (the fork's own rule), which left the phone's
  // composer with only `+` and Send: the model, the reasoning and the tools had no way
  // in while typing, and the side-chat bubble vanished with them. The strip stays, so
  // nothing in the row moves when the keyboard opens.
  assert.ok(!/html\[data-keyboard-open\] \.chat-composer-controls\s*\{[^}]*display: none/.test(css),
    "the phone keeps the row's controls while the keyboard is up");
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
  assert.ok(editorCard, "the editor's box is one style object");
  assert.match(editorCard[0], /flexDirection: isNarrow && !compact \? "row" : "column",/,
    "a phone lays the card out as one row; the wider tiers are a column: the text, then the row");
  assert.match(editorCard[0], /alignItems: isNarrow && !compact \? "flex-end" : "stretch",/,
    "the row bottom-aligns its glyphs; the column stretches the text across the card");
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
  // The row's flex filler is the controls strip. It used to be hidden under the
  // keyboard, and with it gone every control packed to the left, Send included (WebKit,
  // 390px: Send at x=130 of a card ending at 366). `auto` keeps Send in the card's
  // corner for the strip's other states, and for any rule that hides it later.
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

test("the row's glyphs are one cluster, and the `+` menu lists them in the same order", () => {
  // The ask (2026-11-25): the model chip collapses into the controls group in every tier.
  // The ask (2026-11-26): on a phone that group lives behind the `+`, and the user opens a
  // menu that lists it — so the order the row prints (model, reasoning, tools, automation)
  // is the order the menu lists, from the same rows, and the phone has no second copy of
  // any of it. The chips' cell is the only thing that shares the desktop's row.
  const attachAt = chatInput.indexOf('className="native-toolbar-button composer-attach-button"');
  const controlsAt = chatInput.indexOf('className="chat-composer-controls"');
  const moreAt = chatInput.indexOf('aria-label={t("chat.moreControls")}');
  const chipAt = chatInput.indexOf("{modelControl}");
  const reasoningAt = chatInput.indexOf('aria-expanded={thinkingDropdownOpen}');
  const toolsAt = chatInput.indexOf('aria-expanded={toolDropdownOpen}');
  const automationAt = chatInput.indexOf("<SessionAutomationMenu");
  const closeAt = chatInput.indexOf('className="composer-controls-close"');
  const spacerAt = chatInput.indexOf("{/* spacer */}");
  assert.equal(chatInput.split("<ModelSelector").length - 1, 1, "one model control, not a second copy per tier");
  assert.doesNotMatch(chatInput, /(isNarrow|!isNarrow) && modelControl/,
    "the chip is in the cluster in every tier: no tier places it, so a phone has no bare model glyph of its own");
  // The strip's glyphs are one 32px run. The labelled toolbar chip fills its row on a
  // phone (`width: 100%`, `flex: 1 1 auto`), and inside the strip's max-content row that
  // width is the strip's own: it put a 22px gap after the model glyph and squeezed the
  // strip's close control from 36px to 15px (measured in Chromium and WebKit at 390px).
  assert.match(modelSource, /width: iconOnly \? undefined : variant === "field" \|\| isMobile \? "100%" : undefined/, "an icon-only model control sizes to its glyph");
  assert.match(modelSource, /flex: iconOnly \? "0 0 auto" : variant === "toolbar" && isMobile \? "1 1 auto" : undefined/);
  assert.match(cssRule(css, ".composer-controls-close") ?? "", /flex-shrink: 0;/, "and the control that closes the strip keeps its 36px box");
  for (const [at, what] of [[attachAt, "attach"], [controlsAt, "the strip"], [moreAt, "the phone's More button"],
    [chipAt, "the cluster's chip"], [reasoningAt, "reasoning"], [toolsAt, "tools"], [automationAt, "automation"],
    [closeAt, "the strip's close"], [spacerAt, "the spacer"]]) {
    assert.ok(at > 0, `${what} renders`);
  }
  assert.ok(attachAt < controlsAt && controlsAt < moreAt, "the strip follows `+`, and More leads it");
  assert.ok(moreAt < chipAt && chipAt < reasoningAt && reasoningAt < toolsAt && toolsAt < automationAt,
    "model, reasoning, tools and automation are one unbroken run of glyphs behind More");
  assert.ok(automationAt < closeAt, "the strip closes with its own control");
  assert.ok(closeAt < spacerAt, "the cluster ends before the spacer, so it starts at the row's left");
  assert.doesNotMatch(chatInput, /marginLeft: isNarrow \? 0 : "auto"/,
    "the strip is no longer pushed to the card's right edge");
  assert.match(chatInput, /marginLeft: 0,/);
  // The strip floats above the row from the More button's edge, and on a phone that
  // edge is the row's left end: anchored right, the panel would open off the card.
  assert.match(chatInput, /position: "absolute",\s*left: 0,\s*bottom: 0,/,
    "the phone's strip opens from the More button's left edge");
  assert.doesNotMatch(chatInput, /position: "absolute",\s*right: 0,/,
    "no right anchor: the phone's More button no longer sits at the card's right edge");
  // A closed phone row prints no model name, so the button that opens the strip names it.
  assert.match(chatInput, /title=\{controlsMenuOpen \? undefined : moreControlsTitle\}/);
  assert.match(chatInput, /modelDisplayName \? \`\$\{t\("chat\.changeModel"\)\}: \$\{modelDisplayName\}\` : null,/);
  assert.match(chatInput, /aria-label=\{t\("chat\.moreControls"\)\}/, "the accessible name stays the short one");
});

test("the phone's strip appears and disappears with a transition, in and out", () => {
  // The strip used to blink: the closed phone row kept the strip mounted and flipped its
  // `display`, so opening and the close control's tap swapped the glyphs in one frame.
  // The animation is CSS on that same flip, and the two pieces it needs are the point of
  // this test: `display` is a discrete property, so an exit needs `transition-behavior:
  // allow-discrete` (without it the strip is gone before a frame of the fade), and an
  // entry needs `@starting-style` (a browser skips the transition on the first style
  // update after `display: none`). Firefox parses allow-discrete without transitioning
  // `display` (bug 1882408): there the strip fades in and closes at once.
  assert.match(chatInput, /className="composer-controls-strip"/, "the strip carries its own class");
  assert.match(chatInput, /data-strip-open=\{isNarrow \? \(controlsMenuOpen \? "true" : "false"\) : undefined\}/,
    "and names its tier and state, so the desktop's inline row never animates");
  const strip = cssRule(css, ".composer-controls-strip[data-strip-open]");
  assert.ok(strip, "the strip's animation has a rule of its own in the fork's stylesheet");
  assert.match(strip, /transition:\s*\n?\s*display [^,]+,\s*\n\s*opacity/, "display is in the transition list, so the exit keeps the box long enough to fade");
  assert.match(strip, /\n  transition-behavior: allow-discrete;/,
    "allow-discrete is its own declaration: in the shorthand an older engine drops the whole transition");
  assert.doesNotMatch(strip, /transition:[^;]*allow-discrete/, "never inside the transition shorthand");
  assert.match(strip, /transform-origin: left bottom;/,
    "it grows out of the More button's edge, the corner it is anchored to");
  const closed = cssRule(css, '.composer-controls-strip[data-strip-open="false"]');
  assert.ok(closed, "the closed state carries the exit values");
  assert.match(closed, /opacity: 0;/);
  assert.match(closed, /translate: 0 6px;/, "and the strip sinks back toward the glyph that opens it");
  assert.match(closed, /pointer-events: none;/,
    "the fading strip keeps its box, so it must not eat the taps aimed at the row under it");
  assert.match(css, /@starting-style \{\s*\n\s*\.composer-controls-strip\[data-strip-open="true"\] \{\s*\n\s*opacity: 0;/,
    "the entry transitions from the closed values");
  const reducedAt = css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .composer-controls-strip");
  assert.ok(reducedAt > 0, "reduced motion is handled");
  const reduced = css.slice(reducedAt, reducedAt + 900);
  assert.match(reduced, /translate: none;\s*\n\s*scale: none;\s*\n\s*transition-duration: var\(--dur-fast\);/,
    "no travel, a shorter fade");
  assert.match(reduced, /@starting-style/, "including the entry's starting style");
});
