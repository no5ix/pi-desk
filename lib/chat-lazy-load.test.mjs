import test from "node:test";
import assert from "node:assert/strict";

async function loadSubject() {
  return import("./chat-lazy-load.ts");
}

test("shows only the last visible render items", async () => {
  const { getVisibleRenderWindow } = await loadSubject();
  assert.deepEqual(getVisibleRenderWindow(200, 50), { startIndex: 150, hasMore: true });
});

test("shows all render items when the visible count reaches the total", async () => {
  const { getVisibleRenderWindow } = await loadSubject();
  assert.deepEqual(getVisibleRenderWindow(30, 50), { startIndex: 0, hasMore: false });
  assert.deepEqual(getVisibleRenderWindow(50, 50), { startIndex: 0, hasMore: false });
  assert.deepEqual(getVisibleRenderWindow(0, 50), { startIndex: 0, hasMore: false });
});

test("continues paging when render items outnumber source messages", async () => {
  const { getNextVisibleCount, getVisibleRenderWindow } = await loadSubject();
  let visibleCount = 50;

  visibleCount = getNextVisibleCount(visibleCount);
  assert.deepEqual(getVisibleRenderWindow(120, visibleCount), { startIndex: 20, hasMore: true });

  visibleCount = getNextVisibleCount(visibleCount);
  assert.deepEqual(getVisibleRenderWindow(120, visibleCount), { startIndex: 0, hasMore: false });
});

test("restores the viewport after prepending content", async () => {
  const { captureScrollDistance, restoreScrollTop } = await loadSubject();
  const savedDistance = captureScrollDistance(2000, 500);

  assert.equal(savedDistance, 1500);
  assert.equal(restoreScrollTop(2500, savedDistance), 1000);
});

test("restores top and bottom boundary positions", async () => {
  const { captureScrollDistance, restoreScrollTop } = await loadSubject();
  assert.equal(restoreScrollTop(3000, captureScrollDistance(2000, 0)), 1000);
  assert.equal(restoreScrollTop(3000, captureScrollDistance(2000, 2000)), 3000);
});

test("treats only the real message tail as live-follow attached", async () => {
  const {
    CHAT_SCROLL_REATTACH_TOLERANCE,
    CHAT_SCROLL_TAIL_TOLERANCE,
    getLiveFollowAttached,
    isScrollAtTail,
  } = await loadSubject();

  assert.equal(CHAT_SCROLL_TAIL_TOLERANCE, 8);
  assert.equal(CHAT_SCROLL_REATTACH_TOLERANCE, 96);
  assert.deepEqual(
    [392, 391.99, 400].map((scrollTop) => isScrollAtTail(scrollTop, 600, 1000)),
    [true, false, true],
  );
  assert.equal(isScrollAtTail(0, 600, 400), true);

  // Layout growth alone must not detach a view that was already following.
  assert.equal(getLiveFollowAttached(true, 400, 400, 600, 1040), true);
  // Any upward movement outside the strict tail tolerance detaches, even inside
  // the wider downward-only reattach window.
  assert.equal(getLiveFollowAttached(true, 400, 380, 600, 1000), false);
  assert.equal(getLiveFollowAttached(false, 380, 370, 600, 1000), false);
  // A detached view stays detached until downward movement enters the reattach window.
  assert.equal(getLiveFollowAttached(false, 280, 303, 600, 1000), false);
  assert.equal(getLiveFollowAttached(false, 303, 304, 600, 1000), true);
  // Reaching the old tail still reattaches after one to four new rendered lines.
  for (const lines of [1, 2, 3, 4]) {
    assert.equal(getLiveFollowAttached(false, 380, 400, 600, 1000 + lines * 24), true);
  }
  assert.equal(getLiveFollowAttached(false, 380, 400, 600, 1120), false);
  // Streaming growth without downward user movement must not reattach.
  assert.equal(getLiveFollowAttached(false, 400, 400, 600, 1096), false);
  assert.equal(getLiveFollowAttached(false, 391, 392, 600, 1000), true);
});

test("shows the scroll-to-latest affordance only when the tail is out of reach", async () => {
  const { shouldShowScrollToLatest } = await loadSubject();

  // A view already at, or within the tail tolerance of, the live edge has
  // nothing to jump to.
  assert.equal(shouldShowScrollToLatest(400, 600, 1000), false);
  assert.equal(shouldShowScrollToLatest(392, 600, 1000), false);
  assert.equal(shouldShowScrollToLatest(391.99, 600, 1000), true);

  // No overflow means there is no tail to return to.
  assert.equal(shouldShowScrollToLatest(0, 600, 600), false);
  assert.equal(shouldShowScrollToLatest(0, 600, 400), false);

  // Scrolled up anywhere above the tolerance shows the button.
  assert.equal(shouldShowScrollToLatest(0, 600, 1000), true);
  assert.equal(shouldShowScrollToLatest(300, 600, 4000), true);
});

