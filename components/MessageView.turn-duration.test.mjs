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

test("the value travels to the footer of the reply that shows a timestamp", () => {
  assert.match(chatWindow, /turnDurationMs=\{showTimestamp \? turnDurationByIndex\.get\(idx\) : undefined\}/,
    "the footer timestamp and the duration belong to the same reply, and streaming shows neither");
  assert.match(messageView, /turnDurationMs\?: number;/, "the prop is optional: the streaming bubble and the side-chat renders pass nothing");
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
  assert.match(footer[0], /\{formatDurationHms\(turnDurationMs\)\}/);
  assert.match(footer[0], /title=\{t\("chat\.turnDurationHint", \{ duration: formatDurationHms\(turnDurationMs\) \}\)\}/);
  assert.match(messageView, /turnDurationMs !== undefined && !isStreaming &&/, "never while the reply streams");
});

test("the duration is the notification's shape, in dim monospace", () => {
  assert.match(messageView, /import \{ formatDurationHms \} from "@\/lib\/completion-notification";/,
    "the same 0h31m10s the completion notification sends, not the spaced `3m 5s` of Process details");
  assert.match(css, /\.message-turn-duration \{[\s\S]*?font-family: var\(--font-mono\);[\s\S]*?\}/);
});

test("every locale can say how long the task lasted", () => {
  for (const locale of getSupportedLocales()) {
    const text = getLocalePlugin(locale).messages["chat.turnDurationHint"];
    assert.equal(typeof text, "string", `${locale} has chat.turnDurationHint`);
    assert.ok(text.includes("{duration}"), `${locale} keeps {duration}`);
  }
});
