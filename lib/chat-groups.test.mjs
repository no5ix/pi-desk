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
  const ordered = orderChatFamilies(families, new Set(["pinned-old", "pinned-new"]));
  assert.deepEqual(ordered.map((f) => f.root.id), ["pinned-new", "pinned-old", "new", "old"]);
  // The input is left alone.
  assert.deepEqual(families.map((f) => f.root.id), ["old", "new", "pinned-old", "pinned-new"]);
});

test("without pins the order is plain recency", () => {
  const ordered = orderChatFamilies([family("a", "2026-01-01T00:00:00Z"), family("b", "2026-02-01T00:00:00Z")], new Set());
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

test("pinnedThenRunning: pins lead, the live rows follow, the rest keep their order", async () => {
  const { pinnedThenRunning } = await import("./chat-groups.ts");
  assert.deepEqual(
    pinnedThenRunning(["old", "run-a", "pin", "plain", "run-b"], (item) => item === "pin", (item) => item.startsWith("run")),
    ["pin", "run-a", "run-b", "old", "plain"],
  );
  assert.deepEqual(
    pinnedThenRunning(
      ["pinned-run", "run", "old"],
      (item) => item === "pinned-run",
      (item) => item === "pinned-run" || item === "run",
    ),
    ["pinned-run", "run", "old"],
    "a pinned row that is also running stays in the pinned tier and is never listed twice",
  );
  assert.deepEqual(pinnedThenRunning(["a", "b"], () => true, () => true), ["a", "b"]);
  assert.deepEqual(pinnedThenRunning([], () => false, () => false), []);
});

test("familyHasRunningSession answers for the chat itself and the runs under it", async () => {
  const { familyHasRunningSession } = await import("./chat-groups.ts");
  const family = { root: { id: "chat" }, subagents: [{ id: "run" }] };
  assert.ok(familyHasRunningSession(family, new Set(["chat"])));
  assert.ok(familyHasRunningSession(family, new Set(["run"])));
  assert.ok(!familyHasRunningSession(family, new Set(["other"])));
  assert.ok(!familyHasRunningSession({ root: { id: "chat" }, subagents: [] }, new Set(["run"])));
});

test("orderChatFamilies puts the running chats under the pins", async () => {
  const { orderChatFamilies } = await import("./chat-groups.ts");
  const families = [
    family("old", "2026-09-01T00:00:00Z"),
    family("running", "2026-10-19T00:00:00Z"),
    family("pinned", "2026-08-01T00:00:00Z"),
    family("plain", "2026-10-01T00:00:00Z"),
  ];
  assert.deepEqual(
    orderChatFamilies(families, new Set(["pinned"]), new Set(["running"])).map((f) => f.root.id),
    ["pinned", "running", "plain", "old"],
  );
  // No running set at all keeps the old pins-then-recency order.
  assert.deepEqual(
    orderChatFamilies(families, new Set(["pinned"])).map((f) => f.root.id),
    ["pinned", "running", "plain", "old"],
  );
});
