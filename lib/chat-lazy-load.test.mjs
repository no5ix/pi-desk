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
