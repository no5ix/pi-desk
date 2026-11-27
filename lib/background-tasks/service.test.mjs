import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * The panel's server side, against the published contract, with the app's session registry
 * faked at its own seam: `globalThis.__piSessions` (a conversation's wrapper, its `cwd`, and
 * whether it is alive) and one bridge per conversation on a faked EventBus.
 *
 * The claims here are the ones the panel is built on: a conversation reads *its own*
 * extension activation and nothing else — a sibling conversation of the same project has its
 * own registry, its own dock and its own card; a registry that does not answer is reported,
 * not shown as an empty list; an operation is asked of this conversation's activation, and a
 * task that lives in a sibling is answered with the extension's own `NOT_FOUND`; and nothing
 * is claimed about a task the extension did not confirm.
 */
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const {
  readBackgroundTasksSnapshot,
  readBackgroundTaskDetail,
  readBackgroundTaskLogs,
  runBackgroundTasksAction,
  mergeBackgroundTaskViews,
} = await jiti.import("./service.ts");
const { parseBgTaskViews } = await jiti.import("./protocol.ts");
const { attachBackgroundTasksBridge, releaseAllBackgroundTasksBridges } = await jiti.import("./bridges.ts");
const {
  BG_HOST_CHANGED_CHANNEL,
  BG_HOST_CHANGED_SCHEMA,
  BG_HOST_REQUEST_CHANNEL,
  BG_HOST_RESPONSE_CHANNEL,
  BG_HOST_RESPONSE_SCHEMA,
} = await jiti.import("./protocol.ts");
// The app's registry is a lazily created Map on `globalThis` (it survives Next's hot reload).
// Asking for a conversation is what creates it, and it is the seam this test fakes.
const { getRpcSession } = await jiti.import("../rpc-manager.ts");
getRpcSession("__registry-probe__");
const registry = globalThis.__piSessions;
if (!(registry instanceof Map)) throw new Error("the session registry is not a Map");

function counts(over = {}) {
  return {
    running: 0, completed: 0, failed: 0, killed: 0,
    unseenCompleted: 0, unseenFailed: 0, unseenKilled: 0, total: 0,
    ...over,
  };
}

function viewOf(task, over = {}) {
  return {
    task: {
      id: task.id,
      command: task.command ?? `echo ${task.id}`,
      status: task.status ?? "running",
      cwd: task.cwd ?? "/repo",
      startTime: task.startTime ?? 1000,
      bytesWritten: 0,
      outputPath: `.pi/tasks/x/${task.id}.output`,
      isAgent: false,
      surviveReload: false,
      notified: false,
      notifyOnCompletion: true,
      triggerOnCompletion: false,
      ...task,
    },
    kind: "shell",
    // A finished task is unseen until somebody opens it: the extension's dock and the panel
    // share that set, and the header's badge is built from it.
    seen: false,
    canRerun: true,
    canReadResult: false,
    truncatedFields: [],
    ...over,
  };
}

