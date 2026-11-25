import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Two phone fixes, both in the fork's own sheet (app/native-theme.css; globals.css
// and settings.css are upstream's and stay byte-identical):
//
//  1. A long numbered prompt. The flat pass gave every list a flat 24px of left
//     padding, and an ordered list draws its number in that padding, to the left of
//     the item's text. A prompt is a bubble whose collapsed box clips horizontally,
//     so `10.`, `11.`, `12.` arrived on the phone as `0.`, `1.`, `2.`: the leading
//     digit sat outside the box and was gone. The prompt's ordered lists therefore
//     size the room from globals.css's `--ol-marker-digits`, while the assistant's
//     lists — which sit in no clipping box — keep the flat padding.
//  2. The Tasks calendar's "Today". It was a hairline ring filled with the page's
//     own colour, so on a phone the outline was the whole affordance. It is a chip
//     now: `--bg-subtle` at rest, `--bg-selected` under the pointer, no border.

const cssSource = readFileSync(new URL("./native-theme.css", import.meta.url), "utf8");
const css = cssSource.replace(/\/\*[\s\S]*?\*\//g, "");
const messageView = readFileSync(new URL("../components/MessageView.tsx", import.meta.url), "utf8");
const taskCalendar = readFileSync(new URL("../components/tasks/TaskCalendar.tsx", import.meta.url), "utf8");

function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out = [];
  for (const match of css.matchAll(new RegExp(`(^|[,\\s])${escaped}\\s*(?=,|\\{)`, "g"))) {
    const open = css.indexOf("{", match.index + match[0].length);
    assert.ok(open > 0, `${selector} has a rule`);
    out.push(...css.slice(open + 1, css.indexOf("}", open)).split(";").map((d) => d.replace(/\s+/g, " ").trim()).filter(Boolean));
  }
  assert.ok(out.length > 0, `${selector} declares something`);
  return out;
}
function declared(selector, property) {
  return declarations(selector).filter((d) => d.split(":")[0].trim() === property);
}
function value(selector, property) {
  const hits = declared(selector, property);
  assert.ok(hits.length > 0, `${selector} declares ${property}`);
  return hits.at(-1).slice(hits.at(-1).indexOf(":") + 1).trim();
}

test("a prompt's ordered list keeps room for a two-digit number", () => {
  // The room is an em calc that follows the digit count, so it scales with the chat's
  // font size instead of being a pixel guess.
  const padding = value(".markdown-user-message ol", "padding-left");
  assert.match(padding, /^calc\(([\d.]+)em \+ var\(--ol-marker-digits\) \* ([\d.]+)em\)$/,
    `the marker room grows with the digit count (${padding})`);
  const [, base, perDigit] = /^calc\(([\d.]+)em \+ var\(--ol-marker-digits\) \* ([\d.]+)em\)$/.exec(padding);
  assert.equal(value(".markdown-user-message ol", "--ol-marker-digits"), "2",
    "the digit count the room is sized for; globals.css defaults to the same");
  const digits = Number(value(".markdown-user-message ol", "--ol-marker-digits"));

  // What a `12.` marker needs, in em, at the prompt's own size: two digits (~0.55em
  // each in the UI font), the period (~0.25em), the marker gap (~0.35em) — plus the
  // item's own left padding, which the flat layer sets to 3px.
  const markerEm = digits * 0.55 + 0.25 + 0.35;
  for (const fontSize of [13, 15]) {
    const room = (Number(base) + digits * Number(perDigit)) * fontSize;
    const needed = markerEm * fontSize + 3;
    assert.ok(room >= needed, `${fontSize}px prompt: ${room.toFixed(1)}px of room for a ${digits}-digit marker needs ${needed.toFixed(1)}px`);
    // The old flat padding is what cut it: the same marker does not fit in it.
    assert.ok(24 < needed, `the flat 24px is short of ${needed.toFixed(1)}px — that is the cut`);
  }

  // The fix is scoped to the prompt: the assistant's lists keep the flat padding, and
  // the prompt rule wins by coming after it (both selectors weigh the same).
  const flat = declared(".markdown-body ol", "padding-left").join("|");
  assert.match(flat, /padding-left: 24px/, "the shared list padding stays flat");
  const flatAt = css.indexOf(".markdown-body ul, .markdown-body ol {");
  const promptAt = css.indexOf(".markdown-user-message ol {");
  assert.ok(flatAt > 0 && promptAt > flatAt, "the prompt's rule comes after the flat one, so it wins");

  // The rule is only needed because the collapsed prompt box clips horizontally.
  assert.match(messageView, /maxHeight: USER_TEXT_COLLAPSE_HEIGHT,[\s\S]*?overflowX: "hidden"/,
    "the collapsed prompt clips horizontally, so a marker in the padding loses its digit");
  assert.match(messageView, /className="markdown-user-message"/, "the prompt's markdown carries the class the rule targets");
});

test("the calendar's Today pill is a filled chip, not a ring on the page", () => {
  for (const property of ["border", "border-top", "border-bottom", "border-left", "border-right"]) {
    for (const declaration of declared(".task-cal-today", property)) {
      const v = declaration.slice(declaration.indexOf(":") + 1).replace("!important", "").trim();
      assert.ok(/^0$|^none$/.test(v), `.task-cal-today keeps no ${property} (${declaration})`);
    }
  }
  assert.equal(value(".task-cal-today", "background"), "var(--bg-subtle)",
    "a step off the page at rest, like every other chip in the app");
  assert.equal(value(".task-cal-today:hover", "background"), "var(--bg-selected)",
    "a step deeper under the pointer (the flat layer's chip pairing)");
  assert.equal(value(".task-cal-today", "border-radius"), "999px", "the pill shape is kept");

  // Both themes fill it: the tokens are translucent, so they read on the page's own
  // colour in the light theme and in the dark one.
  for (const token of ["--bg-subtle", "--bg-selected"]) {
    const defs = [...cssSource.matchAll(new RegExp(`^\\s*${token}: (rgba?\\([^)]*\\))`, "gm"))].map((m) => m[1]);
    assert.ok(defs.length >= 2, `${token} is defined for the light and the dark theme`);
    assert.ok(defs.every((v) => v.startsWith("rgba(")), `${token} is translucent, so it is a step off the page, never the page`);
  }

  assert.match(taskCalendar, /className="task-cal-today"/, "the calendar's Today button carries the class");
});