test("prompt anchor spacer uses the rendered content end", async () => {
  const { getPromptAnchorSpacerHeight } = await loadSubject();
  const initial = getPromptAnchorSpacerHeight(400, 700, 600);
  const afterRender = getPromptAnchorSpacerHeight(400, 700, 600);

  assert.equal(initial, 300);
  assert.equal(afterRender, initial);
});

test("prompt anchor spacer includes the viewport deficit for short conversations", async () => {
  const { getPromptAnchorSpacerHeight } = await loadSubject();
  const targetTop = 168;
  const clientHeight = 579;

  let contentHeight = 411;
  let spacerHeight = getPromptAnchorSpacerHeight(targetTop, contentHeight, clientHeight);
  assert.equal(spacerHeight, 336);
  assert.equal(contentHeight + spacerHeight - clientHeight, targetTop);

  contentHeight += 24;
  spacerHeight = getPromptAnchorSpacerHeight(targetTop, contentHeight, clientHeight);
  assert.equal(spacerHeight, 312);
  assert.equal(contentHeight + spacerHeight - clientHeight, targetTop);
});

test("prompt anchor spacer clamps at zero once content can reach the target", async () => {
  const { getPromptAnchorSpacerHeight } = await loadSubject();
  assert.equal(getPromptAnchorSpacerHeight(100, 750, 600), 0);
  assert.equal(getPromptAnchorSpacerHeight(-20, 200, 600), 0);
});

test("floating composer clearance does not push the sent message above the viewport", async () => {
  const { getPromptAnchorSpacerHeight } = await loadSubject();
  const targetTop = 400;
  const viewport = 600;
  for (const inset of [90, 148, 220]) {
    for (const contentEnd of [700, 740, 770]) {
      const spacer = getPromptAnchorSpacerHeight(targetTop, contentEnd, viewport, inset);
      const tailScrollTop = contentEnd + spacer + inset - viewport;
      assert.equal(tailScrollTop, targetTop, `composer ${inset}, content ${contentEnd}`);
    }
    const contentEnd = targetTop + viewport - inset + 40;
    assert.equal(getPromptAnchorSpacerHeight(targetTop, contentEnd, viewport, inset), 0);
    assert.equal(contentEnd + inset - viewport, targetTop + 40);
  }
});

test("prompt anchor spacer rounds fractional layout measurements up", async () => {
  const { getPromptAnchorSpacerHeight } = await loadSubject();
  assert.equal(getPromptAnchorSpacerHeight(400.25, 700, 600), 301);
});

test("streaming content consumes the prompt anchor before advancing the tail", async () => {
  const { getPromptAnchorSpacerHeight } = await loadSubject();
  const targetTop = 400;
  const clientHeight = 600;

  let contentHeight = 700;
  let spacerHeight = getPromptAnchorSpacerHeight(targetTop, contentHeight, clientHeight);
  assert.equal(spacerHeight, 300);
  assert.equal(contentHeight + spacerHeight - clientHeight, targetTop);

  contentHeight += 120;
  spacerHeight = getPromptAnchorSpacerHeight(targetTop, contentHeight, clientHeight);
  assert.equal(spacerHeight, 180);
  assert.equal(contentHeight + spacerHeight - clientHeight, targetTop);

  contentHeight += 180;
  spacerHeight = getPromptAnchorSpacerHeight(targetTop, contentHeight, clientHeight);
  assert.equal(spacerHeight, 0);
  assert.equal(contentHeight - clientHeight, targetTop);

  contentHeight += 40;
  spacerHeight = getPromptAnchorSpacerHeight(targetTop, contentHeight, clientHeight);
  assert.equal(spacerHeight, 0);
  assert.equal(contentHeight - clientHeight, targetTop + 40);
});

test("the scroll anchor is the row the viewport is standing on", async () => {
  const { pickScrollAnchor } = await loadSubject();
  // A prepend pushes every row down, so the row worth remembering is the first
  // one with a visible part — not the first row of the list, which is what the
  // prepend replaced.
  const rows = [
    { entryId: "old1", top: -900, bottom: -400 },
    { entryId: "partial", top: -120, bottom: 2 },
    { entryId: "standing", top: -40, bottom: 62 },
    { entryId: "next", top: 84, bottom: 186 },
  ];
  assert.deepEqual(pickScrollAnchor(rows, 852), { entryId: "standing", top: -40 });
  // Nothing visible at all (a window mid-flight): no anchor, so the caller keeps
  // its fallback.
  assert.equal(pickScrollAnchor([{ entryId: "far", top: 2000, bottom: 2100 }], 852), null);
  assert.equal(pickScrollAnchor([], 852), null);
});

