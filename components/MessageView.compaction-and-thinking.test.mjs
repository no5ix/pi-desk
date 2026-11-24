import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { getLocalePlugin, getSupportedLocales } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

// Two cards that used to open by shouting their whole text:
//  · the compaction / branch-summary card opens collapsed, and its header is the toggle;
//  · a thinking card inside a turn's Process details opens collapsed even when the
//    "expand thinking by default" preference is on.

const messageView = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the compaction card is collapsed when a session opens, and its header toggles it", () => {
  const card = messageView.match(/function CompactionMessageView\([\s\S]*?\n\}/)[0];
  assert.match(card, /const \[expanded, setExpanded\] = useState\(false\);/, "collapsed by default");
  assert.match(card, /<button\s+type="button"\s+className="compaction-card-header"\s+aria-expanded=\{expanded\}/,
    "the header row is a real button, so it is reachable by keyboard and screen reader");
  assert.match(card, /onClick=\{\(\) => setExpanded\(\(value\) => !value\)\}/);
  assert.match(card, /title=\{t\(expanded \? "chat\.collapseCompaction" : "chat\.expandCompaction"\)\}/);
  assert.match(card, /className="compaction-card-chevron"\s+data-expanded=\{expanded \? "true" : "false"\}/);
  assert.match(card, /\{expanded && \(\s*<div style=\{\{ padding: "11px 13px 12px" \}\}>/,
    "the body, the summary and the file lists are what collapses");
  assert.match(card, /\{kind === "branch_summary" \? "branch summary" : "compaction"\}/,
    "the label and the time stay visible while it is closed");
  assert.match(css, /\.compaction-card-header:hover \{\s*background: var\(--bg-hover\);/);
  assert.match(css, /\.compaction-card-header:focus-visible \{/);
  assert.match(css, /\.compaction-card-chevron\[data-expanded="true"\] \{\s*transform: rotate\(90deg\);/);
});

test("a thinking card inside Process details starts collapsed; the preference rules outside it", () => {
  assert.ok(existsSync(new URL("./process-details-context.ts", import.meta.url)), "one new fork file, not a prop chain through upstream signatures");
  const context = readFileSync(new URL("./process-details-context.ts", import.meta.url), "utf8");
  assert.match(context, /export const ProcessDetailsContext = createContext\(false\);/);
  assert.match(messageView, /import \{ ProcessDetailsContext \} from "\.\/process-details-context";/);
  const thinking = messageView.match(/export function ThinkingBlock\([\s\S]*?\n\}\n/)[0];
  assert.match(thinking, /const insideProcessDetails = useContext\(ProcessDetailsContext\);/);
  // One rule decides both the initial state and a preference change. The newest
  // thinking of the conversation opens whatever the switch says — see
  // components/MessageView.latest-thinking.test.mjs.
  assert.match(thinking, /const expandedByRule = \(\) => expandByDefault \|\| \(isThinkingExpandedByDefault\(\) && !insideProcessDetails\);/);
  assert.match(thinking, /const \[expanded, setExpanded\] = useState\(expandedByRule\);/);
  assert.match(thinking, /const onChange = \(\) => setExpanded\(expandedByRule\(\)\);/,
    "flipping the preference in Settings keeps a group's cards collapsed");
  assert.match(thinking, /return \(\) => window\.removeEventListener\(THINKING_EXPANDED_EVENT, onChange\);\n(.*\n)?  \}, \[insideProcessDetails, expandByDefault\]\);/,
    "the listener's deps carry both inputs of the rule (`expandedByRule` is rebuilt every render, so the call itself is not a dep)");
  const group = chatWindow.match(/function ProcessDetailsGroup\([\s\S]*?\n\}/)[0];
  assert.match(group, /<ProcessDetailsContext\.Provider value=\{true\}>\s*\{children\}\s*<\/ProcessDetailsContext\.Provider>/,
    "the flag travels with the group, so a thinking message on its own keeps the preference");
});

test("every locale can open and close the compaction summary", () => {
  for (const locale of getSupportedLocales()) {
    const messages = getLocalePlugin(locale).messages;
    assert.ok(messages["chat.expandCompaction"], `${locale} has chat.expandCompaction`);
    assert.ok(messages["chat.collapseCompaction"], `${locale} has chat.collapseCompaction`);
  }
});
