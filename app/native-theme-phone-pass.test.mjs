import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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
