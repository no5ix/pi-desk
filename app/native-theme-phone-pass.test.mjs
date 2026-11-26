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
  const widest = shadows.map((d) => d.slice(d.indexOf(":") + 1)).join(";");
  const layers = widest.split(/,(?![^(]*\))/).filter((layer) => layer.trim().length > 0);
  assert.ok(layers.length >= 2, `the shadow is a pair of layers, not the one quiet drop upstream drew (${widest.trim()})`);
  assert.match(widest, /rgba\(0, 0, 0, 0\.[3-9]/, "a dark, obvious shadow: it has to read over prose and over a code fence");
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
  for (const selector of [".custom-message-card", ".custom-message-body", ".custom-message-footer"]) {
    assert.match(declared(selector, "background").join("\n"), /background: var\(--bg-panel\) !important/, `${selector} is the recessed panel, not the page`);
  }
  for (const name of ["custom-message-card", "custom-message-body", "custom-message-footer"]) {
    assert.ok(messageView.includes(`className="${name}"`), `the report draws ${name}`);
  }
  const size = declared(".markdown-custom-message", "font-size").join("\n");
  assert.match(size, /font-size: calc\(11px \+ var\(--chat-font-size-offset, 0px\)\)/, "the report's text is the thinking card's size");
  assert.match(declared(".markdown-custom-message", "font-weight").join("\n"), /font-weight: var\(--fw-regular\)/, "…and its weight");
  assert.match(messageView, /fontSize: "calc\(11px \+ var\(--chat-font-size-offset, 0px\)\)"/, "the thinking card keeps the size this rule is measured against");
});

test("a collapsed thinking's first line ends with the three marks, and its glyph lines up with the clock (pic: the lightbulb row)", () => {
  assert.match(declared(".message-assistant .thinking-card", "padding-left").join("\n"), /padding-left: 0 !important/, "the lightbulb stands on the row's left edge, under the clock above it");
  assert.ok(messageView.includes('className="thinking-card"'), "the thinking card carries the class the rule needs");
  assert.match(declared(".thinking-preview", "text-overflow").join("\n"), /text-overflow: clip/, "no single ellipsis character: the cut is named by the marks");
  assert.match(cssNoComments, /\.thinking-preview\[data-clipped="true"\]::after\s*\{[^}]*content: "•••"/, "the marks are painted over the cut");
  // The marks are painted over the line, so they must carry the surface behind them.
  // A collapsed thought is usually inside the turn's Process details group, whose plate
  // is a translucent mix; the page's colour there would cut a light rectangle into it.
  assert.match(declared(".thinking-preview[data-clipped=\"true\"]::after", "background").join("\n"), /background: var\(--thinking-cut-surface/, "the marks carry the surface they sit on, as a token");
  assert.match(declared(".thinking-card", "--thinking-cut-surface").join("\n"), /--thinking-cut-surface: var\(--bg\)/, "on the page, that surface is the page");
  assert.match(
    declared(".process-details-content .thinking-card", "--thinking-cut-surface").join("\n"),
    /--thinking-cut-surface: color-mix\(in srgb, var\(--surface\) 34%, var\(--bg\)\)/,
    "inside the Process details plate, it is that plate flattened against the page",
  );
  assert.match(declared(".process-details-content", "background").join("\n"), /background: color-mix\(in srgb, var\(--surface\) 34%, transparent\)/, "…which is the plate's own mix, made opaque");
  assert.match(messageView, /export const THINKING_MORE_MARKER = "•••"/, "the same three marks in the component, for a line that ends before the box");
  assert.ok(messageView.includes('className="thinking-preview"') && messageView.includes("data-clipped="), "the preview span carries the class and the clipped state");
  assert.ok(messageView.includes("useIsTextClipped"), "the clipped state is measured, not guessed");
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

  // "Branch in new chat" under every tool call is a phone's column of identical buttons.
  assert.match(messageView, /className="message-assistant-action message-branch-action"/, "the chip is addressable by name");
  const hidden = cssNoComments.match(/@media \(max-width: 640px\)\s*\{[^}]*\.message-branch-action\s*\{[^}]*display: none !important/g);
  assert.ok(hidden, "on a phone's width the chip is not drawn, and the rule is strong enough to beat the chip's inline display: flex");
  assert.ok(!/\.message-copy-action\s*\{[^}]*display: none/.test(cssNoComments), "Copy is not taken with it");
});
