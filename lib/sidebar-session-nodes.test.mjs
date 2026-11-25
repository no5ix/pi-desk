import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { buildSessionTree, countRunningSubagentRuns, countTreeDescendants, treeContainsSession } = await jiti.import("./sidebar-session-nodes.ts");
const {
  MAX_EXPANDED_SUBAGENT_ROWS,
  nextExpandedSubagentRows,
  parseExpandedSubagentRows,
} = await jiti.import("./sidebar-subagent-expansion.ts");

function session(id, modified, extra = {}) {
  return { id, path: `/s/${id}.jsonl`, cwd: "/p", created: modified, modified, messageCount: 1, firstMessage: id, ...extra };
}

const subagent = (parentSessionId) => ({
  parentSessionId,
  relation: { kind: "subagent", parentSessionId, profile: "general", description: "", status: "completed" },
});
const run = (parentSessionId, status) => ({
  parentSessionId,
  relation: { kind: "subagent", parentSessionId, profile: "general", description: "", status },
});
const sideChat = (parentSessionId) => ({
  parentSessionId,
  relation: { kind: "side", parentSessionId },
});
const fork = (originSessionId) => ({ parentSessionId: originSessionId, relation: { kind: "fork", originSessionId } });

test("a fork is a row of its own beside its source, not a child of it (#237)", () => {
  const roots = buildSessionTree([
    session("main", "2026-11-14T10:00:00Z"),
    session("fork", "2026-11-14T11:00:00Z", fork("main")),
  ]);
  assert.deepEqual(roots.map((node) => node.session.id), ["fork", "main"]);
  assert.ok(roots.every((node) => node.children.length === 0));
});

test("subagents and side chats nest under their parent; a fork's subagents under the fork", () => {
  const roots = buildSessionTree([
    session("main", "2026-11-14T10:00:00Z"),
    session("a1", "2026-11-14T10:01:00Z", subagent("main")),
    session("side", "2026-11-14T10:02:00Z", { parentSessionId: "main", relation: { kind: "side", parentSessionId: "main" } }),
    session("fork", "2026-11-14T09:00:00Z", fork("main")),
    session("f1", "2026-11-14T09:01:00Z", subagent("fork")),
    session("nested", "2026-11-14T10:03:00Z", subagent("a1")),
  ]);
  assert.deepEqual(roots.map((node) => node.session.id), ["main", "fork"]);
  const [main, forkNode] = roots;
  assert.deepEqual(main.children.map((node) => node.session.id), ["side", "a1"]);
  assert.deepEqual(main.children[1].children.map((node) => node.session.id), ["nested"]);
  assert.deepEqual(forkNode.children.map((node) => node.session.id), ["f1"]);
  assert.equal(countTreeDescendants(main), 3);
  assert.equal(countTreeDescendants(forkNode), 1);
  assert.ok(treeContainsSession(main, "nested"));
  assert.ok(!treeContainsSession(main, "f1"));
});

test("a subagent whose parent is not listed stays visible as a root", () => {
  const roots = buildSessionTree([session("orphan", "2026-11-14T10:00:00Z", subagent("gone"))]);
  assert.deepEqual(roots.map((node) => node.session.id), ["orphan"]);
});

test("a row's live subagent runs are counted, so its fold head breathes with the header", () => {
  const [main] = buildSessionTree([
    session("main", "2026-11-14T10:00:00Z"),
    session("running", "2026-11-14T10:01:00Z", run("main", "running")),
    session("queued", "2026-11-14T10:02:00Z", run("main", "queued")),
    session("done", "2026-11-14T10:03:00Z", run("main", "completed")),
    session("side", "2026-11-14T10:04:00Z", sideChat("main")),
    session("nested", "2026-11-14T10:05:00Z", run("running", "running")),
  ]);
  assert.equal(countRunningSubagentRuns(main, new Set()), 3,
    "running and queued, plus the live run's own live child; a completed run and a side chat do not count");
  assert.equal(countRunningSubagentRuns(main, new Set(["done", "side"])), 4,
    "the live set answers for a run the file calls done, and a live side chat is a conversation, not a run");
  assert.equal(countRunningSubagentRuns(main, new Set(["main"])), 3,
    "the parent's own run is not one of its children's");
  const done = main.children.find((node) => node.session.id === "done");
  assert.equal(countRunningSubagentRuns(done, new Set()), 0, "a finished run with no children of its own");
});

test("unfolded rows are remembered newest last, deduplicated and capped", () => {
  assert.deepEqual(parseExpandedSubagentRows(null), []);
  assert.deepEqual(parseExpandedSubagentRows(["a", 3, "", "b", "a"]), ["a", "b"]);
  assert.deepEqual(nextExpandedSubagentRows(["a", "b"], "a", true), ["b", "a"]);
  assert.deepEqual(nextExpandedSubagentRows(["a", "b"], "a", false), ["b"]);
  const many = Array.from({ length: MAX_EXPANDED_SUBAGENT_ROWS }, (_, index) => `s${index}`);
  const next = nextExpandedSubagentRows(many, "new", true);
  assert.equal(next.length, MAX_EXPANDED_SUBAGENT_ROWS);
  assert.equal(next.at(-1), "new");
  assert.ok(!next.includes("s0"));
});
