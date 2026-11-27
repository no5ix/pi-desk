import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const {
  BACKGROUND_TASK_FILTERS,
  BACKGROUND_TASK_LOG_FULL_WINDOW_BYTES,
  BACKGROUND_TASK_LOG_WINDOW_BYTES,
  backgroundTaskDetailRows,
  backgroundTaskDurationMs,
  backgroundTaskExitLabel,
  backgroundTaskTitle,
  backgroundTasksBadge,
  backgroundTaskLogWindowBytes,
  countBackgroundTaskFilters,
  filterBackgroundTasks,
  formatBackgroundTaskDuration,
  isUnseenFailure,
  mergeBackgroundTaskViews,
  shortenBackgroundTaskCommand,
  shouldFollowBackgroundTaskLog,
  sumBackgroundTaskCounts,
} = await jiti.import("./session-view.ts");

const view = (id, over = {}) => {
  const { seen, canRerun, canReadResult, kind, ...taskOver } = over;
  return {
    task: {
      id,
      command: `echo ${id}`,
      status: "running",
      cwd: "/repo",
      startTime: 1000,
      bytesWritten: 0,
      outputPath: `.pi/tasks/x/${id}.output`,
      isAgent: false,
      surviveReload: false,
      notified: false,
      notifyOnCompletion: true,
      triggerOnCompletion: false,
      ...taskOver,
    },
    kind: kind ?? "shell",
    seen: seen ?? false,
    canRerun: canRerun ?? true,
    canReadResult: canReadResult ?? false,
    truncatedFields: [],
  };
};

test("the filter buckets are the extension's statuses plus All", () => {
  assert.deepEqual([...BACKGROUND_TASK_FILTERS], ["all", "running", "completed", "failed", "killed"]);
});

test("filtering splits the list by status, and the chips count every row", () => {
  const tasks = [
    view("a", { status: "running" }),
    view("b", { status: "completed" }),
    view("c", { status: "failed" }),
    view("d", { status: "killed" }),
  ];
  assert.deepEqual(filterBackgroundTasks(tasks, "all").map((entry) => entry.task.id), ["a", "b", "c", "d"]);
  assert.deepEqual(filterBackgroundTasks(tasks, "failed").map((entry) => entry.task.id), ["c"]);
  assert.deepEqual(filterBackgroundTasks(tasks, "running").map((entry) => entry.task.id), ["a"]);
  const counts = countBackgroundTaskFilters(tasks);
  assert.deepEqual(counts, { all: 4, running: 1, completed: 1, failed: 1, killed: 1 });
});

test("the badge reports live work and unacknowledged finished work, never a total as a claim", () => {
  const badge = backgroundTasksBadge({
    running: 2,
    completed: 5,
    failed: 3,
    killed: 1,
    unseenCompleted: 4,
    unseenFailed: 2,
    unseenKilled: 1,
    total: 11,
  });
  assert.equal(badge.running, 2);
  assert.equal(badge.unseenFailed, 2);
  assert.equal(badge.unseenKilled, 1);
  // Merely listing a task acknowledges nothing: `seen` is set by opening it, as in the dock.
  assert.equal(isUnseenFailure(view("x", { status: "failed", seen: false })), true);
  assert.equal(isUnseenFailure(view("x", { status: "failed", seen: true })), false);
  assert.equal(isUnseenFailure(view("x", { status: "completed", seen: false })), false);
});

test("the counts of several activations add up without inventing a task", () => {
  const totals = sumBackgroundTaskCounts([
    { running: 1, completed: 2, failed: 0, killed: 0, unseenCompleted: 1, unseenFailed: 0, unseenKilled: 0, total: 3 },
    { running: 2, completed: 0, failed: 1, killed: 1, unseenCompleted: 0, unseenFailed: 1, unseenKilled: 1, total: 4 },
  ]);
  assert.deepEqual(totals, {
    running: 3, completed: 2, failed: 1, killed: 1,
    unseenCompleted: 1, unseenFailed: 1, unseenKilled: 1, total: 7,
  });
});

test("a merged list is one row per task id, newest first, and never flips back to running", () => {
  const older = view("a", { startTime: 100 });
  const newer = view("b", { startTime: 200 });
  const running = view("a", { startTime: 100, status: "running" });
  const killed = view("a", { startTime: 100, status: "killed", endTime: 500 });
  // One row per id, newest start first, across every activation it came from.
  assert.deepEqual(mergeBackgroundTaskViews([[older, newer]]).map((entry) => entry.task.id), ["b", "a"]);
  // The same id from two activations: one row, and its terminal state is not undone.
  const merged = mergeBackgroundTaskViews([[running], [killed]]);
  assert.equal(merged.length, 1);
  assert.equal(mergeBackgroundTaskViews([[killed], [running]])[0].task.status, "killed");
  // A running task with no terminal observation still shows as running.
  assert.equal(mergeBackgroundTaskViews([[running]])[0].task.status, "running");
});

