import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");
const upstreamCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const lib = await readFile(new URL("../lib/chat-lazy-load.ts", import.meta.url), "utf8");

function block(open, start = source.indexOf(open)) {
  const end = source.indexOf("\n  }, [", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

test("an older page is prepended with the row the viewport stands on, recorded first", () => {
  const sentinel = block("  // IntersectionObserver on the sentinel div at the top of the message list.");
  const capture = sentinel.indexOf("captureScrollAnchor(container);");
  const fetch = sentinel.indexOf("loadContext(sid, activeLeafId, oldestId)");
  assert.notEqual(capture, -1, "the prepend must record the anchor row");
  assert.notEqual(fetch, -1);
  assert.ok(capture < fetch, "the anchor is the view before the page arrives: recording it after the fetch measures the moved viewport");
  // The distance is kept as the fallback for a window with no rendered rows.
  assert.match(sentinel, /prevScrollDistanceRef\.current = captureScrollDistance/);
});

test("the re-attach is a layout effect, and the row beats the saved distance", () => {
  const restore = block("  // After visibleCount increases (more messages prepended), put the viewport");
  assert.match(source, /useLayoutEffect\(\(\) => \{\n    const container = scrollContainerRef\.current;\n    if \(!container\) return;\n    if \(scrollAnchorRef\.current\) \{\n      applyScrollAnchor\(container\);\n      return;\n    \}/,
    "the corrected offset has to be the first one the browser paints, and the row the user is reading outranks a scrollHeight arithmetic");
  assert.match(restore, /restoreScrollTop\(container\.scrollHeight, prevScrollDistanceRef\.current\)/,
    "the distance path stays for a window whose rows are all off-screen");
});

test("content that grows above the anchor is absorbed, and the user's own scroll cancels it", () => {
  // Deferred code highlighting, an image's intrinsic size, a Mermaid render: each
  // grows the content above the anchor after the prepend, so the anchor is
  // re-applied for a window keyed to the content box.
  assert.match(source, /new ResizeObserver\(\(\) => applyScrollAnchor\(container\)\)/);
  assert.match(source, /observer\.observe\(content\)/);
  assert.match(lib, /export const CHAT_SCROLL_ANCHOR_WINDOW_MS = 1500;/,
    "the window is bounded, and sized past the second mark: a 600ms window left 90px of drift on a page whose content grew late");
  assert.match(source, /if \(Date\.now\(\) > anchor\.until\) \{\n      scrollAnchorRef\.current = null;/,
    "the anchor expires on its own, not only when the observer's timer runs");
  const openTag = source.indexOf('className="chat-scroll-container');
  const container = source.slice(openTag, source.indexOf("<div style={{ minWidth: 0, padding:", openTag));
  for (const event of ["onWheel", "onTouchStart", "onKeyDown"]) {
    assert.ok(container.includes(`${event}={cancelScrollAnchor}`), `${event} must drop the anchor: a scroll the user started outranks a restore`);
  }
});

test("the browser's own anchoring is off, so one mechanism owns the position", () => {
  const rule = css.match(/\.chat-scroll-container \{([^}]*)\}/);
  assert.ok(rule, "the chat scroller has no fork rule");
  assert.match(rule[1], /overflow-anchor:\s*none;/,
    "with `auto` the browser anchors the same prepend and the two mechanisms stack");
  // The composer floats over this scrollport, and the live `Waiting for model…` /
  // `Compacting…` line is the transcript's last row: without room at the tail it is painted
  // inside the card's 32px fade and its shadow, which is where the user read it.
  assert.match(rule[1], /padding-bottom:\s*3[0-9]px;/,
    "the transcript's tail clears the composer's fade and shadow, and the padding only exists at the tail");
  assert.ok(!/overflow-anchor/.test(upstreamCss),
    "app/globals.css is upstream-owned: this rule belongs to the fork's stylesheet");
});

test("a session switch drops the previous session's anchor", () => {
  const reset = source.slice(source.indexOf("if (lazyLoadSessionKey !== appliedLazyLoadSessionKey) {"), source.indexOf("const searchMessage = messages["));
  assert.match(reset, /scrollAnchorRef\.current = null;/,
    "a leftover anchor would steer the next session's first paint");
  assert.match(reset, /prevScrollDistanceRef\.current = null;/);
});

test("an app-driven jump owns the viewport, and ends the prepend's anchor", () => {
  // Restoring a saved position, jumping to a search hit, or landing at the tail
  // are the app moving the view on purpose. An anchor still re-attaching would
  // pull the reader back to the older page and fight the jump.
  const restore = block("  useLayoutEffect(() => {\n    const position = pendingScrollRestore;");
  assert.ok(restore.indexOf("scrollAnchorRef.current = null;") < restore.indexOf("scrollToMessage(element, position.anchorOffset)"));
  assert.ok(restore.indexOf("scrollAnchorRef.current = null;") < restore.indexOf('scrollToBottom("instant")'));
  const search = block("  useLayoutEffect(() => {\n    if (!pendingSearchScroll");
  assert.ok(search.indexOf("scrollAnchorRef.current = null;") < search.indexOf("scrollToMessage(element);"));
});
