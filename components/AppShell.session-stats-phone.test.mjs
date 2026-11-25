import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// The Session stats card on a phone (components/AppShell.tsx). The user's screenshot:
// a 390px screen, a card with a horizontal scrollbar, and the tail of
// `splash/ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF:…` off the right edge.
// A grid track cannot shrink below the content's min-content, and one long model id
// in a `nowrap` label was that content.
const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

test("the stacked card is one column that can shrink to the screen", () => {
  const stacked = shell.match(/gridTemplateColumns: isMobile \|\| topPanelPos\.width < SESSION_STATS_STACK_WIDTH[\s\S]{0,500}?\? "([^"]*)"/);
  assert.ok(stacked, "the card picks one column when it is stacked");
  assert.equal(stacked[1], "minmax(0, 1fr)", "`1fr` alone is minmax(auto, 1fr): its floor is the content, so a long id widened the card");
});

test("a phone reads the stats one line per thing", () => {
  // `Session File` on its own line, the whole path under it with room to wrap; the
  // two-column layout gave the label's track the width the path needed.
  assert.match(shell, /gridTemplateColumns: isMobile \? "minmax\(0, 1fr\)" : "auto minmax\(0, 1fr\)"/,
    "the field rows stack on a phone, side by side on a desktop");
  const rows = shell.slice(shell.indexOf("const section = ("), shell.indexOf("const copyTitleKey"));
  assert.match(rows, /gridTemplateColumns: compact\s*\n?\s*\? "max-content max-content"\s*\n?\s*: isMobile \? "minmax\(0, 1fr\)" : "auto minmax\(0, 1fr\)"/,
    "a cost row stacks too, while the compact numeric columns stay tight");
  // The label is the model id in a cost row: it breaks instead of running off.
  assert.match(rows, /whiteSpace: compact \? "nowrap" : "normal",/);
  assert.match(rows, /overflowWrap: compact \? "normal" : "anywhere"/);
  assert.match(rows, /wordBreak: compact \? "normal" : "break-word"/);
});

test("the card is a vertical scroller, and says so", () => {
  // Two rules style it: the grouped one that carries the padding, and the card's own
  // with the height and the axes. Read them all.
  const bodies = Array.from(css.matchAll(/(^|[,\s])\.session-stats-body\s*(?=,|\{)/g))
    .map((m) => css.slice(css.indexOf("{", m.index + m[0].length) + 1, css.indexOf("}", css.indexOf("{", m.index + m[0].length))));
  assert.ok(bodies.length >= 2, `the card's body has its rules (${bodies.length})`);
  const all = bodies.join(";");
  assert.match(all, /overflow-y: auto/);
  assert.match(all, /overflow-x: hidden/, "with overflow-y: auto the other axis is a scrollbar too, and it is the one the phone showed");
  assert.match(all, /max-height: min\(66dvh, 620px\)/, "it scrolls vertically because it is capped in height");
});
