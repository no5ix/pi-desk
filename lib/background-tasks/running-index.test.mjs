import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  backgroundTasksRunningCount,
  clearAllBackgroundTasksRunning,
  clearBackgroundTasksRunning,
  getBackgroundTasksRunning,
  listBackgroundTasksRunning,
  recordBackgroundTasksRunning,
  subscribeBackgroundTasksRunning,
} = await jiti.import("./running-index.ts");

/**
 * The running index: the small number behind the composer's stop disc and the sidebar's running
 * mark.
 *
 * The rule it guards is that the app never keeps a task registry of its own. This index stores
 * the counts the extension published, for the conversations the app is holding, and nothing else:
 * no commands, no ids, no task rows. A finished task is not remembered here (its registry is the
 * card's job), and a conversation the app released is removed, so an idle conversation never
 * keeps a running mark on its row.
 */

test("a conversation with running tasks is counted; releasing it removes the mark", () => {
  clearAllBackgroundTasksRunning();
  recordBackgroundTasksRunning("s-1", { running: 2, unseenFailed: 1, observedAt: 1000 });
  assert.equal(backgroundTasksRunningCount("s-1"), 2);
  assert.deepEqual(getBackgroundTasksRunning("s-1"), { running: 2, unseenFailed: 1, observedAt: 1000 });
  assert.deepEqual(listBackgroundTasksRunning(), { "s-1": { running: 2, unseenFailed: 1, observedAt: 1000 } });

  // The task stopped: the extension says so with its own counts, and the mark has to leave the
  // row with it. A number that stays is a lie about work that finished.
  recordBackgroundTasksRunning("s-1", { running: 0, unseenFailed: 1, observedAt: 2000 });
  assert.equal(backgroundTasksRunningCount("s-1"), 0, "no running mark on a conversation whose tasks stopped");
  // The failure nobody has read is news, so the conversation keeps its entry: that is the chip's
  // warning, and a mark the client has to invent is worse than an entry that names the news.
  assert.deepEqual(listBackgroundTasksRunning(), { "s-1": { running: 0, unseenFailed: 1, observedAt: 2000 } });

  // Seen, and nothing running: the conversation leaves the map.
  recordBackgroundTasksRunning("s-1", { running: 0, unseenFailed: 0, observedAt: 3000 });
  assert.deepEqual(listBackgroundTasksRunning(), {}, "a conversation with no news carries no entry");

  // A conversation the app releases is removed even while its work runs: a mark that outlives
  // the conversation is a lie about work the app is no longer watching.
  recordBackgroundTasksRunning("s-1", { running: 1, unseenFailed: 0, observedAt: 4000 });
  assert.equal(clearBackgroundTasksRunning("s-1"), true);
  assert.equal(clearBackgroundTasksRunning("s-1"), false, "nothing left to release");
  assert.deepEqual(listBackgroundTasksRunning(), {});
});

test("a subscriber hears the running edge and the quiet edge, and only those", () => {
  clearAllBackgroundTasksRunning();
  const frames = [];
  const unsubscribe = subscribeBackgroundTasksRunning((map) => frames.push(map));
  recordBackgroundTasksRunning("s-2", { running: 1, unseenFailed: 0, observedAt: 1 });
  assert.equal(frames.length, 1);
  assert.equal(frames[0]["s-2"].running, 1);

  // The same numbers are not news: a change frame that repeats the counts must not wake every
  // sidebar row in the browser.
  recordBackgroundTasksRunning("s-2", { running: 1, unseenFailed: 0, observedAt: 2 });
  assert.equal(frames.length, 1, "an unchanged count is not pushed");

  // A new conversation's running task is news, and so is the last task of a conversation ending.
  recordBackgroundTasksRunning("s-3", { running: 3, unseenFailed: 0, observedAt: 3 });
  assert.equal(frames.length, 2);
  recordBackgroundTasksRunning("s-2", { running: 0, unseenFailed: 2, observedAt: 4 });
  assert.equal(frames.length, 3);
  // Every frame is the whole map, not a delta: a client that reconnects mid-stream cannot miss a
  // conversation. s-2 is still in it — its work stopped, and its unacknowledged failure is news.
  assert.deepEqual(Object.keys(frames[2]).sort(), ["s-2", "s-3"]);
  assert.equal(frames[2]["s-2"].running, 0);

  unsubscribe();
  recordBackgroundTasksRunning("s-4", { running: 1, unseenFailed: 0, observedAt: 5 });
  assert.equal(frames.length, 3, "a closed listener stops hearing");
  clearAllBackgroundTasksRunning();
});

test("an unseen failure is kept for the chip, and a closed activation drops the counts", () => {
  clearAllBackgroundTasksRunning();
  recordBackgroundTasksRunning("s-5", { running: 1, unseenFailed: 2, observedAt: 1 });
  assert.equal(getBackgroundTasksRunning("s-5").unseenFailed, 2);
  // The task finished and nobody has read it: the running mark goes, the failure stays, and the
  // conversation still has an entry because the chip has to keep showing the warning.
  recordBackgroundTasksRunning("s-5", { running: 0, unseenFailed: 2, observedAt: 2 });
  assert.equal(backgroundTasksRunningCount("s-5"), 0);
  assert.ok(listBackgroundTasksRunning()["s-5"], "an unacknowledged failure is news the row keeps");
  // The conversation closed: the extension is gone, and the app forgets what it reported.
  clearBackgroundTasksRunning("s-5");
  assert.deepEqual(listBackgroundTasksRunning(), {});
});

test("a record with no counts is not stored, so an entry never means nothing", () => {
  clearAllBackgroundTasksRunning();
  recordBackgroundTasksRunning("s-6", { running: 0, unseenFailed: 0, observedAt: 1 });
  assert.deepEqual(listBackgroundTasksRunning(), {}, "an empty entry is dropped, not kept at zero");
  assert.equal(backgroundTasksRunningCount("s-6"), 0);
});
