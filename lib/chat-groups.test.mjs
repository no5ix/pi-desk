import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { orderChatFamilies, toggleId } = await jiti.import("./chat-groups.ts");

const family = (id, modified) => ({ root: { id }, subagents: [], latestModified: modified });

test("pinned chats come first, and each half is ordered by recency", () => {
  const families = [
    family("old", "2026-09-01T00:00:00Z"),
    family("new", "2026-10-19T00:00:00Z"),
    family("pinned-old", "2026-08-01T00:00:00Z"),
    family("pinned-new", "2026-10-01T00:00:00Z"),
  ];
  const ordered = orderChatFamilies(families, { pinnedIds: new Set(["pinned-old", "pinned-new"]) });
  assert.deepEqual(ordered.map((f) => f.root.id), ["pinned-new", "pinned-old", "new", "old"]);
  // The input is left alone.
  assert.deepEqual(families.map((f) => f.root.id), ["old", "new", "pinned-old", "pinned-new"]);
});

test("without pins the order is plain recency", () => {
  const ordered = orderChatFamilies([family("a", "2026-01-01T00:00:00Z"), family("b", "2026-02-01T00:00:00Z")], { pinnedIds: new Set() });
  assert.deepEqual(ordered.map((f) => f.root.id), ["b", "a"]);
});

test("toggleId returns a new set and flips membership", () => {
  const base = new Set(["a"]);
  assert.deepEqual([...toggleId(base, "b")], ["a", "b"]);
  assert.deepEqual([...toggleId(base, "a")], []);
  assert.deepEqual([...base], ["a"]);
});

test("pinnedFirst puts pinned items first and keeps each part's order (S2)", async () => {
  const { pinnedFirst } = await import("./chat-groups.ts");
  assert.deepEqual(pinnedFirst(["a", "b", "c", "d"], (item) => item === "c" || item === "a"), ["a", "c", "b", "d"]);
  assert.deepEqual(pinnedFirst([], () => true), []);
});

const marks = (pinned, unread, running) => ({
  isPinned: (item) => pinned.includes(item),
  isUnread: (item) => unread.includes(item),
  isRunning: (item) => running.includes(item),
});

test("previewTier: pins lead, an unread result comes next, then live work, then the rest", async () => {
  const { previewTier } = await import("./chat-groups.ts");
  const p = marks(["pin"], ["unread", "unread-running"], ["running", "unread-running"]);
  assert.equal(previewTier("pin", p), 0);
  assert.equal(previewTier("unread", p), 1, "a finished row with unread output is an answer waiting");
  assert.equal(previewTier("running", p), 2);
  assert.equal(previewTier("unread-running", p), 2, "a running row has nothing to read yet, so it is live work, not a result");
  assert.equal(previewTier("plain", p), 3);
});

test("previewOrder: pins, unread finished rows, running rows, then the rest in their order", async () => {
  const { previewOrder } = await import("./chat-groups.ts");
  const items = ["new-plain", "run-a", "pin-old", "unread-b", "unread-run", "unread-a", "run-b", "old-plain"];
  assert.deepEqual(
    previewOrder(items, marks(["pin-old"], ["unread-a", "unread-b", "unread-run"], ["run-a", "run-b", "unread-run"])),
    ["pin-old", "unread-b", "unread-a", "run-a", "unread-run", "run-b", "new-plain", "old-plain"],
  );
  assert.deepEqual(previewOrder([], marks([], [], [])), []);
  assert.deepEqual(previewOrder(["a", "b"], marks([], ["a", "b"], [])), ["a", "b"], "one tier keeps the given order");
  // The input array is left alone.
  assert.deepEqual(items[0], "new-plain");
});

test("previewRowIsAlwaysVisible is the same rule as the order, so the window cannot bury a tier", async () => {
  const { previewRowIsAlwaysVisible, previewTier, PREVIEW_TIER_PLAIN } = await import("./chat-groups.ts");
  const p = marks(["pin"], ["unread"], ["running"]);
  for (const item of ["pin", "unread", "running", "plain", "other"]) {
    assert.equal(
      previewRowIsAlwaysVisible(item, p),
      previewTier(item, p) < PREVIEW_TIER_PLAIN,
      `${item} answers the same way in the order and in the window`,
    );
  }
  assert.deepEqual(["pin", "unread", "running", "plain"].filter((item) => previewRowIsAlwaysVisible(item, p)), ["pin", "unread", "running"]);
});

test("familyHasUnreadSession and familyHasRunningSession cover the chat itself and the runs under it", async () => {
  const { familyHasRunningSession, familyHasUnreadSession } = await import("./chat-groups.ts");
  const family = { root: { id: "chat" }, subagents: [{ id: "run" }] };
  assert.ok(familyHasRunningSession(family, new Set(["chat"])));
  assert.ok(familyHasRunningSession(family, new Set(["run"])));
  assert.ok(!familyHasRunningSession(family, new Set(["other"])));
  assert.ok(!familyHasRunningSession(family, undefined), "no live set at all means nothing is running");
  assert.ok(familyHasUnreadSession(family, new Set(["chat"])));
  assert.ok(familyHasUnreadSession(family, new Set(["run"])));
  assert.ok(!familyHasUnreadSession(family, new Set(["other"])));
  assert.ok(!familyHasUnreadSession(family, undefined));
});

test("orderChatFamilies leads with pins, then the unread chats, then the running ones", async () => {
  const { orderChatFamilies } = await import("./chat-groups.ts");
  const families = [
    family("old", "2026-09-01T00:00:00Z"),
    family("running", "2026-10-19T00:00:00Z"),
    family("unread-old", "2026-08-20T00:00:00Z"),
    family("pinned", "2026-07-01T00:00:00Z"),
    family("unread-new", "2026-10-05T00:00:00Z"),
    family("plain", "2026-10-01T00:00:00Z"),
  ];
  assert.deepEqual(
    orderChatFamilies(families, {
      pinnedIds: new Set(["pinned"]),
      unreadIds: new Set(["unread-new", "unread-old", "running"]),
      runningIds: new Set(["running"]),
    }).map((f) => f.root.id),
    ["pinned", "unread-new", "unread-old", "running", "plain", "old"],
    "the running chat's own unread mark keeps it in the running tier",
  );
  // No unread or running sets at all keeps the old pins-then-recency order.
  assert.deepEqual(
    orderChatFamilies(families, { pinnedIds: new Set(["pinned"]) }).map((f) => f.root.id),
    ["pinned", "running", "unread-new", "plain", "old", "unread-old"],
  );
});
