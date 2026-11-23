import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const { getLocalePlugin, getSupportedLocales } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

// The finished turn's length sits in the assistant footer between Copy and the timestamp:
// `Copy 0h31m10s      Nov 21 11:46PM`. The number is computed over the message list by
// ChatWindow (getTurnDurationMs in lib/turn-duration.ts, which is not a per-message
// property) and shown only on the reply that closes the turn — the one that carries the
// footer timestamp — and never while streaming.

const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const messageView = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("ChatWindow measures the turn that each closing reply ends", () => {
  assert.match(chatWindow, /import \{ getTurnDurationMs \} from "@\/lib\/turn-duration";/);
  assert.match(chatWindow, /const turnDurationByIndex = useMemo\(\(\) => \{[\s\S]*?\}, \[messages\]\);/,
    "one pass over the messages, cached with them");
  const memo = chatWindow.match(/const turnDurationByIndex = useMemo\(\(\) => \{[\s\S]*?\}, \[messages\]\);/)[0];
  assert.match(memo, /if \(getUserInputText\(messages\[idx\]\)\) anchorIdx = idx;/, "the anchor is the user's message");
  assert.match(memo, /if \(role === "user"\) break;/, "the scan stops at the next prompt");
  assert.match(memo, /if \(role === "assistant"\) \{\s*closesTurn = false;\s*break;/, "only the closing reply of a turn gets a length");
  assert.match(memo, /const ms = getTurnDurationMs\(messages, anchorIdx, idx \+ 1\);/);
  assert.match(memo, /if \(ms !== undefined\) durations\.set\(idx, ms\);/, "an unmeasurable turn stays blank, never 0h0m0s");
});

test("the value travels to the footer of the reply that closes the turn", () => {
  assert.match(chatWindow, /turnDurationMs=\{turnDurationByIndex\.get\(idx\)\}/,
    "always beside Copy: a turn's length is shown on every finished turn, not only on the replies sparse enough to show a timestamp (streaming shows nothing, because no reply has closed the turn yet)");
  assert.match(messageView, /turnDurationMs\?: number;/, "the prop is optional: the streaming bubble and the side-chat renders pass nothing");
  assert.match(messageView, /turnDurationMs !== undefined && !isStreaming && \(/, "the footer element guards the value and streaming itself");
  const comparator = messageView.match(/\(prev, next\) => \{[\s\S]*?\n\}/)[0];
  assert.match(comparator, /&& prev\.turnDurationMs === next\.turnDurationMs;/,
    "MessageView is memoized with a hand-written comparator: an unlisted prop never updates");
});

test("the footer order is Copy, the duration, then the timestamp", () => {
  const footer = messageView.match(/<div className="message-assistant-footer"[\s\S]*?\n      <\/div>/);
  assert.ok(footer, "assistant footer found");
  const copyAt = footer[0].indexOf('className="message-copy-action"');
  const durationAt = footer[0].indexOf('className="message-turn-duration"');
  const timeAt = footer[0].indexOf('className="message-meta"');
  assert.ok(copyAt > 0 && durationAt > 0 && timeAt > 0, "all three controls render");
  assert.ok(copyAt < durationAt && durationAt < timeAt, "Copy, duration, timestamp — the two existing controls keep their places");
  assert.match(footer[0], /marginLeft: "auto"/, "the timestamp stays pinned to the right edge");
  assert.match(footer[0], /\{formatTurnDurationCompact\(turnDurationMs\)\}/,
    "the compact `1h50m`: the footer is read at a glance, and a task's hours and minutes are the whole story");
  assert.match(footer[0], /<ClockIcon size=\{11\} \/>/, "a clock glyph says what the number is");
  assert.match(footer[0], /title=\{t\("chat\.turnDurationHint", \{ duration: formatDurationHms\(turnDurationMs\) \}\)\}/,
    "the tooltip keeps the full `0h50m12s` the completion notification sends");
  assert.match(messageView, /turnDurationMs !== undefined && !isStreaming &&/, "never while the reply streams");
});

test("the duration is compact in the footer, in dim monospace, and exact in the tooltip", () => {
  assert.match(messageView, /import \{ formatDurationHms \} from "@\/lib\/completion-notification";/,
    "the full 0h50m12s the completion notification sends, for the tooltip");
  assert.match(messageView, /import \{ formatTurnDurationCompact \} from "@\/lib\/turn-duration";/,
    "the footer's own shape comes from the same file that measures the turn");
  assert.match(css, /\.message-turn-duration \{[\s\S]*?font-family: var\(--font-mono\);[\s\S]*?\}/);
  assert.match(css, /\.message-turn-duration \{[\s\S]*?font-variant-numeric: tabular-nums;/,
    "the digits keep their width, so the row beside Copy does not jitter");
});

test("every locale can say how long the task lasted", () => {
  for (const locale of getSupportedLocales()) {
    const text = getLocalePlugin(locale).messages["chat.turnDurationHint"];
    assert.equal(typeof text, "string", `${locale} has chat.turnDurationHint`);
    assert.ok(text.includes("{duration}"), `${locale} keeps {duration}`);
  }
});
