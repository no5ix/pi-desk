import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";

// app/native-theme.css is the fork's stylesheet (globals.css and settings.css are
// upstream's and stay byte-identical), and the phone's pass over the conversation
// lives only here. Each assertion names the screenshot it answers.
const css = readFileSync(new URL("./native-theme.css", import.meta.url), "utf8");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const messageView = readFileSync(new URL("../components/MessageView.tsx", import.meta.url), "utf8");
const branchChip = readFileSync(new URL("../components/message-branch-action.tsx", import.meta.url), "utf8");
const mermaid = readFileSync(new URL("../components/MermaidBlock.tsx", import.meta.url), "utf8");
const chatInput = readFileSync(new URL("../components/ChatInput.tsx", import.meta.url), "utf8");

function rules(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies = [];
  for (const match of cssNoComments.matchAll(new RegExp(`(^|[,\\s])${escaped}\\s*(?=,|\\{)`, "g"))) {
    const open = cssNoComments.indexOf("{", match.index + match[0].length);
    bodies.push(cssNoComments.slice(open + 1, cssNoComments.indexOf("}", open)));
  }
  assert.ok(bodies.length > 0, `${selector} has a rule`);
  return bodies;
}

function declarations(selector) {
  return rules(selector).flatMap((body) => body.split(";").map((d) => d.replace(/\s+/g, " ").trim()).filter(Boolean));
}

function declared(selector, property) {
  return declarations(selector).filter((d) => d.split(":")[0].trim() === property);
}