test("the re-attach grows the offset by the prepended height, not the other way", async () => {
  const { scrollTopForAnchor } = await loadSubject();
  // The user is at the top of the window on the row 46px from the edge. A page of
  // 19,315px lands above it, so — with the offset unchanged — the row now sits
  // 19,361px from the edge. Keeping it where it was means scrolling 19,315 deeper.
  // The shipped-once sign (`saved - now`) asked for -19,315, got clamped to 0, and
  // the viewport showed the oldest loaded page: the jump the user reported.
  assert.equal(scrollTopForAnchor(0, 46 + 19315, 46, 22829, 852), 19315);
  // Mid-window, same rule.
  assert.equal(scrollTopForAnchor(5000, 100 + 1200, 100, 30000, 852), 6200);
  // Content arriving after the prepend (a highlighted reply) moves the row again;
  // re-applying adds that delta too.
  assert.equal(scrollTopForAnchor(6200, 100 + 300, 100, 30300, 852), 6500);
  // Clamped: never past the scroller's end, never negative.
  assert.equal(scrollTopForAnchor(0, 100, 100, 700, 852), 0);
  assert.equal(scrollTopForAnchor(20000, 100, 100, 20852, 852), 20000);
});

test("the loaded-history cap is a window, not the end of the reader's reach", async () => {
  const { MAX_LOADED_MESSAGES, hasEarlierAfterPrepend } = await loadSubject();
  // The rendered window follows the loaded count, so the cap is what the tab
  // keeps: rows, their DOM, their highlighted code.
  assert.equal(MAX_LOADED_MESSAGES, 600);
  assert.equal(hasEarlierAfterPrepend(50, true), true);
  // Phase 6 changed this assertion: the cap used to silence the sentinel, which
  // left a 600-row page as the whole transcript. The window slides now, so the
  // sentinel follows the server.
  assert.equal(hasEarlierAfterPrepend(MAX_LOADED_MESSAGES, true), true);
  assert.equal(hasEarlierAfterPrepend(MAX_LOADED_MESSAGES + 500, true), true);
  assert.equal(hasEarlierAfterPrepend(50, false), false, "the server's no stays a no");
});

// ── Phase 6: the loaded window is a window, not everything the session grew ──

test("the loaded cap follows the rendered window, with a floor and a navigation bound", async () => {
  const {
    loadedWindowCap,
    LOADED_WINDOW_SLACK,
    MAX_LOADED_MESSAGES,
    MAX_NAVIGATED_LOADED_MESSAGES,
  } = await loadSubject();

  // The floor: a page that renders 50 rows still keeps the 600 it agreed to.
  assert.equal(loadedWindowCap(50), MAX_LOADED_MESSAGES);
  // Past the floor, the cap is the window plus slack, so eviction can never
  // reach a row the reader is standing on.
  assert.equal(loadedWindowCap(600), 600 + LOADED_WINDOW_SLACK);
  assert.equal(loadedWindowCap(600, 600, MAX_NAVIGATED_LOADED_MESSAGES), 720);
  // A navigation may load far more than a page, and it stays bounded.
  assert.equal(loadedWindowCap(2400), MAX_NAVIGATED_LOADED_MESSAGES);
  assert.equal(loadedWindowCap(100_000), MAX_NAVIGATED_LOADED_MESSAGES,
    "a runaway window request cannot lift the cap past the navigation bound");
  assert.equal(loadedWindowCap(0), MAX_LOADED_MESSAGES);
});

test("eviction takes the head, keeps the tail, and moves the history cursor", async () => {
  const { trimLoadedWindow, loadedWindowCap } = await loadSubject();
  const rows = Array.from({ length: 700 }, (_unused, index) => ({ index }));
  const ids = rows.map((_row, index) => `entry-${index}`);

  const trimmed = trimLoadedWindow(rows, ids, { visibleCount: 50 });
  const cap = loadedWindowCap(50);
  assert.equal(trimmed.evicted, 700 - cap);
  assert.equal(trimmed.messages.length, cap);
  assert.equal(trimmed.messages[trimmed.messages.length - 1].index, 699, "the newest row stays");
  assert.equal(trimmed.messages[0].index, 700 - cap, "what goes is the oldest, and only that");
  assert.equal(trimmed.oldestEntryId, "entry-0",
    "the cursor is the fetch watermark: eviction of the head does not move it back");
  assert.equal(trimmed.entryIds.length, trimmed.messages.length, "entryIds stay parallel to messages");
  assert.equal(trimmed.entryIds[0], `entry-${700 - cap}`);
});

