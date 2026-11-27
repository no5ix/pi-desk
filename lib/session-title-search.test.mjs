import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { filterSessionsByQuery, matchesSessionQuery, normalizeSessionQuery, sessionSearchNeedles } =
  await jiti.import("@/lib/session-title-search");

function session(id, fields = {}) {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/repo/a",
    created: "2026-11-01T00:00:00.000Z",
    modified: "2026-11-01T00:00:00.000Z",
    messageCount: 4,
    firstMessage: "",
    ...fields,
  };
}

test("an empty query keeps every session, in the order it was given", () => {
  const sessions = [session("a"), session("b"), session("c")];
  assert.deepEqual(filterSessionsByQuery(sessions, "   ").map((s) => s.id), ["a", "b", "c"]);
});

test("the title the row shows is searchable, case-insensitively", () => {
  const sessions = [
    session("named", { name: "Design Review" }),
    session("other", { name: "Ship log" }),
  ];
  assert.deepEqual(filterSessionsByQuery(sessions, "design").map((s) => s.id), ["named"]);
  assert.deepEqual(filterSessionsByQuery(sessions, "DESIGN REVIEW").map((s) => s.id), ["named"]);
  assert.deepEqual(filterSessionsByQuery(sessions, "  ship  ").map((s) => s.id), ["other"]);
});

test("the session's prompt is searchable, including a session with no name of its own", () => {
  const sessions = [
    session("prompt-only", { firstMessage: "Fix the sidebar search box\nso it matches prompts." }),
    session("named", { name: "Notes", firstMessage: "an unrelated prompt" }),
  ];
  assert.deepEqual(filterSessionsByQuery(sessions, "sidebar search").map((s) => s.id), ["prompt-only"]);
  // A prompt the row shows cut at 50 chars is still found past the cut, and across its lines.
  assert.deepEqual(filterSessionsByQuery(sessions, "so it matches prompts").map((s) => s.id), ["prompt-only"]);
  assert.deepEqual(filterSessionsByQuery(sessions, "NOTES").map((s) => s.id), ["named"]);
});

test("a query that matches nothing keeps nothing, and the search never re-sorts what it keeps", () => {
  const sessions = [session("a", { name: "Alpha" }), session("b", { name: "Beta" }), session("c", { name: "Alpaca" })];
  assert.deepEqual(filterSessionsByQuery(sessions, "al").map((s) => s.id), ["a", "c"]);
  assert.deepEqual(filterSessionsByQuery(sessions, "zzz"), []);
});

test("the needles are the row's title and the prompt, whitespace folded, with no duplicate", () => {
  const needles = sessionSearchNeedles(session("s1", { name: "One  two", firstMessage: "One two" }));
  assert.deepEqual(needles, ["One two"]);
  const unnamed = sessionSearchNeedles(session("s2", { firstMessage: "line one\nline two" }));
  assert.deepEqual(unnamed, ["line one line two"]);
  assert.deepEqual(sessionSearchNeedles(session("", {})), []);
});

test("a session with no name and no prompt is found by its id, the way the row titles it", () => {
  const s = session("deadbeefcafe1234");
  assert.ok(matchesSessionQuery(s, "deadbeefcafe"));
  assert.equal(normalizeSessionQuery("  DeadBeef  "), "deadbeef");
});
