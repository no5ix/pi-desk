import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * The panel's HTTP contract, at the edge. Every route here is a thin gate: a session id is
 * required, an action is one of four words, a byte window is bounded, and the answer for a task
 * the extension refused is a 409 carrying the extension's code. A conversation that is not
 * running has no tasks — the panel is told so, in a shape it can render, and nothing is invented.
 */
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const { GET: GET_TASK } = await jiti.import("./task/route.ts");
const { GET: GET_EVENTS } = await jiti.import("./events/route.ts");

function get(query) {
  return GET(new Request(`http://localhost/api/background-tasks${query}`));
}
function getTask(query) {
  return GET_TASK(new Request(`http://localhost/api/background-tasks/task${query}`));
}
function post(body, raw) {
  return POST(new Request("http://localhost/api/background-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  }));
}

test("every panel route asks for the conversation it is about", async () => {
  assert.equal((await get("")).status, 400);
  assert.equal((await get("?limit=5")).status, 400);
  assert.equal((await getTask("?taskId=a")).status, 400);
  assert.equal((await getTask("?session=s-1")).status, 400);
  assert.equal((await GET_EVENTS(new Request("http://localhost/api/background-tasks/events"))).status, 400);
  assert.equal((await post({ action: "stop", taskId: "a" })).status, 400);
  assert.equal((await post({ session: "s-1" })).status, 400);
  assert.equal((await post({}, "not json")).status, 400);
});

test("a conversation that is not running is reported as having no tasks, and the panel can say why", async () => {
  const response = await get("?session=not-a-running-session");
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  // Not an empty list passed off as "nothing running": the panel's "unavailable" state, named.
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.state, "no-session");
  assert.deepEqual(snapshot.tasks, []);
  assert.deepEqual(snapshot.sessions, []);
  assert.deepEqual(snapshot.counts, {
    running: 0, completed: 0, failed: 0, killed: 0,
    unseenCompleted: 0, unseenFailed: 0, unseenKilled: 0, total: 0,
  });
  assert.ok(typeof snapshot.reason === "string" && snapshot.reason.length > 0);
  assert.equal(typeof snapshot.observedAt, "number");
});

test("the switch that keeps the extension out of every session is reported, not swallowed", async () => {
  const previous = process.env.PI_WEB_DISABLE_BACKGROUND_TASKS;
  process.env.PI_WEB_DISABLE_BACKGROUND_TASKS = "1";
  try {
    const snapshot = await (await get("?session=any-session")).json();
    assert.deepEqual(snapshot, {
      ...snapshot,
      available: false,
      state: "disabled",
      tasks: [],
      sessions: [],
    });
    assert.match(snapshot.reason, /PI_WEB_DISABLE_BACKGROUND_TASKS/);
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_DISABLE_BACKGROUND_TASKS;
    else process.env.PI_WEB_DISABLE_BACKGROUND_TASKS = previous;
  }
});

test("an action is one of four words, and the answer for a task nobody has is the extension's code", async () => {
  const unknownAction = await post({ session: "s-1", action: "explode", taskId: "a" });
  assert.equal(unknownAction.status, 400);
  assert.match((await unknownAction.json()).error, /stop, stop-all, rerun or mark-seen/);

  for (const action of ["stop", "rerun"]) {
    const response = await post({ session: "not-a-running-session", action, taskId: "task-1" });
    // Not 404: the request was understood, and the task is unreachable. The panel shows the code.
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, "UNAVAILABLE");
  }

  for (const action of ["stop-all", "mark-seen"]) {
    const empty = await post({ session: "not-a-running-session", action, taskIds: [] });
    assert.equal(empty.status, 409);
    assert.equal((await empty.json()).code, "INVALID_REQUEST", "an empty selection never reaches the extension");
  }
});

test("a task read names what it wants, and an unknown type is refused at the gate", async () => {
  const badType = await getTask("?session=s-1&taskId=a&type=result");
  assert.equal(badType.status, 400);
  assert.match((await badType.json()).error, /detail or logs/);

  const missing = await getTask("?session=not-a-running-session&taskId=task-1&type=detail");
  assert.equal(missing.status, 409);
  const body = await missing.json();
  assert.equal(body.ok, false);
  // The panel shows this sentence, so it must be a sentence and not a stack.
  assert.equal(typeof body.message, "string");
  assert.ok(body.message.length > 0);

  const logs = await getTask("?session=not-a-running-session&taskId=task-1&type=logs&maxBytes=99999999");
  assert.equal(logs.status, 409);
  const logsBody = await logs.json();
  assert.equal(logsBody.ok, false);
  // The byte window is answered back to the client, capped at the extension's own bound: the
  // panel must not ask the extension for more than it will give.
  assert.equal(logsBody.maxBytes, 65536);
});