/** A faked host service, answering for one activation with its own task list. */
function createActivation(options) {
  const handlers = new Map();
  const bus = {
    emit(channel, data) {
      for (const handler of [...(handlers.get(channel) ?? [])]) handler(data);
    },
    on(channel, handler) {
      const list = handlers.get(channel) ?? [];
      list.push(handler);
      handlers.set(channel, list);
      return () => handlers.set(channel, (handlers.get(channel) ?? []).filter((entry) => entry !== handler));
    },
  };
  const tasks = new Map(options.tasks.map((task) => [task.id, viewOf(task)]));
  const state = {
    activationId: options.activationId,
    sessionId: options.sessionId,
    listFails: options.listFails ?? null,
    requests: [],
    logs: options.logs ?? "hello from the task",
    seen: [],
    leases: 0,
  };
  bus.on(BG_HOST_REQUEST_CHANNEL, (frame) => {
    const { request_id: requestId, operation, payload } = frame;
    state.requests.push({ operation, payload });
    const respond = (body) => bus.emit(BG_HOST_RESPONSE_CHANNEL, {
      schema_version: BG_HOST_RESPONSE_SCHEMA,
      request_id: requestId,
      operation,
      ...body,
    });
    const fail = (code, message) => respond({ ok: false, error: { code, message } });
    if (operation === "capabilities") {
      respond({ ok: true, result: { api_version: 1, operations: ["list", "detail", "logs", "stop", "stop_all", "rerun", "mark_seen"], max_page_size: 50, max_log_bytes: 65536, max_inline_result_bytes: 49152 } });
      return;
    }
    if (operation === "subscribe") {
      state.leases += 1;
      respond({ ok: true, result: { leaseId: `${options.activationId}-lease-${String(state.leases)}`, activationId: state.activationId, sessionId: state.sessionId, revision: 1, observedAt: 1, counts: counts() } });
      return;
    }
    if (operation === "unsubscribe") {
      respond({ ok: true, result: { leaseId: payload.leaseId, released: true } });
      return;
    }
    const all = [...tasks.values()];
    if (operation === "list") {
      if (state.listFails) fail(state.listFails.code, state.listFails.message);
      else respond({
        ok: true,
        result: {
          activationId: state.activationId,
          sessionId: state.sessionId,
          revision: 1,
          observedAt: 2,
          counts: counts(options.counts ?? {
            running: all.filter((view) => view.task.status === "running").length,
            total: all.length,
            unseenFailed: all.filter((view) => view.task.status === "failed" && !view.seen).length,
            unseenKilled: all.filter((view) => view.task.status === "killed" && !view.seen).length,
            unseenCompleted: all.filter((view) => view.task.status === "completed" && !view.seen).length,
          }),
          tasks: all,
          nextCursor: null,
        },
      });
      return;
    }
    const view = payload.taskId ? tasks.get(payload.taskId) : undefined;
    if (operation === "detail") {
      if (!view) return fail("NOT_FOUND", `no retained background task has exact id ${payload.taskId}`);
      respond({ ok: true, result: { task: view } });
      return;
    }
    if (operation === "logs") {
      if (!view) return fail("NOT_FOUND", `no retained background task has exact id ${payload.taskId}`);
      const text = state.logs;
      respond({
        ok: true,
        result: {
          task: view.task,
          path: view.task.outputPath,
          text: text.slice(0, Math.min(text.length, payload.maxBytes)),
          tail: payload.tail ?? true,
          maxBytes: payload.maxBytes,
          bytesRead: Math.min(text.length, payload.maxBytes),
          totalBytes: text.length,
          windowStart: 0,
          windowEnd: Math.min(text.length, payload.maxBytes),
          truncated: text.length > payload.maxBytes,
        },
      });
      return;
    }
    if (operation === "stop") {
      if (!view) return fail("NOT_FOUND", `no retained background task has exact id ${payload.taskId}`);
      const alreadyTerminal = view.task.status !== "running";
      view.task = { ...view.task, status: "killed", endTime: (view.task.startTime ?? 0) + 500, signal: "SIGTERM" };
      respond({ ok: true, result: { task: view.task, alreadyTerminal } });
      return;
    }
    if (operation === "stop_all") {
      const results = payload.taskIds.map((taskId) => {
        const entry = tasks.get(taskId);
        if (!entry) return { taskId, outcome: "not_found" };
        const outcome = entry.task.status === "running" ? "stopped" : "already_terminal";
        entry.task = { ...entry.task, status: "killed", endTime: (entry.task.startTime ?? 0) + 500, signal: "SIGTERM" };
        return { taskId, outcome, status: "running" };
      });
      respond({
        ok: true,
        result: {
          results,
          stopped: results.filter((entry) => entry.outcome === "stopped").length,
        alreadyTerminal: results.filter((entry) => entry.outcome === "already_terminal").length,
          notFound: results.filter((entry) => entry.outcome === "not_found").length,
          failed: 0,
        },
      });
      return;
    }
    if (operation === "mark_seen") {
      const results = payload.taskIds.map((taskId) => {
        const entry = tasks.get(taskId);
        if (!entry) return { taskId, outcome: "not_found" };
        if (entry.task.status === "running") return { taskId, outcome: "not_terminal" };
        if (entry.seen) return { taskId, outcome: "already_seen" };
        entry.seen = true;
        state.seen.push(taskId);
        return { taskId, outcome: "marked" };
      });
      respond({ ok: true, result: { results, revision: 2, counts: counts() } });
      return;
    }
    if (operation === "rerun") {
      if (!view) return fail("NOT_FOUND", `no retained background task has exact id ${payload.taskId}`);
      respond({ ok: true, result: { sourceTaskId: payload.taskId, task: { ...view.task, id: `${view.task.id}-copy`, status: "running", endTime: undefined } } });
      return;
    }
    fail("INVALID_REQUEST", `unknown operation ${operation}`);
  });
  bus.emit(BG_HOST_CHANGED_CHANNEL, {
    schema_version: BG_HOST_CHANGED_SCHEMA,
    kind: "ready",
    activationId: state.activationId,
    sessionId: state.sessionId,
    revision: 0,
    observedAt: 1,
    counts: counts(),
  });
  return { bus, state, tasks };
}