test("the scroll-to-latest disc has no edge and a shadow that lifts it (pic: the round arrow)", () => {
  for (const declaration of declared(".chat-scroll-to-bottom.is-visible", "border")) {
    const value = declaration.slice(declaration.indexOf(":") + 1).replace("!important", "").trim();
    assert.ok(/^0$|^none$/.test(value), `the disc keeps no border, and it says so (${declaration})`);
  }
  const shadows = declared(".chat-scroll-to-bottom.is-visible", "box-shadow");
  assert.ok(shadows.length > 0, "the disc has a shadow rule");
  // The disc takes the app's own floating-layer token (fec93a2b), the same lift the
  // topbar and the panels wear, so the value to judge is the token, not a literal.
  assert.match(shadows.join("\n"), /box-shadow: var\(--shadow-composer\)/, "the disc lifts with the shared token");
  const token = [...cssNoComments.matchAll(/--shadow-composer:([^;]*);/g)].map((m) => m[1]);
  const winning = token.filter((value) => /!important/.test(value));
  assert.ok(winning.length > 0, "the token is set with !important, so a theme's value wins the cascade");
  for (const value of winning) {
    const layers = value.split(/,(?![^(]*\))/).filter((layer) => layer.trim().length > 0);
    assert.ok(layers.length >= 2, `the shadow is a pair of layers, not the one quiet drop upstream drew (${value.trim()})`);
    assert.match(value, /#[0-2][0-9a-f][0-2][0-9a-f][0-2][0-9a-f][4-9a-f][0-9a-f]/, "a dark, obvious shadow (near-black ink at a quarter alpha or more): it has to read over prose and over a code fence");
  }
});

test("the scroll-to-latest disc rests as a translucent plate, and a hover closes it (pic: the disc at rest, then hovered)", () => {
  // The fork's palette makes --bg-panel the page's own colour, so upstream's
  // `background: var(--bg-panel)` drew a chip in the colour of what it floats on,
  // lifted by nothing but its shadow (the flat dark disc in the screenshot). The one
  // state that looked like a floating control was the hover's translucent wash.
  const resting = declared(".chat-scroll-to-bottom.is-visible", "background");
  assert.ok(resting.length > 0, "the disc has a resting background");
  for (const declaration of resting) {
    assert.doesNotMatch(declaration, /background:\s*var\(--bg-panel\)/, `${declaration} is not the page's own colour`);
  }
  const fill = resting.find((d) => /color-mix\(in srgb, var\(--surface\)/.test(d));
  assert.ok(fill, "the resting fill is the plate let through the page (a translucent plate, so prose reads under it)");
  const restPercent = Number(fill.match(/var\(--surface\)\s+(\d+(?:\.\d+)?)%/)[1]);
  assert.ok(restPercent >= 40 && restPercent <= 65, `the resting disc is a part of the plate, not the plate (${restPercent}%)`);

  const hover = declared(".chat-scroll-to-bottom.is-visible:hover", "background").find((d) => /color-mix\(in srgb, var\(--surface\)/.test(d));
  assert.ok(hover, "the hover rule is the fork's, so upstream's opaque wash does not win the cascade");
  const hoverPercent = Number(hover.match(/var\(--surface\)\s+(\d+(?:\.\d+)?)%/)[1]);
  assert.ok(hoverPercent > restPercent, `a hover answers by closing the transparency, not by changing hue (${restPercent}% -> ${hoverPercent}%)`);
});

test("a code fence stands off the page (pic: the json fence in the conversation)", () => {
  assert.match(cssNoComments, /:root\s*\{[^}]*--code-surface:\s*var\(--bg-panel\)\s*;/, "one named surface for a fence body, so the wrapper, the pre and the Mermaid block agree");
  for (const selector of [".markdown-code-block", ".mermaid-block"]) {
    assert.match(declared(selector, "background").join("\n"), /background: var\(--code-surface\)/, `${selector} paints the fence surface`);
  }
  // The pre's colour is inline in the component, so the token has to be there.
  const surfaces = mermaid.match(/backgroundColor: "var\(--code-surface\)"/g) ?? [];
  assert.equal(surfaces.length, 2, "the streaming pre and the highlighted pre both take the token");
  assert.doesNotMatch(mermaid, /92%, var\(--bg-panel\)/, "the 8 % step that measured 1 point off the page is gone");
});

test("a subagent report is a panel with a thinking card's type (pic: the opened report)", () => {
  // The plates read one step lighter than --bg-panel since 2f78d4a2 ("four chat
  // plates read lighter"): a report is a step off the page, not a sidebar.
  for (const selector of [".custom-message-card", ".custom-message-body", ".custom-message-footer"]) {
    assert.match(declared(selector, "background").join("\n"), /background: var\(--bg-subtle\) !important/, `${selector} is the plate off the page, not the page`);
  }
  for (const name of ["custom-message-card", "custom-message-body", "custom-message-footer"]) {
    assert.ok(messageView.includes(`className="${name}"`), `the report draws ${name}`);
  }
  const size = declared(".markdown-custom-message", "font-size").join("\n");
  assert.match(size, /font-size: var\(--fs-caption\)/, "the report's text is the thinking card's size");
  assert.match(declared(".markdown-custom-message", "font-weight").join("\n"), /font-weight: var\(--fw-regular\)/, "…and its weight");
  assert.match(messageView, /fontSize: "var\(--fs-caption\)"/, "the thinking card's body keeps the size this rule is measured against");
});

test("a report's and a compaction's body read as the reply's prose (pic: both cards beside a report)", () => {
  // Asked for: the thinking card's font size, the final report's font type,
  // character spacing and line spacing. Upstream's report is a 13px terminal face
  // on 1.32 leading (globals.css) and a compaction inherits the 14px reply body,
  // so the two cards read as two kinds of text the conversation is not made of.
  for (const selector of [".markdown-custom-message", ".markdown-compaction-message"]) {
    assert.match(declared(selector, "font-family").join("\n"), /font-family: var\(--font-ui\)/, `${selector} is the app's reading face, not a terminal face`);
    assert.match(declared(selector, "letter-spacing").join("\n"), /letter-spacing: normal/, `${selector} keeps the reply's character spacing`);
    assert.match(declared(selector, "line-height").join("\n"), /line-height: 1\.7/, `${selector} keeps the reply's line spacing`);
    assert.match(declared(selector, "font-size").join("\n"), /font-size: var\(--fs-caption\)/, `${selector} is the thinking card's size`);
  }
  // The reply is what those values are copied from.
  assert.match(cssNoComments, /\.markdown-body \{[^}]*line-height: 1\.7/, "1.7 is a reply's leading");
  assert.match(cssNoComments, /html, body \{[^}]*font-family: var\(--font-ui\)/, "--font-ui is the face a reply is set in");
  // A chip of inline code is sized to the prose it sits in, not to a 14px reply.
  for (const selector of [".markdown-custom-message .markdown-inline-code", ".markdown-compaction-message .markdown-inline-code"]) {
    assert.match(declared(selector, "font-size").join("\n"), /font-size: 1em/, `${selector} fits the 12px prose around it`);
  }
  // The compaction card's own body paints its type inline, so the intro line and
  // the markdown summary under it are one body of text at one size.
  assert.match(messageView, /fontSize: "var\(--fs-caption\)"[\s\S]{0,160}lineHeight: 1\.7/, "the compaction body carries the size and leading inline");
  assert.doesNotMatch(messageView, /marginTop: 3, marginBottom: 10, color: "var\(--text\)", fontSize: "calc\(14px/, "the intro line no longer sizes itself above the summary");
});

test("a turn's Process details group stands on a translucent plate (pic: the folded steps)", () => {
  assert.match(declared(".process-details-content", "background").join("\n"), /background: color-mix\(in srgb, var\(--surface\) 34%, transparent\)/, "the plate is the surface a third over the page");
});

test("a thinking card is a blue wash, not the page's own colour (pic: the reasoning block)", () => {
  // The card painted `background: var(--bg)` inline, so it sat on the page as a field of
  // prose. The asked-for fill is a fixed blue at 13 % alpha, over whatever it stands on.
  assert.match(declared(".thinking-card", "background").join("\n"), /background: #00a8ff21/, "the card wears the asked-for wash");
  const thinking = messageView.match(/export function ThinkingBlock\([\s\S]*?\n\}\n/)[0];
  assert.match(thinking, /className="thinking-card"/, "the card carries the class the stylesheet fills");
  assert.ok(!/background: "var\(--bg\)"/.test(thinking), "the inline page fill is gone, so the rule reaches it with no !important");
});

test("the sidebar gives its search field a seam above the Chats header (pic: Chats under the box)", () => {
  const margin = declared(".sidebar-search-wrap", "margin").join("\n");
  const match = margin.match(/margin:\s*0\s+10px\s+(\d+)px/);
  assert.ok(match, `the field's bottom gap is declared (${margin})`);
  assert.ok(Number(match[1]) >= 10, `the box and the list header are apart by at least 10px, not the 6px that read as one block (${match[1]}px)`);
});

test("a phone's Settings list separates rows under the label, iOS-style (pic: the settings rows)", () => {
  assert.match(declared(".settings-phone-home-item", "border-bottom").join("\n"), /border-bottom: 0/, "no line under the icon: upstream's full-width border is named zero");
  assert.ok(cssNoComments.includes(".settings-phone-home-item:not(:last-child)::after"), "the separator belongs to the row and stops with the group");
  const after = declarations(".settings-phone-home-item:not(:last-child)::after");
  assert.match(after.join("\n"), /left: 52px/, "it starts at the label's first letter: 18px of padding + a 20px icon + the 14px gap");
  assert.match(after.join("\n"), /background: var\(--separator\)/, "a row separator, the token the app uses inside a surface");
});

test("the keyboard leaves the composer's row alone", () => {
  // The phone's screenshot: with the keyboard up the composer kept only `+` and Send.
  assert.doesNotMatch(cssNoComments, /html\[data-keyboard-open\]\s+\.chat-composer-controls\s*\{[^}]*display:\s*none/, "the controls strip, the More button and the side-chat bubble stay in their place under the keyboard");
  // The lift is an animation, not a jump: the app's height follows the keyboard.
  assert.ok(/html\[data-keyboard-open\]\s+\.app-shell\s*\{[^}]*transition:\s*height/.test(cssNoComments), "the composer's travel is transitioned");
  const composerRow = readFileSync(new URL("../components/ChatInput.composer-row.test.mjs", import.meta.url), "utf8");
  assert.match(composerRow, /data-keyboard-open[^\n]*chat-composer-controls/, "the composer's own suite pins the rule's absence");
});

test("the composer's caret is armed by the finger and repainted after the lift (pic: the keyboard with no cursor)", () => {
  assert.ok(chatInput.includes('import { useComposerCaret } from "@/hooks/useComposerCaret";'), "the composer owns the caret's recovery");
  assert.ok(chatInput.includes("useComposerCaret(textareaRef)"), "…on its text area");
  const arms = chatInput.match(/armComposerCaret\(textareaRef\.current\)/g) ?? [];
  assert.ok(arms.length >= 2, "the text area and the card both arm the caret inside the gesture");
  const gestures = chatInput.match(/isTouchPointer\(event\.nativeEvent\)/g) ?? [];
  assert.ok(gestures.length >= 2, "…and only a finger's tap does it, never a mouse click");
});

test("the sidebar's search box is a label, not a sentence (pic: Search titles… · Enter for full te)", async () => {
  const { forkLocalePlugins } = await createJiti(import.meta.url).import("../lib/i18n/locale-plugins.ts");
  for (const { name, messages } of forkLocalePlugins) {
    const label = messages["sidebar.searchSessions"];
    assert.ok(label, `${name}: the search box is labelled`);
    assert.ok(!label.includes("·") && !/Enter/i.test(label), `${name}: the second clause is gone (${label})`);
  }
  // The gesture it used to describe is not lost: the input's tooltip carries it.
  const sidebar = readFileSync(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /title=\{t\("sidebar\.searchAllHint"\)\}/, "Enter for full text search lives in the tooltip");
});

test("a tool call's band stands off the page, its clock is readable, and a phone is not asked to branch under every call (pic: the column of rows)", () => {
  // The tint: the three states, deeper than the inline 4%/5%/6% they replace.
  const tint = (selector) => declared(selector, "background").join("\n");
  assert.match(tint(".tool-call-card"), /background: rgba\(34, 197, 94, 0\.0[89]\d?\)/, "a normal call is a band, not a wash");
  assert.match(tint(".tool-call-card.is-error"), /background: rgba\(248, 113, 113, 0\.1\)/, "a failed one carries its own depth");
  assert.match(tint(".tool-call-card.is-aborted"), /background: rgba\(148, 163, 184, 0\.11\)/, "and an aborted one");
  assert.match(messageView, /className=\{`tool-call-card\$\{isError \? " is-error" : aborted \? " is-aborted" : ""\}`\}/, "the card carries the class the stylesheet needs");
  assert.ok(!/background: isError\s*\n?\s*\? "rgba\(248,113,113,0\.05\)"/.test(messageView), "the inline 5% wash is gone from the card");

  // The clock beside a reply's model: 10px was a dot; the row shares the app's 12px glyph.
  assert.match(messageView, /className="message-assistant-model-time">\s*<ClockIcon size=\{12\} \/>/, "the message's clock is the app's 12px glyph");

  // The branch chip — the newest reply's footer copy and the tail row's — is dropped on a
  // phone: the sidebar's Fork and the composer carry branching there, and a small chip
  // under a long reply is noise.
  assert.match(branchChip, /className="message-assistant-action message-branch-action"/, "the chip is addressable by name");
  const hidden = cssNoComments.match(/@media \(max-width: 640px\)\s*\{[^}]*\.message-branch-action\s*\{[^}]*display: none !important/g);
  assert.ok(hidden, "on a phone's width the chip is not drawn, and the rule is strong enough to beat the chip's inline display: flex");
  assert.ok(!/\.message-copy-action\s*\{[^}]*display: none/.test(cssNoComments), "Copy is not taken with it");
});

test("the composer's corner: a plate, a gutter, and a tall editor that out-inlines the box (pic: the corner button)", () => {
  // The glyph is small; the plate it lives on is the target, and on a finger the plate is
  // the fork's 36px. `declarations()` flattens the media wrappers, so both tiers of one
  // selector come back together and the assertion reads the pair.
  const plate = declarations(".chat-composer > .chat-composer-expand");
  assert.ok(plate.some((d) => /^width:\s*26px/.test(d)), "the plate is 26px at rest (the card's 80% row)");
  assert.ok(plate.some((d) => /^width:\s*36px/.test(d)), "and 36px for a finger");
  assert.ok(plate.some((d) => /^height:\s*36px/.test(d)), "the finger's plate is square");
  assert.ok(plate.some((d) => /^position:\s*absolute/.test(d)), "the corner is anchored, not floated into the text");
  assert.ok(plate.some((d) => /^left:\s*(4|2)px/.test(d)), "the corner is the card's UPPER-LEFT: the `+` keeps the row's bottom-left");
  assert.ok(!plate.some((d) => /^right:/.test(d)), "and has no right anchor (the corner is not the card's top-right)");
  assert.ok(declarations(".chat-composer").some((d) => /^position:\s*relative/.test(d)),
    "the card is the anchor, so the glyph lands in the card's own corner");

  // The text stops short of the corner: the first line is never typed under the glyph.
  const gutter = declared(".chat-composer.has-expand .chat-composer-editor > .chat-input-textarea", "padding-left");
  assert.ok(gutter.some((d) => d.includes("34px")), "the card reserves 34px for the corner");
  assert.ok(gutter.some((d) => d.includes("44px")), "and 44px where the plate is a finger's");
  assert.ok(!declarations(".chat-composer.has-expand .chat-composer-editor > .chat-input-textarea")
    .some((d) => /^padding-right:\s*(38|44)px/.test(d)), "no gutter on the right: the corner is not there");

  // The composer sizes its textarea with inline styles (`min-height: 24px`,
  // `max-height: 200px`, and a height it grew to the text), so the tall editor has to be
  // declared with `!important` on all three axes it takes over.
  const tall = ".chat-composer.is-expanded .chat-composer-editor > .chat-input-textarea";
  for (const property of ["height", "min-height", "max-height"]) {
    const rules = declared(tall, property);
    assert.ok(rules.length > 0, `${tall} sets ${property}`);
    assert.ok(rules.every((d) => d.includes("!important")), `${property} out-inlines the composer's own box (${rules.join(" | ")})`);
  }

  // With the keyboard up, the editor is measured against the keyboard's own height — the
  // shell's height, which hooks/useViewportHeight.ts keeps current.
  const keyboard = declarations("html[data-keyboard-open] .chat-composer.is-expanded .chat-composer-editor > .chat-input-textarea");
  const bounds = keyboard.filter((d) => /^(min-)?max?-height/.test(d));
  assert.ok(bounds.length > 0, "the keyboard tier sets the editor's bounds");
  assert.ok(bounds.every((d) => d.includes("--app-viewport-height")),
    "the tall editor is sized by the room above the keyboard, never under it");

  // The card's own geometry is untouched: Send keeps the arc, so its rule stays.
  assert.ok(declared(".chat-composer-actions > .composer-send-button", "margin-left").some((d) => /auto/.test(d)),
    "Send still pins the card's bottom-right corner");

  const reduced = declarations(".chat-composer > .chat-composer-expand");
  assert.ok(reduced.some((d) => /transition:\s*none/.test(d)), "a reduced-motion reader gets no turn");
});
