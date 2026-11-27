import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const {
  BG_HOST_CHANGED_CHANNEL,
  BG_HOST_CHANGED_SCHEMA,
  BG_HOST_MAX_LOG_BYTES,
  BG_HOST_REQUEST_CHANNEL,
  BG_HOST_REQUEST_SCHEMA,
  BG_HOST_RESPONSE_CHANNEL,
  BG_HOST_RESPONSE_SCHEMA,
  bgHostRequestFrame,
  parseBgChangedFrame,
  parseBgResponseFrame,
  parseBgTaskView,
  parseBgTaskViews,
  isBgTerminalStatus,
  isBgHostErrorCode,
  BG_HOST_ERROR_CODES,
  emptyBgTaskCounts,
} = await jiti.import("./protocol.ts");

const task = (id, over = {}) => ({
  id,
  command: `echo ${id}`,
  status: "running",
  outputPath: `.pi/tasks/x/${id}.output`,
  cwd: "/repo",
  startTime: 1000,
  bytesWritten: 0,
  isAgent: false,
  surviveReload: false,
  notified: false,
  notifyOnCompletion: true,
  triggerOnCompletion: false,
  ...over,
});

test("the channels are the ones the extension publishes on", () => {
  // The contract, verbatim: a channel renamed on one side is a panel that reads nothing.
  assert.equal(BG_HOST_REQUEST_CHANNEL, "pi-background-tasks:host:request:v1");
  assert.equal(BG_HOST_RESPONSE_CHANNEL, "pi-background-tasks:host:response:v1");
  assert.equal(BG_HOST_CHANGED_CHANNEL, "pi-background-tasks:host:changed:v1");
});

test("a request frame carries the schema, the id, the operation and a closed payload", () => {
  assert.deepEqual(bgHostRequestFrame("r-1", "list", { leaseId: "l", activationId: "a", sequence: 1, limit: 50 }), {
    schema_version: BG_HOST_REQUEST_SCHEMA,
    request_id: "r-1",
    operation: "list",
    payload: { leaseId: "l", activationId: "a", sequence: 1, limit: 50 },
  });
});

test("a change frame is accepted only with the schema, kind, activation and revision", () => {
  const frame = {
    schema_version: BG_HOST_CHANGED_SCHEMA,
    kind: "changed",
    activationId: "act-1",
    sessionId: "s-1",
    revision: 4,
    observedAt: 1234,
    counts: { running: 1, completed: 0, failed: 0, killed: 0, unseenCompleted: 0, unseenFailed: 0, unseenKilled: 0, total: 1 },
  };
  assert.deepEqual(parseBgChangedFrame(frame), frame);
  assert.equal(parseBgChangedFrame({ ...frame, schema_version: "other" }), null);
  assert.equal(parseBgChangedFrame({ ...frame, kind: "exploded" }), null);
  assert.equal(parseBgChangedFrame({ ...frame, activationId: "" }), null);
  assert.equal(parseBgChangedFrame({ ...frame, revision: "4" }), null);
  assert.equal(parseBgChangedFrame(null), null);
  assert.equal(parseBgChangedFrame("changed"), null);
});

test("a change frame's counts are read as numbers, and a missing one is zero", () => {
  const frame = parseBgChangedFrame({
    schema_version: BG_HOST_CHANGED_SCHEMA,
    kind: "ready",
    activationId: "act-1",
    sessionId: "s-1",
    revision: 0,
  });
  assert.deepEqual(frame.counts, emptyBgTaskCounts());
});