/** A live conversation in the app's registry, plus its bridge. */
function openConversation(sessionId, cwd, activation) {
  registry.set(sessionId, { sessionId, cwd, isAlive: () => true, destroy() {}, shutdown() {} });
  const bridge = attachBackgroundTasksBridge(sessionId, cwd, activation.bus);
  return bridge;
}


test.afterEach(() => {
  releaseAllBackgroundTasksBridges();
  for (const key of [...registry.keys()]) registry.delete(key);
});

test("the card reads one conversation's registry; a sibling's tasks stay in the sibling", async () => {
  const here = createActivation({ activationId: "act-a", sessionId: "s-1", tasks: [{ id: "t-1", command: "npm run build", startTime: 1000 }] });
  const sibling = createActivation({ activationId: "act-b", sessionId: "s-2", tasks: [
    { id: "t-2", command: "pnpm test", startTime: 3000 },
    { id: "t-3", command: "pytest", startTime: 2000, status: "failed" },
  ] });
  openConversation("s-1", "/repo", here);
  openConversation("s-2", "/repo", sibling);
  // A conversation of another project is not this panel's business either.
  const elsewhere = createActivation({ activationId: "act-c", sessionId: "s-3", tasks: [{ id: "t-9", command: "cargo check" }] });
  openConversation("s-3", "/other", elsewhere);

  const snapshot = await readBackgroundTasksSnapshot("s-1");
  assert.equal(snapshot.state, "ready");
  assert.equal(snapshot.available, true);
  assert.deepEqual(snapshot.tasks.map((view) => view.task.id), ["t-1"], "this conversation's registry, in full and nothing else");
  assert.equal(snapshot.counts.total, 1, "a sibling's tasks are not counted in this card");
  assert.equal(snapshot.counts.unseenFailed, 0, "nor is a sibling's failure this card's badge");
  assert.deepEqual(snapshot.sessions.map((report) => report.sessionId), ["s-1"]);
  assert.equal(snapshot.sessions[0].primary, true);
  assert.equal(snapshot.activationId, "act-a", "the card names the activation it is reading from");
  assert.deepEqual(snapshot.nextCursors, {});

  // The sibling has its own card, and it reads its own registry, newest first.
  const there = await readBackgroundTasksSnapshot("s-2");
  assert.deepEqual(there.tasks.map((view) => view.task.id), ["t-2", "t-3"]);
  assert.equal(there.counts.unseenFailed, 1);
  assert.equal(there.activationId, "act-b");
});

