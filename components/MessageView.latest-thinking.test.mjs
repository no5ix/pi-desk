import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * One thinking card is open at a time: the newest one.
 *
 * "Expand thinking blocks by default" used to decide the initial state of *every*
 * thinking card, and the newest-block rule sat on top of that — so a conversation
 * that has run for an hour opened as a wall of folded-away reasoning, and the one
 * block the user is reading was lost in it. The rule now is a position: A is open
 * while it streams, stays open when it ends with nothing after it, and closes
 * itself the moment B starts. The switch reaches the reply being read, not the
 * file's history, and a card the user opened by hand is never moved.
 */

const load = async (rel) => (await readFile(new URL(rel, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("one rule decides the state, and it is a position in the conversation", async () => {
  const view = await load("./MessageView.tsx");
  const rule = view.match(/const expandedByRule = \(\) =>\s*([^;]+);/);
  assert.ok(rule, "one rule decides the initial state and every later change");
  assert.match(rule[1], /expandByDefault \|\| \(latestReply && isThinkingExpandedByDefault\(\) && !insideProcessDetails\)/,
    "the newest block opens whatever the switch says; the switch only reaches the newest reply, and never the Process-details fold");
  assert.match(view, /const \[expanded, setExpanded\] = useState\(expandedByRule\);/);
  assert.match(view, /const touchedRef = useRef\(false\);/, "a manual click is recorded");
  assert.match(view, /onClick=\{\(\) => \{\s*(?:\/\/[^\n]*\n\s*)*touchedRef\.current = true;\s*setExpanded\(\(v\) => !v\);\s*\}\}/,
    "and the rule stops moving that card");
});

test("A closes itself when B starts, and a preference change respects the click", async () => {
  const view = await load("./MessageView.tsx");
  assert.match(view, /useEffect\(\(\) => \{\s*if \(!touchedRef\.current\) setExpanded\(expandedByRule\(\)\);\s*(?:\/\/[^\n]*\n\s*)?\}, \[expandByDefault, latestReply, insideProcessDetails\]\);/,
    "A stops being the newest the moment B appears, and closes — unless the user opened it");
  assert.match(view, /const onChange = \(\) => \{\s*if \(!touchedRef\.current\) setExpanded\(expandedByRule\(\)\);\s*\};/,
    "the switch re-applies the same rule, respecting a card the user touched");
  assert.match(view, /\}, \[insideProcessDetails, expandByDefault, latestReply\]\);/,
    "the listener re-runs when this reply stops being the newest");
});

test("the last thinking block of the newest reply is the one that opens", async () => {
  const view = await load("./MessageView.tsx");
  const chat = await load("./ChatWindow.tsx");
  assert.match(view, /const lastThinkingOrderIndex = useMemo\(\(\) => \{\s*for \(let index = blockItems\.length - 1; index >= 0; index -= 1\) \{\s*if \(blockItems\[index\]\.block\.type === "thinking"\) return index;/,
    "the newest thinking of the reply, not the first");
  assert.match(view, /expandByDefault=\{expandLatestThinking && orderIndex === lastThinkingOrderIndex\} latestReply=\{expandLatestThinking\}/,
    "one block is the newest; the whole reply is the newest, and the switch reads the second");
  assert.match(view, /if \(block\.type === "thinking"\) \{\s*return <ThinkingBlock[\s\S]*?expandByDefault=\{expandByDefault\} latestReply=\{latestReply\}/);
  // The owner decides which reply is the newest, and yields to a live reply.
  assert.match(chat, /expandLatestThinking=\{!streamState\.isStreaming && idx === lastAssistantIndex\}/);
  assert.match(chat, /<MessageView message=\{streamState\.streamingMessage[\s\S]*?expandLatestThinking \/>/,
    "a streaming reply's last thinking block is the conversation's newest");
  assert.match(chat, /if \(messages\[index\]\.role === "assistant"\) return index;/, "the newest assistant reply");
});