test("a response frame answers ok with a result, or failure with a code", () => {
  const ok = parseBgResponseFrame({
    schema_version: BG_HOST_RESPONSE_SCHEMA,
    request_id: "r-1",
    operation: "list",
    ok: true,
    result: { tasks: [] },
  });
  assert.equal(ok.ok, true);
  const fail = parseBgResponseFrame({
    schema_version: BG_HOST_RESPONSE_SCHEMA,
    request_id: "r-2",
    operation: "stop",
    ok: false,
    error: { code: "NOT_FOUND", message: "no such task" },
  });
  assert.equal(fail.ok, false);
  assert.equal(fail.error.code, "NOT_FOUND");
  // A frame that answers nothing, or answers with an unknown shape, is not a response.
  assert.equal(parseBgResponseFrame({ schema_version: BG_HOST_RESPONSE_SCHEMA, request_id: "", operation: "list", ok: true }), null);
  assert.equal(parseBgResponseFrame({ schema_version: BG_HOST_RESPONSE_SCHEMA, request_id: "r-3", operation: "list", ok: false }), null);
  assert.equal(parseBgResponseFrame({ schema_version: "other", request_id: "r-3", operation: "list", ok: true }), null);
});

test("a task view keeps the fields the panel renders and answers null for a foreign shape", () => {
  const view = parseBgTaskView({
    task: task("a1", { status: "killed", endTime: 2000, signal: "SIGTERM", pid: 42, exitCode: null }),
    kind: "shell",
    seen: false,
    canRerun: true,
    canReadResult: false,
    truncatedFields: ["command", "made-up"],
  });
  assert.equal(view.task.id, "a1");
  assert.equal(view.task.status, "killed");
  assert.equal(view.task.pid, 42);
  assert.equal(view.kind, "shell");
  assert.equal(view.canRerun, true);
  // Only the documented truncation names survive; an invented one is not a claim about the data.
  assert.deepEqual(view.truncatedFields, ["command"]);

  assert.equal(parseBgTaskView(null), null);
  assert.equal(parseBgTaskView({ task: { command: "x" } }), null);
  assert.equal(parseBgTaskView({ task: { id: "a", command: "x", status: "exploded" } }).task.status, "running");
  assert.deepEqual(parseBgTaskViews("not a list"), []);
});

test("detail answers one task view nested under `task`, and the view is what the panel reads", () => {
  // The published shape: `{ task: { task, kind, seen, canRerun, canReadResult, truncatedFields } }`.
  // Flattening it in a client is how a panel ends up showing no working directory.
  const result = { task: { task: task("d-1", { cwd: "/repo/work", description: "a long description" }), kind: "shell", seen: false, canRerun: true, canReadResult: false, truncatedFields: [] } };
  const view = parseBgTaskView(result.task);
  assert.equal(view.task.cwd, "/repo/work");
  assert.equal(parseBgTaskView(result), null, "the wrapper alone is not a view");
  assert.equal(view.task.description, "a long description");
});

test("terminal statuses are the extension's three, and running is not one of them", () => {
  assert.equal(isBgTerminalStatus("completed"), true);
  assert.equal(isBgTerminalStatus("failed"), true);
  assert.equal(isBgTerminalStatus("killed"), true);
  assert.equal(isBgTerminalStatus("running"), false);
});

test("the error codes the panel passes through are the extension's documented set", () => {
  // A code the extension does not document is a failure of ours, and saying so is the honest
  // answer; a code it does document is passed through, so the user reads the extension's reason.
  assert.equal(isBgHostErrorCode("NOT_FOUND"), true);
  assert.equal(isBgHostErrorCode("LOG_UNAVAILABLE"), true);
  assert.equal(isBgHostErrorCode("DISPOSED"), true);
  assert.equal(isBgHostErrorCode("not_found"), false);
  assert.equal(isBgHostErrorCode(undefined), false);
  assert.equal(isBgHostErrorCode("SESSION_EXPLODED"), false);
  assert.ok(BG_HOST_ERROR_CODES.includes("LEASE_INVALID"));
  assert.equal(new Set(BG_HOST_ERROR_CODES).size, BG_HOST_ERROR_CODES.length, "no code is listed twice");
});

test("the log window bound is the extension's own", () => {
  // A client that asked for more than the service answers would be told TOO_LARGE, not truncated.
  assert.equal(BG_HOST_MAX_LOG_BYTES, 65536);
});