test("a nameless shell task is its command, and a command is shortened in the middle", () => {
  assert.equal(backgroundTaskTitle(view("a", { name: "build" })), "build");
  assert.equal(backgroundTaskTitle(view("a", { command: "npm run build --flag" })), "npm run build --flag");
  assert.equal(backgroundTaskTitle(view("a", { command: "", name: "  " })), "a");
  const long = `npm run ${"x".repeat(300)}`;
  const short = shortenBackgroundTaskCommand(long, 80);
  assert.ok(short.length <= 80);
  // Both ends survive: the head says what runs, the tail says what it ends with.
  assert.ok(short.startsWith("npm run xxx"));
  assert.ok(short.endsWith("xxx"));
  assert.ok(short.includes("…"));
  assert.equal(shortenBackgroundTaskCommand("a\nb   c"), "a b c");
});

test("a running task's clock counts up to now; a finished one counts to its end", () => {
  const running = view("a", { startTime: 1000 });
  const done = view("b", { startTime: 1000, endTime: 4000, status: "completed" });
  assert.equal(backgroundTaskDurationMs(running, 7000), 6000);
  // A finished task's clock stops at its end, so a row does not tick after it is over.
  assert.equal(backgroundTaskDurationMs(done, 9000), 3000);
  assert.equal(formatBackgroundTaskDuration(48_100), "48s");
  assert.equal(formatBackgroundTaskDuration(7 * 60_000 + 12_000), "7m12s");
  assert.equal(formatBackgroundTaskDuration(2 * 3600_000 + 4 * 60_000), "2h04m");
  assert.equal(formatBackgroundTaskDuration(-5000), "0s");
});

test("the exit label is the extension's, not a guess", () => {
  assert.equal(backgroundTaskExitLabel(view("a", { status: "running" })), null);
  assert.equal(backgroundTaskExitLabel(view("a", { status: "completed", exitCode: 0 })), "exit 0");
  assert.equal(backgroundTaskExitLabel(view("a", { status: "failed", exitCode: 1 })), "exit 1");
  assert.equal(backgroundTaskExitLabel(view("a", { status: "killed", signal: "SIGTERM" })), "SIGTERM");
  assert.equal(backgroundTaskExitLabel(view("a", { status: "killed" })), "killed");
});

test("the detail rows carry only what the task reported", () => {
  const rows = backgroundTaskDetailRows(view("a", {
    pid: 4242,
    cwd: "/repo/work",
    startTime: 1000,
    endTime: 5000,
    status: "failed",
    exitCode: 2,
    bytesWritten: 120,
    outputPath: "/tmp/a.output",
    timeoutSeconds: 30,
    tokenUsage: { input: 10, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 13 },
  }));
  const labels = rows.map((row) => row.labelKey);
  assert.ok(labels.includes("backgroundTasks.detail.pid"));
  assert.ok(labels.includes("backgroundTasks.detail.cwd"));
  assert.ok(labels.includes("backgroundTasks.detail.exit"));
  assert.ok(labels.includes("backgroundTasks.detail.outputFile"));
  assert.ok(labels.includes("backgroundTasks.detail.tokens"));
  // No telemetry invented for a task that reported none, and no empty row for it.
  assert.ok(!labels.includes("backgroundTasks.detail.telemetry"));
  const rowsWithout = backgroundTaskDetailRows(view("a", { pid: undefined, tokenUsage: undefined }));
  assert.ok(!rowsWithout.some((row) => row.labelKey === "backgroundTasks.detail.pid"));
  assert.ok(!rowsWithout.some((row) => row.labelKey === "backgroundTasks.detail.tokens"));
});

test("the log window stays inside the extension's bound", () => {
  assert.equal(backgroundTaskLogWindowBytes(undefined), BACKGROUND_TASK_LOG_WINDOW_BYTES);
  assert.equal(backgroundTaskLogWindowBytes(10_000_000), BACKGROUND_TASK_LOG_FULL_WINDOW_BYTES);
  assert.equal(backgroundTaskLogWindowBytes(0), 1);
  assert.equal(BACKGROUND_TASK_LOG_FULL_WINDOW_BYTES, 65536);
});

test("a log follows while the bottom is in view and freezes when the user scrolls up", () => {
  assert.equal(shouldFollowBackgroundTaskLog({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 }), true);
  assert.equal(shouldFollowBackgroundTaskLog({ scrollTop: 400, scrollHeight: 1000, clientHeight: 100 }), false);
  // The 24px slack is what makes "at the bottom" true on a fractional scroll position.
  assert.equal(shouldFollowBackgroundTaskLog({ scrollTop: 876, scrollHeight: 1000, clientHeight: 100 }), true);
  assert.equal(shouldFollowBackgroundTaskLog({ scrollTop: 875, scrollHeight: 1000, clientHeight: 100 }), false);
});
