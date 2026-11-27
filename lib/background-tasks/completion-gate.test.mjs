import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearBackgroundTaskCompletions,
  noteBackgroundTaskSettlement,
  runWokeByBackgroundTask,
} from "./completion-gate.ts";

// The gate is fed by the extension's own frames and read by the session at the start of a run, so
// the tests move time by hand: a run that follows a task settling is the extension handing in its
// result and is announced by the card alone; every other run is announced as usual.

let sessionNumber = 0;
function session() {
  sessionNumber += 1;
  return `session-${String(sessionNumber)}`;
}

test("the first frame plants a baseline: tasks that finished before the bridge existed wake nothing", () => {
  const id = session();
  noteBackgroundTaskSettlement({ sessionId: id, running: 0, settled: 3, at: 1_000 });
  assert.equal(runWokeByBackgroundTask(id, 0, { now: 1_500 }), false);
});

test("a task that leaves running and settles wakes a follow-up run, and the card is its announcer", () => {
  const id = session();
  noteBackgroundTaskSettlement({ sessionId: id, running: 2, settled: 0, at: 1_000 });
  noteBackgroundTaskSettlement({ sessionId: id, running: 1, settled: 1, at: 2_000 });
  // The extension's notice lands, its follow-up turn starts, and nothing of this conversation
  // asked for it: announcing it on the desktop, over push and over ntfy is a notice for work the
  // user started minutes ago.
  assert.equal(runWokeByBackgroundTask(id, 0, { now: 2_100 }), true);
});

test("a prompt of this conversation wins: the user's own task is announced, always", () => {
  const id = session();
  noteBackgroundTaskSettlement({ sessionId: id, running: 1, settled: 0, at: 1_000 });
  noteBackgroundTaskSettlement({ sessionId: id, running: 0, settled: 1, at: 2_000 });
  // Asked before the task settled: the run after it is the extension's, so it is silent.
  assert.equal(runWokeByBackgroundTask(id, 1_500, { now: 2_100 }), true);
  // Asked at or after the settlement: this is the user's next task, and its finish is news.
  assert.equal(runWokeByBackgroundTask(id, 2_000, { now: 2_100 }), false);
  assert.equal(runWokeByBackgroundTask(id, 2_500, { now: 2_600 }), false);
});

test("the note expires: a completion never silences a later task", () => {
  const id = session();
  noteBackgroundTaskSettlement({ sessionId: id, running: 1, settled: 0, at: 1_000 });
  noteBackgroundTaskSettlement({ sessionId: id, running: 0, settled: 1, at: 2_000 });
  assert.equal(runWokeByBackgroundTask(id, 0, { now: 2_000 + 30_000 }), true);
  assert.equal(runWokeByBackgroundTask(id, 0, { now: 2_000 + 30_001 }), false);
});

test("a frame that settles nothing notes nothing", () => {
  const id = session();
  noteBackgroundTaskSettlement({ sessionId: id, running: 1, settled: 1, at: 1_000 });
  // The same counts: a repeat frame (the client de-dupes, the service reads) is not news.
  noteBackgroundTaskSettlement({ sessionId: id, running: 1, settled: 1, at: 2_000 });
  assert.equal(runWokeByBackgroundTask(id, 0, { now: 2_100 }), false);
  // A task started, none finished.
  noteBackgroundTaskSettlement({ sessionId: id, running: 2, settled: 1, at: 3_000 });
  assert.equal(runWokeByBackgroundTask(id, 0, { now: 3_100 }), false);
});

test("a conversation the server is not holding has nothing to explain a run", () => {
  const id = session();
  noteBackgroundTaskSettlement({ sessionId: id, running: 1, settled: 0, at: 1_000 });
  noteBackgroundTaskSettlement({ sessionId: id, running: 0, settled: 1, at: 2_000 });
  assert.equal(runWokeByBackgroundTask(id, 0, { now: 2_100 }), true);
  clearBackgroundTaskCompletions(id);
  assert.equal(runWokeByBackgroundTask(id, 0, { now: 2_100 }), false);
});

test("conversations do not lend each other their news", () => {
  const one = session();
  const two = session();
  noteBackgroundTaskSettlement({ sessionId: one, running: 1, settled: 0, at: 1_000 });
  noteBackgroundTaskSettlement({ sessionId: one, running: 0, settled: 1, at: 2_000 });
  noteBackgroundTaskSettlement({ sessionId: two, running: 1, settled: 0, at: 1_000 });
  assert.equal(runWokeByBackgroundTask(two, 0, { now: 2_100 }), false);
  assert.equal(runWokeByBackgroundTask(one, 0, { now: 2_100 }), true);
});
