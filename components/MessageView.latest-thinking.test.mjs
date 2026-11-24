import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

/**
 * The newest thinking block stays open.
 *
 * The "Expand thinking blocks by default" switch decides the initial state of
 * every thinking card, and a card inside a turn's Process details opens collapsed
 * even when the switch is on. Both rules left the *reasoning of the answer on
 * screen* folded: the user reads the reply and never sees how it got there. The
 * conversation's last thinking block is open whatever the switch says; every older
 * one follows the switch, and a manual collapse is kept for the session.
 */

test("the newest thinking opens by rule, the rest by preference", async () => {
  const view = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
  const rule = view.match(/const expandedByRule = \(\) => ([^;]+);/);
  assert.ok(rule, "one rule decides the initial state and the preference changes");
  assert.match(rule[1], /expandByDefault \|\| \(isThinkingExpandedByDefault\(\) && !insideProcessDetails\)/,
    "the newest block wins over the switch and over the Process-details fold");
  assert.match(view, /const \[expanded, setExpanded\] = useState\(expandedByRule\);/);
  assert.match(view, /const onChange = \(\) => setExpanded\(expandedByRule\(\)\);/,
    "a preference change re-applies the same rule, so the newest block does not collapse");
  assert.match(view, /\}, \[insideProcessDetails, expandByDefault\]\);/, "the listener follows the block's own rule");
});

test("the last thinking block of the newest reply is the one that opens", async () => {
  const view = await readFile(new URL("./MessageView.tsx", import.meta.url), "utf8");
  const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(view, /const lastThinkingOrderIndex = useMemo\(\(\) => \{\s*for \(let index = blockItems\.length - 1; index >= 0; index -= 1\) \{\s*if \(blockItems\[index\]\.block\.type === "thinking"\) return index;/,
    "the newest thinking of the reply, not the first");
  assert.match(view, /expandByDefault=\{expandLatestThinking && orderIndex === lastThinkingOrderIndex\}/);
  assert.match(view, /if \(block\.type === "thinking"\) \{\s*return <ThinkingBlock[\s\S]*?expandByDefault=\{expandByDefault\}/);
  // The owner decides which reply is the newest, and yields to a live reply.
  assert.match(chat, /expandLatestThinking=\{!streamState\.isStreaming && idx === lastAssistantIndex\}/);
  assert.match(chat, /<MessageView message=\{streamState\.streamingMessage[\s\S]*?expandLatestThinking \/>/,
    "a streaming reply's last thinking block is the conversation's newest");
  assert.match(chat, /if \(messages\[index\]\.role === "assistant"\) return index;/, "the newest assistant reply");
});