test("a window that fits is returned untouched, so nothing churns", async () => {
  const { trimLoadedWindow } = await loadSubject();
  const rows = Array.from({ length: 120 }, (_unused, index) => index);
  const ids = rows.map((row) => `entry-${row}`);
  const trimmed = trimLoadedWindow(rows, ids, { visibleCount: 50 });
  assert.equal(trimmed.evicted, 0);
  assert.deepEqual(trimmed.messages, rows);
  assert.equal(trimmed.oldestEntryId, "entry-0");
});

test("a row the reader navigated to is protected, and eviction stops in front of it", async () => {
  const { trimLoadedWindow, loadedWindowCap } = await loadSubject();
  const rows = Array.from({ length: 700 }, (_unused, index) => ({ index }));
  const ids = rows.map((_row, index) => `entry-${index}`);
  const cap = loadedWindowCap(50);

  // The search target sits 10 rows from the head — inside the eviction range.
  const trimmed = trimLoadedWindow(rows, ids, {
    visibleCount: 50,
    keepEntryIds: ["entry-10"],
  });
  assert.equal(trimmed.evicted, 10, "the window shrinks past its cap before it eats a protected row");
  assert.equal(trimmed.messages[0].index, 10);
  assert.ok(trimmed.messages.length > cap, "the page keeps more than the cap while a target is protected");
  assert.ok(trimmed.messages.some((row) => row.index === 10), "the row the reader asked for is on the page");

  // A protected row at the newest end costs nothing.
  const tail = trimLoadedWindow(rows, ids, { visibleCount: 50, keepEntryIds: ["entry-699"] });
  assert.equal(tail.evicted, 700 - cap);
});

test("an idle-less paging session slides the window without gaps, duplicates or a lost anchor", async () => {
  const { trimLoadedWindow, loadedWindowCap } = await loadSubject();
  const cap = loadedWindowCap(50);

  // Start at the tail of a 3000-entry session and page earlier 40 times.
  let ids = Array.from({ length: 600 }, (_unused, index) => `entry-${2400 + index}`);
  let messages = ids.map((id) => ({ id }));
  let cursor = ids[0];
  const anchor = "entry-2500";
  let oldestSeen = Number.POSITIVE_INFINITY;

  for (let round = 0; round < 40; round += 1) {
    // The app asks the server for the page before its *cursor*, not before the
    // oldest row it happens to be holding: eviction must not make it re-fetch.
    const page = Array.from({ length: 50 }, (_unused, index) => `entry-${Number(cursor.slice(6)) - 50 + index}`);
    messages = [...page.map((id) => ({ id })), ...messages];
    ids = [...page, ...ids];

    const trimmed = trimLoadedWindow(messages, ids, { visibleCount: 50, keepEntryIds: [anchor] });
    messages = trimmed.messages;
    ids = trimmed.entryIds;
    cursor = trimmed.oldestEntryId;
    assert.equal(ids.length, messages.length);
    assert.ok(messages.length <= cap + 60, `the window stays bounded: ${messages.length}`);

    // No gaps: consecutive rows are consecutive entries.
    for (let index = 1; index < ids.length; index += 1) {
      assert.equal(Number(ids[index].slice(6)), Number(ids[index - 1].slice(6)) + 1,
        `row ${index} is not the neighbour of row ${index - 1}`);
    }
    assert.equal(new Set(ids).size, ids.length, "no row appears twice");
    assert.ok(ids.includes(anchor), "the search target survives the whole walk");
    oldestSeen = Math.min(oldestSeen, Number(cursor.slice(6)));
  }

  // The cursor moved earlier every round, past the protected anchor, which is
  // the point of a cursor that is a fetch watermark and not the kept head: a
  // cursor pinned to the kept rows would re-request the same page forever.
  assert.ok(oldestSeen <= 2400 - 40 * 50, `the cursor reached ${oldestSeen}`);
  assert.ok(Number(ids[ids.length - 1].slice(6)) >= 2999, "the newest rows never left");
});

test("the earlier-messages sentinel follows the server, because the window slides", async () => {
  const { hasEarlierAfterPrepend, MAX_LOADED_MESSAGES } = await loadSubject();
  assert.equal(hasEarlierAfterPrepend(50, true), true);
  assert.equal(hasEarlierAfterPrepend(MAX_LOADED_MESSAGES, true), true,
    "the cap used to silence the sentinel; a sliding window can always page on");
  assert.equal(hasEarlierAfterPrepend(MAX_LOADED_MESSAGES + 500, true), true);
  assert.equal(hasEarlierAfterPrepend(50, false), false, "the server's no stays a no");
});
