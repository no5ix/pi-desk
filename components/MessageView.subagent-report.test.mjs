import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

// A background subagent's report is a `pi-web:subagent-notification` custom
// message. Three rules live here:
//   1. It opens collapsed, like the compaction note (pic: `> compaction  01:22 PM`):
//      a finished session, or a run that just finished, opens on its conversation
//      and not on the wall of text the main agent has already read. The header is
//      the toggle, so one click expands it.
//   2. Every assistant reply's model line carries the reply's time, so a subagent's
//      run read in Process details is dated line by line.
//   3. The turn's length beside Copy counts the subagent's run: the report is the
//      task working, not an idle wait (lib/turn-duration.ts keeps that arithmetic).

const { getLocalePlugin, getSupportedLocales } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

const messageView = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const card = messageView.slice(
  messageView.indexOf("function CustomMessageView"),
  messageView.indexOf("function getMessageText"),
);
assert.ok(card.length > 500, "the custom-message card is in MessageView");

test("a subagent report is collapsed by default, and its header is the toggle", () => {
  assert.match(card, /const collapsesByDefault = message\.customType === "pi-web:subagent-notification"/,
    "the report type is what decides, not the message's `display` flag");
  assert.match(card, /const \[contentExpanded, setContentExpanded\] = useState\(!isHiddenDisplay && !collapsesByDefault\);/,
    "it starts folded; an ordinary extension message starts open, as it always did");
  assert.match(card, /className="custom-message-header"/);
  assert.match(card, /aria-expanded=\{contentExpanded\}/, "the header says what it opens");
  assert.match(card, /onClick=\{\(\) => setContentExpanded\(\(value\) => !value\)\}/, "and one click toggles it");
  assert.match(card, /className="compaction-card-chevron"\s*\n\s*data-expanded=\{contentExpanded \? "true" : "false"\}/,
    "the same chevron the compaction card turns, so the two collapsed notes read alike");
  assert.doesNotMatch(card, /borderBottom: contentExpanded/,
    "no divider under the header, folded or open: the header and the body read as one flat card");
  assert.match(card, /title=\{t\(contentExpanded \? "chat\.collapseSubagentReport" : "chat\.expandSubagentReport"\)\}/);
  // Folded, the card is its header alone: no body, no Copy row.
  assert.match(card, /\{contentExpanded \? \(\s*<div style=\{\{ padding: "6px 9px" \}\}>[\s\S]*?\) : isHiddenDisplay \? \(/,
    "the collapsed preview line stays what it was for a hidden extension message, and a folded report shows nothing");
  assert.match(card, /A collapsed report shows nothing but its header[\s\S]*?\{\(contentExpanded \|\| !collapsesByDefault\) && \(/,
    "the Copy and details row belongs to the text it reports");
  // An extension's own custom message keeps its current shape, header included.
  const plainHeader = card.slice(card.indexOf(") : (\n        <div"), card.indexOf("</div>\n        )}"));
  assert.ok(plainHeader.length > 100, "the plain header branch is still there");
  assert.doesNotMatch(plainHeader, /onClick/, "an extension message's header stays a label, as it was");
});

test("every model line in a run is dated", () => {
  const assistant = messageView.slice(
    messageView.indexOf("function AssistantMessageView"),
    messageView.indexOf("function BlockView"),
  );
  assert.match(assistant, /const modelTime = formatTime\(message\.timestamp, locale\);/,
    "the reply's own time, not the footer's sparser `showTimestamp` rule");
  const line = assistant.slice(assistant.indexOf('className="message-assistant-model"'), assistant.indexOf("{isStreaming &&"));
  assert.doesNotMatch(line, /getModelDisplayName|modelNames/,
    "the model line carries no model info: the provider and the model stay out of the transcript");
  const timeAt = line.indexOf('className="message-assistant-model-time"');
  assert.ok(timeAt > 0, "the time keeps the line — `[clock] 11:46 PM`");
  assert.match(line, /<ClockIcon size=\{10\} \/>/);
  assert.match(css, /\.message-assistant-model-time \{[\s\S]*?font-variant-numeric: tabular-nums;/);
});

test("a folded report is labelled, not printed as its type string", () => {
  assert.match(card, /const title = collapsesByDefault[\s\S]{0,240}\? t\("chat\.subagentReportTitle"\)[\s\S]{0,80}: formatCustomType\(message\.customType\);/,
    "the row reads `subagent report`, like the compaction row reads `compaction`; the raw type stays in the message the model reads");
  assert.match(card, /\{title\}/, "the label is what the header shows");
  for (const locale of getSupportedLocales()) {
    assert.equal(typeof getLocalePlugin(locale).messages["chat.subagentReportTitle"], "string", `${locale} has chat.subagentReportTitle`);
  }
});

test("the words are in every locale", () => {
  for (const locale of getSupportedLocales()) {
    for (const key of ["chat.expandSubagentReport", "chat.collapseSubagentReport"]) {
      assert.equal(typeof getLocalePlugin(locale).messages[key], "string", `${locale} has ${key}`);
    }
  }
});

test("the collapsed card is styled as the compaction card is", () => {
  assert.match(css, /\.compaction-card-chevron\[data-expanded="true"\] \{\s*transform: rotate\(90deg\);/,
    "the chevron the report reuses turns when the report opens");
  assert.match(css, /\.message-turn-duration \{[\s\S]*?display: inline-flex;/,
    "the clock glyph and the duration in a footer sit on one line");
});