test("several registries, when they are merged, keep one row per id and never undo a terminal state", () => {
  const view = (task) => ({ task, kind: "shell", seen: true, canRerun: true, canReadResult: true, truncatedFields: [] });
  const running = parseBgTaskViews([view({ id: "t-1", command: "make", status: "running", startTime: 1000 })]);
  const done = parseBgTaskViews([view({ id: "t-1", command: "make", status: "completed", startTime: 1000, endTime: 2000 })]);
  const merged = mergeBackgroundTaskViews([running, done]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].task.status, "completed", "a row does not flip back to running");
});

test("a registry that does not answer is said, not shown as an empty list", async () => {
  const here = createActivation({
    activationId: "act-a",
    sessionId: "s-1",
    tasks: [],
    listFails: { code: "BUSY", message: "the host interface is at its lease limit" },
  });
  openConversation("s-1", "/repo", here);
  const snapshot = await readBackgroundTasksSnapshot("s-1");
  // "No tasks" and "the registry is not answering" are different news, and the panel has to
  // carry the second one: an empty list here tells the user their work finished.
  assert.equal(snapshot.state, "not-ready");
  assert.equal(snapshot.available, false);
  assert.match(snapshot.reason ?? "", /lease limit/, "the extension's own reason, not a guess");
  assert.equal(snapshot.sessions[0].state, "not-ready");
  assert.equal(snapshot.counts.total, 0, "a registry that did not answer contributes no counts");
});

test("an operation is asked of this conversation's activation; a sibling's task is left alone", async () => {
  const here = createActivation({ activationId: "act-a", sessionId: "s-1", tasks: [{ id: "t-1", command: "npm run build" }] });
  const sibling = createActivation({ activationId: "act-b", sessionId: "s-2", tasks: [{ id: "t-2", command: "pnpm test", startTime: 2000 }] });
  openConversation("s-1", "/repo", here);
  openConversation("s-2", "/repo", sibling);

  const stopped = await runBackgroundTasksAction("s-1", { kind: "stop", taskId: "t-2" });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.code, "NOT_FOUND", "the extension says it has no such task, which is the truth here");
  // The stop was asked of this conversation's activation — the only registry the card reads —
  // and it answered with its own `NOT_FOUND`. The sibling's registry was never reached.
  assert.ok(here.state.requests.some((entry) => entry.operation === "stop" && entry.payload.taskId === "t-2"));
  assert.ok(sibling.state.requests.every((entry) => entry.operation !== "stop"), "the sibling's registry was never reached from this card");
  assert.equal(sibling.tasks.get("t-2").task.status, "running", "a sibling's running task is untouched");

  const own = await runBackgroundTasksAction("s-1", { kind: "stop", taskId: "t-1" });
  assert.equal(own.ok, true);
  assert.equal(own.result.task.status, "killed");
  assert.ok(here.state.requests.some((entry) => entry.operation === "stop" && entry.payload.taskId === "t-1"));

  const rerun = await runBackgroundTasksAction("s-1", { kind: "rerun", taskId: "t-1" });
  assert.equal(rerun.ok, true);
  assert.equal(rerun.result.sourceTaskId, "t-1");
  assert.notEqual(rerun.result.task.id, "t-1", "a rerun is a new task, never the old id");
});

test("a task nobody has is answered with the extension's code, not with an invented one", async () => {
  const here = createActivation({ activationId: "act-a", sessionId: "s-1", tasks: [{ id: "t-1" }] });
  openConversation("s-1", "/repo", here);
  const missing = await runBackgroundTasksAction("s-1", { kind: "stop", taskId: "nope" });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "NOT_FOUND");
  const detail = await readBackgroundTaskDetail("s-1", "nope");
  assert.equal(detail.ok, false);
  assert.equal(detail.code, "NOT_FOUND");
});

