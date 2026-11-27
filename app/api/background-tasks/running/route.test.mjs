import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * The running feed: the composer's stop disc and the sidebar's running mark, fed by the
 * extension's own counts.
 *
 * Two rules the routes carry. The numbers are the extension's — the index records what a live
 * conversation's activation reported, and these routes add nothing, keep no task list, and run no
 * host operation. And the map is the whole state on every frame, so a client that reconnects
 * mid-stream cannot miss a conversation.
 */
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET: GET_RUNNING } = await jiti.import("./route.ts");
const { GET: GET_EVENTS } = await jiti.import("./events/route.ts");
const {
  clearAllBackgroundTasksRunning,
  recordBackgroundTasksRunning,
} = await jiti.import("@/lib/background-tasks/running-index.ts");

test("the running route answers with the extension's counts, and nothing else", async () => {
  clearAllBackgroundTasksRunning();
  recordBackgroundTasksRunning("session-a", { running: 2, unseenFailed: 0, observedAt: 1000 });
  recordBackgroundTasksRunning("session-b", { running: 0, unseenFailed: 1, observedAt: 1001 });

  const response = await GET_RUNNING();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    sessions: {
      "session-a": { running: 2, unseenFailed: 0, observedAt: 1000 },
      "session-b": { running: 0, unseenFailed: 1, observedAt: 1001 },
    },
  }, "the map is the index, with no task rows and no invented fields");

  // A conversation whose work finished and was seen is not in the map at all: its row's mark and
  // the composer's disc have to go with it.
  recordBackgroundTasksRunning("session-a", { running: 0, unseenFailed: 0, observedAt: 2000 });
  const after = await GET_RUNNING();
  assert.deepEqual(Object.keys((await after.json()).sessions), ["session-b"]);
  clearAllBackgroundTasksRunning();
});

test("the stream's first frame is the whole map, and closing the request closes the subscription", async () => {
  clearAllBackgroundTasksRunning();
  recordBackgroundTasksRunning("session-c", { running: 1, unseenFailed: 0, observedAt: 500 });

  const controller = new AbortController();
  const response = await GET_EVENTS(new Request("http://localhost/api/background-tasks/running/events", {
    signal: controller.signal,
  }));
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  // `no-transform`: Next's compression would hold these events in a gzip buffer, and a sidebar
  // that learns about a finished task a minute later has learned nothing.
  assert.match(response.headers.get("cache-control") ?? "", /no-transform/);

  const reader = response.body.getReader();
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /^data: \{"type":"running","sessions":\{"session-c":\{"running":1,"unseenFailed":0,"observedAt":500\}\}\}\n\n$/);

  // A change in a conversation is pushed, in full, without the client asking.
  recordBackgroundTasksRunning("session-d", { running: 3, unseenFailed: 0, observedAt: 600 });
  const second = new TextDecoder().decode((await reader.read()).value);
  assert.deepEqual(JSON.parse(second.replace(/^data: /, "").trim()).sessions["session-d"].running, 3);

  controller.abort();
  // The request is gone: a later change must not be delivered to a closed stream, and the server
  // must not keep the subscription.
  const pending = reader.read();
  recordBackgroundTasksRunning("session-e", { running: 1, unseenFailed: 0, observedAt: 700 });
  const settled = await Promise.race([
    // The stream ending (the abort reached the server and it closed the response) is the good
    // news; a data frame after an abort is a subscription the route forgot to drop.
    pending.then((result) => (result.done ? "closed" : "data")),
    new Promise((resolve) => setTimeout(() => resolve("idle"), 250)),
  ]);
  assert.notEqual(settled, "data", "a closed stream stops receiving");
  clearAllBackgroundTasksRunning();
});
