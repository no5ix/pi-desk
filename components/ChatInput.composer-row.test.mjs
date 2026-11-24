import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
// The composer's session row (project, model, context ring, controls) must fit
// the width it is given on a phone and in a squeezed desktop window (the open
// workspace panel). It used to be a three-column grid whose first column was
// `auto`: a phone renders only two children there, so the controls block landed
// in the 1fr track while the model chip's untruncated max-content widened the
// first column. The "More controls" button (16px in a zero-width track) then
// painted on top of the context-usage ring, and on a desktop the model chip's
// fixed 220px box overflowed its own shrunken root onto the ring.
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const modelSource = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");
const ringSource = await readFile(new URL("./ContextUsageRing.tsx", import.meta.url), "utf8");
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

test("the left cell can shrink and the ring keeps its box", () => {
  assert.ok(leftCell, "the left cell is one styled div");
  assert.match(leftCell[0], /flex: isNarrow \? "1 1 auto" : "0 1 auto"/, "it shrinks in both tiers, so the chips truncate instead of pushing the controls out");
  assert.match(leftCell[0], /minWidth: 0/, "min-width:auto would stop it at the model name's content size");
  assert.match(leftCell[0], /<ContextUsageRing/, "the context ring lives in this cell");
  assert.match(ringSource, /width: 32, height: 32, padding: 0, flexShrink: 0/, "the ring is never squeezed below its button");
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