test("stop-all sends the frozen selection to this conversation's activation, and merges the answers", async () => {
  const here = createActivation({ activationId: "act-a", sessionId: "s-1", tasks: [{ id: "t-1" }, { id: "t-2", status: "completed", startTime: 900 }] });
  const sibling = createActivation({ activationId: "act-b", sessionId: "s-2", tasks: [{ id: "t-3", startTime: 2000 }] });
  openConversation("s-1", "/repo", here);
  openConversation("s-2", "/repo", sibling);
  const stopAll = await runBackgroundTasksAction("s-1", { kind: "stop-all", taskIds: ["t-1", "t-2", "t-3", "t-404"] });
  assert.equal(stopAll.ok, true);
  assert.equal(stopAll.result.stopped, 1, "only this conversation's running task stops");
  assert.equal(stopAll.result.alreadyTerminal, 1);
  assert.equal(stopAll.result.notFound, 2, "a sibling's id and an unknown id are both not found here");
  assert.deepEqual(stopAll.result.results.map((entry) => entry.taskId).sort(), ["t-1", "t-2", "t-3", "t-404"]);
  assert.equal(sibling.tasks.get("t-3").task.status, "running", "the sibling's running task is not this card's to stop");
  // An empty selection never reaches the extension, which refuses it.
  const empty = await runBackgroundTasksAction("s-1", { kind: "stop-all", taskIds: [] });
  assert.equal(empty.ok, false);
  assert.equal(empty.code, "INVALID_REQUEST");
});

test("mark-seen asks this conversation's activation, and the seen set is the extension's", async () => {
  const here = createActivation({ activationId: "act-a", sessionId: "s-1", tasks: [{ id: "t-1", status: "killed", startTime: 100 }, { id: "t-2", status: "running" }] });
  openConversation("s-1", "/repo", here);
  const marked = await runBackgroundTasksAction("s-1", { kind: "mark-seen", taskIds: ["t-1", "t-2"] });
  assert.equal(marked.ok, true);
  assert.equal(marked.result.marked, 1, "the killed task is marked, in the extension's own seen set");
  assert.deepEqual(here.state.seen, ["t-1"]);
  const outcomes = marked.result.results;
  assert.equal(outcomes.find((entry) => entry.taskId === "t-2")?.outcome, "not_terminal", "a running task cannot be acknowledged");
});

test("a log is a bounded window of the extension's file, and the panel asks within its bound", async () => {
  const here = createActivation({ activationId: "act-a", sessionId: "s-1", tasks: [{ id: "t-1" }], logs: "x".repeat(5000) });
  openConversation("s-1", "/repo", here);
  const logs = await readBackgroundTaskLogs("s-1", "t-1", { maxBytes: 100_000_000 });
  assert.equal(logs.ok, true);
  const asked = here.state.requests.filter((entry) => entry.operation === "logs").at(-1).payload;
  assert.equal(asked.maxBytes, 65536, "the request is capped at the extension's bound, so it never answers TOO_LARGE");
  assert.equal(asked.tail, true);
  assert.equal(logs.result.totalBytes, 5000);
  assert.ok(logs.result.text.length <= 65536);

  const missing = await readBackgroundTaskLogs("s-1", "nope");
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "NOT_FOUND");
});

test("a conversation that is not running has no tasks, and no action reaches an extension", async () => {
  const snapshot = await readBackgroundTasksSnapshot("gone-session");
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.state, "no-session");
  assert.deepEqual(snapshot.tasks, []);
  for (const payload of [
    { kind: "stop", taskId: "t-1" },
    { kind: "rerun", taskId: "t-1" },
    { kind: "stop-all", taskIds: ["t-1"] },
    { kind: "mark-seen", taskIds: ["t-1"] },
  ]) {
    const outcome = await runBackgroundTasksAction("gone-session", payload);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "UNAVAILABLE");
  }
});

test("a live conversation with no bridge is the extension-not-loaded state, not an empty list", async () => {
  registry.set("s-no-ext", { sessionId: "s-no-ext", cwd: "/repo-empty", isAlive: () => true });
  const snapshot = await readBackgroundTasksSnapshot("s-no-ext");
  assert.equal(snapshot.available, false);
  assert.equal(snapshot.state, "not-ready");
  assert.match(snapshot.reason ?? "", /not loaded/);
});
