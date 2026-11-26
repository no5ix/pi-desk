import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * "Sometimes, clicking Expand or Collapse sends the page to the bottom."
 *
 * A row that grows the page does it under the finger: a bubble opening mid-conversation
 * jumped out of the viewport, and a reader who happened to be at the tail handed the
 * viewport to the stream's tail-follow, which snapped the conversation to its bottom.
 * The tapped row is therefore anchored — the same mechanism the older-pages prepend
 * uses — and the toggle tells the scroll viewport before it flips its own state.
 */
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const messageView = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const lib = readFileSync(new URL("../lib/chat-lazy-load.ts", import.meta.url), "utf8");

test("the row that grows the page is anchored, not abandoned to the tail", () => {
  const handler = chatWindow.slice(
    chatWindow.indexOf("const handleContentToggle = useCallback"),
    chatWindow.indexOf("}, [applyScrollAnchor, scrollContainerRef]);") + 44,
  );
  assert.ok(handler.length > 200, "the toggle handler exists");
  // It is the tapped row that is pinned, with the anchor the prepend already uses.
  assert.match(handler, /const row = \(entryIdHint[\s\S]*?control\.closest<HTMLElement>\("\[data-entry-id\]"\)/, "the tapped row is found from the control, not from a global position");
  assert.match(handler, /scrollAnchorRef\.current = \{\s*entryId,\s*top: row\.getBoundingClientRect\(\)\.top - box\.top,\s*until: Date\.now\(\) \+ CHAT_SCROLL_ANCHOR_WINDOW_MS,\s*\}/, "the row's top is stored, with the anchor's own window");
  assert.match(lib, /export const CHAT_SCROLL_ANCHOR_WINDOW_MS = \d+;/, "the window is the shared one");
  // A control that is not on screen is not the finger's: the app must not move the page.
  assert.match(handler, /if \(controlTop < 0 \|\| controlTop > container\.clientHeight\) return;/, "an off-screen control is left alone");
  // The bubble keeps settling after the commit, so the row is put back as the height arrives.
  assert.match(handler, /requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => applyScrollAnchor\(container\)\)\);/, "applied after the commit");
  assert.match(handler, /window\.setTimeout\(\(\) => applyScrollAnchor\(container\), 200\);/, "and as the row settles");
  assert.match(handler, /window\.setTimeout\(\(\) => applyScrollAnchor\(container\), 450\);/, "and once more");
  assert.doesNotMatch(handler, /scrollIntoView/, "the handler never scrolls the page to a control: that is how the reader ends up at the tail");
});

test("every Expand/Collapse tells the viewport first, and the prop stays a stable reference", () => {
  // The toggle is announced before the row's own state flips, so the measurement of the
  // row's place is taken from the layout the reader is looking at.
  const calls = messageView.match(/onContentToggle\?\.\(event\.currentTarget\);/g) ?? [];
  assert.ok(calls.length >= 4, `a long prompt, the slash command, a compaction and a report all announce the toggle (${calls.length})`);
  for (const [needle, label] of [
    [/function CollapsibleUserText\(\{[^}]*onContentToggle/, "a long prompt's Expand/Collapse"],
    [/function CompactionMessageView\(\{[^}]*onContentToggle/, "a compaction note's header"],
    [/function CustomMessageView\(\{[^}]*onContentToggle/, "a subagent report's header"],
    [/function UserMessageView\(\{[^}]*onContentToggle/, "the user bubble's own row"],
  ]) {
    assert.match(messageView, needle, label);
  }
  // The row's entry id rides with the control, so ChatWindow can pass one stable
  // callback: an inline arrow here would re-render every message on every ChatWindow
  // render, which is exactly what the memo comparator below is for.
  assert.match(messageView, /const notifyContentToggle = useCallback\(\s*\(control: HTMLElement \| null\) => \{ onContentToggle\?\.\(control, entryId\); \},\s*\[onContentToggle, entryId\],\s*\);/, "the row's entry id is bound once per row");
  assert.match(messageView, /&& prev\.onContentToggle === next\.onContentToggle;/, "the memo comparator knows the prop");
  assert.match(chatWindow, /onContentToggle=\{handleContentToggle\}/, "ChatWindow hands the stable callback, not a per-render arrow");
});
