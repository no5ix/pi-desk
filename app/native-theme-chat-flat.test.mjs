import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// app/native-theme.css is the fork's stylesheet; globals.css/settings.css are
// upstream's and stay byte-identical, so every flat/fill rule has to live here.
// A selector can be styled in several places (the fork base layer, the message
// section, the flat layer at the end), so a check reads every rule it has.
const css = readFileSync(new URL("./native-theme.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rules(selector) {
  // A rule counts when the selector is one whole term of a selector list: the text
  // before it ends a line or a comma, and the text after it is a comma (the list
  // goes on) or the brace. ".markdown-code-actions" and ".markdown-code-action.is-active"
  // are therefore not ".markdown-code-action".
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bodies = [];
  for (const match of css.matchAll(new RegExp(`(^|[,\\s])${escaped}\\s*(?=,|\\{)`, "g"))) {
    const open = css.indexOf("{", match.index + match[0].length);
    bodies.push(css.slice(open + 1, css.indexOf("}", open)));
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

test("a reply's blocks are told apart by fill, never by an outline", () => {
  // The user's screenshot: every card, fence and button in a conversation wore a
  // hairline. Each of these keeps its background and loses the border.
  for (const selector of [
    ".process-details-trigger",
    ".process-details-content",
    ".markdown-code-block",
    ".markdown-code-header",
    ".markdown-code-action",
    ".markdown-code-fold",
    ".compaction-file-details",
    ".compaction-file-list",
    ".thinking-refusal-action",
  ]) {
    for (const property of ["border", "border-top", "border-bottom", "border-left", "border-right"]) {
      for (const declaration of declared(selector, property)) {
        const value = declaration.slice(declaration.indexOf(":") + 1).replace("!important", "").trim();
        assert.ok(/^0$|^none$/.test(value), `${selector} keeps no ${property}, and it says so (${declaration})`);
      }
    }
  }
  // The collapsed process card sits on the page's own canvas, so its fill carries it.
  assert.match(declared(".process-details-trigger", "background").join("\n"), /background: var\(--bg-subtle\) !important/);
  // The compaction card's opened body wears the header's fill: one tinted note, not a strip over a bare body.
  assert.match(declared(".compaction-card-body", "background").join("\n"), /background: var\(--bg-subtle\) !important/);
  // The file list and the fold strip had a border and a fill; the fill stays.
  assert.match(declared(".compaction-file-list", "background").join("\n"), /background: var\(--bg-panel\)/);
  assert.match(declared(".markdown-code-fold", "background").join("\n"), /background: var\(--bg-panel\)/);
  assert.match(declared(".thinking-refusal-action", "background").join("\n"), /background: var\(--bg-panel\)/);
});

test("a borderless small control gets a fill, in every state", () => {
  // These controls write `background: none, border: none` inline, so they sat on
  // the canvas as bare text. The fills are the affordance now, and an inline style
  // only loses to an !important.
  for (const [rest, hover] of [
    [".message-user .message-copy-actions button", ".message-user .message-copy-actions button:hover:not(:disabled)"],
    [".message-user .user-msg-actions button", ".message-user .user-msg-actions button:hover:not(:disabled)"],
    [".message-assistant .message-copy-action", ".message-assistant .message-copy-action:hover"],
    [".message-assistant .tool-call-open", ".message-assistant .tool-call-open:hover"],
  ]) {
    assert.match(declared(rest, "background").join("\n"), /background: var\(--bg-subtle\) !important/, `${rest} is filled at rest`);
    assert.match(declared(hover, "background").join("\n"), /background: var\(--bg-selected\) !important/, `${rest} answers the pointer`);
  }
  // The code fence's chips sit on the header's tinted strip: a step off it, and an
  // accent mix while "No wrap" is on.
  assert.match(declared(".markdown-code-action", "background").join("\n"), /background: color-mix\(in srgb, var\(--bg\) 76%, var\(--text\)\) !important/);
  assert.match(declared(".markdown-code-action.is-active", "background").join("\n"), /background: color-mix\(in srgb, var\(--accent\) 26%, var\(--bg\)\) !important/);

  // The component's side of the pair: the control is outline-free and carries the
  // class the fill is keyed to, and a reply's line names no model at all.
  const view = readFileSync(new URL("../components/MessageView.tsx", import.meta.url), "utf8");
  assert.match(view, /className="tool-call-open"/, "the subagent's Open button is the one the CSS fills");
  assert.doesNotMatch(view, /getModelDisplayName/, "no reply prints a provider or a model name");
  assert.match(view, /<span title=\{t\("chat\.toolCancelled"\)\} style=\{\{[^}]*border: "none", background: "var\(--bg-selected\)"/, "a cancelled tool is a filled badge");
});

test("an upstream border is named zero, never just dropped", () => {
  // globals.css is upstream's and stays byte-identical, so it keeps drawing its own
  // hairlines. A fork rule that simply stops declaring the property leaves upstream's
  // standing — which is how the code fence's header kept its underside line after the
  // flat pass said it was gone. Wherever upstream draws one, the fork rule says 0.
  const upstream = readFileSync(new URL("./globals.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const properties = ["border", "border-top", "border-bottom", "border-left", "border-right"];
  const upstreamRules = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return Array.from(upstream.matchAll(new RegExp(`(^|[,\\s])${escaped}\\s*(?=,|\\{)`, "g")))
      .map((m) => upstream.slice(upstream.indexOf("{", m.index + m[0].length) + 1, upstream.indexOf("}", upstream.indexOf("{", m.index + m[0].length))));
  };
  const drawnByUpstream = new Map();
  for (const selector of [
    ".markdown-code-block",
    ".markdown-code-header",
    ".markdown-code-action",
    ".markdown-code-fold",
    ".compaction-file-details",
    ".compaction-file-list",
    ".compaction-card",
    ".process-details-trigger",
  ]) {
    for (const property of properties) {
      const drawn = upstreamRules(selector).some((body) => body.split(";").some((d) => {
        const [name, ...rest] = d.replace(/\s+/g, " ").trim().split(":");
        return name.trim() === property && !/^(0|none)$/.test((rest.join(":") || "").replace("!important", "").trim());
      }));
      if (drawn) drawnByUpstream.set(selector, [...(drawnByUpstream.get(selector) ?? []), property]);
    }
  }
  assert.ok(drawnByUpstream.size >= 3, `upstream does draw borders here (${[...drawnByUpstream].map(([s, p]) => `${s}:${p.join("|")}`).join(", ")})`);
  for (const [selector, list] of drawnByUpstream) {
    for (const property of list) {
      assert.ok(declared(selector, property).some((d) => /:\s*(0|none)(\s*!important)?$/.test(d)),
        `${selector} names ${property}: 0 against globals.css (${declared(selector, property).join("; ") || "nothing"})`);
    }
  }
});

test("the six heading levels read as one ink, and the hierarchy is size, weight and rule", () => {
  // The document used to colour a heading per level — six hues, twelve values —
  // which made a Markdown document look like a colour chart and put its own
  // palette next to the editor's. The palette has one heading ink (heading
  // amber), and a level is told apart by size, weight and the rule under the
  // section-opening levels. The `--heading-N` names survive as the levels' own
  // handles, all pointing at the one ink.
  for (let level = 1; level <= 6; level++) {
    assert.match(css, new RegExp(`--heading-${level}: var\\(--md-heading\\);`), `--heading-${level} is the palette's heading ink`);
    assert.match(declared(`.markdown-body h${level}`, "color").join("\n"), new RegExp(`color: var\\(--heading-${level}\\)`), `h${level} asks for its own level token`);
  }
  // One ink, in both themes, spelled once per theme.
  const inks = new Set(Array.from(css.matchAll(/--md-heading:\s*([^;]+);/g), (m) => m[1].trim()));
  assert.equal(inks.size, 2, "one heading ink per theme — the light page's and the dark page's");
  const blocks = css.match(/--heading-1: var\(--md-heading\);[\s\S]*?--heading-6: var\(--md-heading\);/g) ?? [];
  assert.equal(blocks.length, 2, "one token block for the light page, one for the dark");
  // The hierarchy is typographic: every level has a size and a weight, and in the
  // document surface the two section-opening levels wear a rule. A chat reply
  // stays flat — a reply is not a document — so the rule belongs to the preview.
  for (let level = 1; level <= 6; level++) {
    assert.ok(declared(`.markdown-body h${level}`, "font-size").length, `h${level} has a size`);
    assert.ok(declared(`.markdown-body h${level}`, "font-weight").length, `h${level} has a weight`);
  }
  for (const level of [1, 2]) {
    const borders = declared(`.markdown-file-preview h${level}`, "border-bottom");
    assert.ok(borders.some((d) => /solid var\(--md-rule\)/.test(d)), `the document's h${level} opens its section with the palette's rule`);
  }
  // The small levels step down from the ink's own size, so a deep heading is not
  // the body text with a colour on it.
  const sizes = [1, 2, 3, 4, 5, 6].map((level) => declared(`.markdown-body h${level}`, "font-size").join(" "));
  assert.ok(sizes.every((s) => /\dem\b|\d+%|calc\(/.test(s)), "levels step by size, not by hue");
});
