import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { BackgroundTaskHostClient, isNewBgChangeFrame } = await jiti.import("./host-client.ts");
const {
  BG_HOST_CHANGED_CHANNEL,
  BG_HOST_CHANGED_SCHEMA,
  BG_HOST_REQUEST_CHANNEL,
  BG_HOST_RESPONSE_CHANNEL,
  BG_HOST_RESPONSE_SCHEMA,
} = await jiti.import("./protocol.ts");

/**
 * The EventBus, faked: an emit is synchronous, like the SDK's (`EventEmitter` under a thin
 * wrapper, and a handler runs to its first await). The service below is a stand-in for
 * `pi-background-tasks`' host interface built from the published contract — the same
 * validation of leases and sequences, the same answer shapes — so the client's rules can be
 * pinned deterministically. The real extension is exercised in `integration.test.mjs`.
 */
function createEventBus() {
  const handlers = new Map();
  return {
    emit(channel, data) {
      for (const handler of [...(handlers.get(channel) ?? [])]) handler(data);
    },
    on(channel, handler) {
      const list = handlers.get(channel) ?? [];
      list.push(handler);
      handlers.set(channel, list);
      return () => handlers.set(channel, list.filter((entry) => entry !== handler));
    },
    listenerCount(channel) {
      return (handlers.get(channel) ?? []).length;
    },
  };
}

function counts(over = {}) {
  return {
    running: 0,
    completed: 0,
    failed: 0,
    killed: 0,
    unseenCompleted: 0,
    unseenFailed: 0,
    unseenKilled: 0,
    total: 0,
    ...over,
  };
}

/** A service that follows the documented lease, sequence and reply rules. */
function createFakeHostService(bus) {
  const state = {
    ready: false,
    closed: false,
    activationId: "act-1",
    leases: new Map(),
    sequences: new Map(),
    requests: [],
    silent: new Set(),
    forceCodes: new Map(),
    logRequests: [],
  };
  let leaseCounter = 0;
  bus.on(BG_HOST_REQUEST_CHANNEL, (frame) => {
    const { request_id: requestId, operation, payload } = frame;
    state.requests.push({ requestId, operation, payload });
    const respond = (body) => bus.emit(BG_HOST_RESPONSE_CHANNEL, {
      schema_version: BG_HOST_RESPONSE_SCHEMA,
      request_id: requestId,
      operation,
      ...body,
    });
    if (state.silent.has(operation)) return;
    const forced = state.forceCodes.get(operation);
    if (forced) {
      state.forceCodes.delete(operation);
      if (["LEASE_INVALID", "ACTIVATION_MISMATCH", "STALE_REQUEST", "CLOSED"].includes(forced)) {
        // The documented recovery path: a lease the service has disposed is gone, and a later
        // `subscribe` with the same clientId gets a fresh one, never its old sequence.
        for (const [clientId, leaseId] of [...state.leases]) {
          if (leaseId === payload?.leaseId) state.leases.delete(clientId);
        }
        state.sequences.delete(payload?.leaseId);
      }
      respond({ ok: false, error: { code: forced, message: `forced ${forced}` } });
      return;
    }
    if (state.closed && operation !== "capabilities") {
      respond({ ok: false, error: { code: "CLOSED", message: "the activation is closed" } });
      return;
    }
    if (operation === "capabilities") {
      respond({ ok: true, result: { api_version: 1, operations: ["capabilities", "list"], max_page_size: 50, max_log_bytes: 65536, max_inline_result_bytes: 49152 } });
      return;
    }
    if (!state.ready) {
      respond({ ok: false, error: { code: "UNAVAILABLE", message: "no initialized session context yet" } });
      return;
    }
    if (operation === "subscribe") {
      const existing = state.leases.get(payload.clientId);
      if (existing) {
        respond({ ok: true, result: { leaseId: existing, activationId: state.activationId, sessionId: "s-1", revision: 0, observedAt: 1, counts: counts() } });
        return;
      }
      leaseCounter += 1;
      const leaseId = `lease-${String(leaseCounter)}`;
      state.leases.set(payload.clientId, leaseId);
      state.sequences.set(leaseId, 0);
      respond({ ok: true, result: { leaseId, activationId: state.activationId, sessionId: "s-1", revision: 0, observedAt: 1, counts: counts() } });
      return;
    }
    if (operation === "unsubscribe") {
      state.leases.delete(`by-${payload.leaseId}`);
      state.sequences.delete(payload.leaseId);
      respond({ ok: true, result: { leaseId: payload.leaseId, released: true } });
      return;
    }
    const highWater = state.sequences.get(payload.leaseId);
    if (highWater === undefined) {
      respond({ ok: false, error: { code: "LEASE_INVALID", message: "unknown lease" } });
      return;
    }
    if (payload.sequence <= highWater) {
      respond({ ok: false, error: { code: "STALE_REQUEST", message: "sequence at or below the high-water mark" } });
      return;
    }
    state.sequences.set(payload.leaseId, payload.sequence);
    if (operation === "list") {
      respond({
        ok: true,
        result: {
          activationId: state.activationId,
          sessionId: "s-1",
          revision: 1,
          observedAt: 2,
          counts: counts({ running: 1, total: 1 }),
          tasks: [{ task: { id: "t-1", command: "sleep 3", status: "running", cwd: "/repo", startTime: 10, bytesWritten: 0, outputPath: "o" }, kind: "shell", seen: false, canRerun: true, canReadResult: false, truncatedFields: [] }],
          nextCursor: null,
        },
      });
      return;
    }
    if (operation === "detail") {
      respond({
        ok: true,
        // The published nesting: the view under `task`, and the snapshot under that.
        result: { task: { task: { id: payload.taskId, command: "sleep 3", status: "running", cwd: "/repo", startTime: 10, bytesWritten: 0, outputPath: "o" }, kind: "shell", seen: false, canRerun: true, canReadResult: false, truncatedFields: [] } },
      });
      return;
    }
    if (operation === "logs") {
      state.logRequests.push(payload);
      respond({
        ok: true,
        result: {
          task: { id: payload.taskId, command: "sleep 3", status: "running", cwd: "/repo", startTime: 10, bytesWritten: 40, outputPath: "o" },
          path: "o", text: "hello", tail: payload.tail ?? true, maxBytes: payload.maxBytes,
          bytesRead: 5, totalBytes: 40, windowStart: 35, windowEnd: 40, truncated: true,
        },
      });
      return;
    }
    if (operation === "rerun") {
      respond({ ok: true, result: { sourceTaskId: payload.taskId, task: { id: "t-2", command: "sleep 3", status: "running", cwd: "/repo", startTime: 30, bytesWritten: 0, outputPath: "o2" } } });
      return;
    }
    if (operation === "stop_all") {
      // Documented validation: the frozen selection carries 1 to 1000 ids.
      if (!Array.isArray(payload.taskIds) || payload.taskIds.length === 0) {
        respond({ ok: false, error: { code: "INVALID_REQUEST", message: "stop_all.payload.taskIds must contain 1 to 1000 task ids" } });
        return;
      }
      // The frozen selection, one row per id, and the counts of each outcome.
      const results = payload.taskIds.map((taskId) => ({ taskId, outcome: taskId === "t-1" ? "stopped" : "not_found" }));
      respond({
        ok: true,
        result: {
          results,
          stopped: results.filter((entry) => entry.outcome === "stopped").length,
          alreadyTerminal: 0,
          notFound: results.filter((entry) => entry.outcome === "not_found").length,
          failed: 0,
        },
      });
      return;
    }
    if (operation === "mark_seen") {
      respond({
        ok: true,
        result: {
          results: payload.taskIds.map((taskId) => ({ taskId, outcome: taskId === "t-running" ? "not_terminal" : "marked" })),
          revision: 3,
          counts: counts({ total: 1, completed: 1, unseenCompleted: 0 }),
        },
      });
      return;
    }
    if (operation === "stop") {
      respond({
        ok: true,
        result: { task: { id: payload.taskId, command: "sleep 3", status: "killed", cwd: "/repo", startTime: 10, endTime: 20, signal: "SIGTERM", bytesWritten: 0, outputPath: "o" }, alreadyTerminal: false },
      });
      return;
    }
    respond({ ok: true, result: { activationId: state.activationId, sessionId: "s-1", revision: 2, observedAt: 3, counts: counts() } });
  });
  const change = (kind, over = {}) => {
    if (kind === "closed") {
      // Shutdown disposes every lease: a later request on that id is LEASE_INVALID.
      state.leases.clear();
      state.sequences.clear();
    }
    bus.emit(BG_HOST_CHANGED_CHANNEL, {
      schema_version: BG_HOST_CHANGED_SCHEMA,
      kind,
      activationId: over.activationId ?? state.activationId,
      sessionId: "s-1",
      revision: over.revision ?? 0,
      observedAt: 1,
      counts: counts(over.counts ?? {}),
    });
  };
  return { state, change, start: () => { state.ready = true; change("ready"); } };
}

function client(bus, over = {}) {
  return new BackgroundTaskHostClient(bus, { clientId: "pi-web:test", requestTimeoutMs: 60, ...over });
}

test("capabilities answers before the extension has a session context", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  const host = client(bus);
  const capabilities = await host.capabilities();
  assert.equal(capabilities.api_version, 1);
  assert.ok(capabilities.operations.includes("list"));
  // The probe is lease-free: a panel deciding whether to open must not occupy a lease slot.
  assert.deepEqual(service.state.requests.map((entry) => entry.operation), ["capabilities"]);
  assert.equal(service.state.leases.size, 0);
  host.dispose();
});

test("subscribe before the ready frame is UNAVAILABLE, and the client says so rather than hanging", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  const host = client(bus);
  await assert.rejects(host.list(), (error) => {
    assert.equal(error.code, "UNAVAILABLE");
    return true;
  });
  // The request went out and was answered; the client did not sit on a lease it never got.
  assert.deepEqual(service.state.requests.map((entry) => entry.operation), ["subscribe"]);
  assert.equal(host.getState().leased, false);
  host.dispose();
});

test("leased operations take one lease and hand out a strictly increasing sequence", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  service.start();
  const host = client(bus);
  const first = await host.list();
  assert.equal(first.tasks.length, 1);
  await host.list();
  await host.stop("t-1");
  const leased = service.state.requests.filter((entry) => ["list", "stop"].includes(entry.operation));
  const sequences = leased.map((entry) => entry.payload.sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.equal(new Set(sequences).size, sequences.length);
  const leaseIds = new Set(leased.map((entry) => entry.payload.leaseId));
  assert.equal(leaseIds.size, 1);
  // Every request id is unique: the service answers one frame per request id.
  const ids = service.state.requests.map((entry) => entry.requestId);
  assert.equal(new Set(ids).size, ids.length);
  host.dispose();
});

test("a dead lease is retaken once, and the operation still answers", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  service.start();
  const host = client(bus);
  await host.list();
  service.state.forceCodes.set("list", "LEASE_INVALID");
  const again = await host.list();
  assert.equal(again.tasks[0].task.id, "t-1");
  const lists = service.state.requests.filter((entry) => entry.operation === "list");
  // The first list, the one the service refused, and the retry it answered.
  assert.equal(lists.length, 3);
  const failed = lists[1];
  const retry = lists[2];
  // The retry is a new request on a fresh lease, never a replay of the stale sequence.
  assert.notEqual(failed.payload.leaseId, retry.payload.leaseId);
  assert.notEqual(failed.requestId, retry.requestId);
  host.dispose();
});

test("a request that is never answered becomes TIMEOUT, and the queue keeps working", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  service.start();
  const host = client(bus, { requestTimeoutMs: 40 });
  service.state.silent.add("list");
  await assert.rejects(host.list(), (error) => {
    assert.equal(error.code, "TIMEOUT");
    return true;
  });
  service.state.silent.delete("list");
  assert.equal((await host.list()).tasks.length, 1);
  host.dispose();
});

test("a change frame is delivered once per (activation, revision)", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  const seen = [];
  const host = client(bus);
  host.onChanges((frame) => seen.push(`${frame.kind}:${frame.revision}`));
  // The activation's first frame is the discovery: a consumer that subscribed before it
  // (any consumer, in any extension load order) is told the interface is ready.
  service.start();
  service.change("changed", { revision: 1 });
  service.change("changed", { revision: 1 });
  service.change("changed", { revision: 0 });
  service.change("changed", { revision: 2 });
  assert.deepEqual(seen, ["ready:0", "changed:1", "changed:2"]);
  host.dispose();
});

test("a frame of a fresh activation is not 'older' than the activation it follows", () => {
  const ready = { activationId: "act-1", revision: 9, kind: "ready" };
  assert.equal(isNewBgChangeFrame(ready, { activationId: "act-2", revision: 0, kind: "ready" }), true);
  // The same news twice is one news.
  assert.equal(isNewBgChangeFrame(ready, { activationId: "act-1", revision: 9, kind: "ready" }), false);
  assert.equal(isNewBgChangeFrame(ready, { activationId: "act-1", revision: 8, kind: "changed" }), false);
  // The shutdown frame rides the activation's last revision, and losing it is a panel that
  // keeps leasing an activation that is already gone.
  assert.equal(isNewBgChangeFrame(ready, { activationId: "act-1", revision: 9, kind: "closed" }), true);
  assert.equal(isNewBgChangeFrame(null, { activationId: "act-1", revision: 0, kind: "ready" }), true);
});

test("the closed frame drops the lease, and the next operation follows the new activation", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  service.start();
  const host = client(bus);
  await host.list();
  const firstLease = service.state.requests.find((entry) => entry.operation === "list").payload.leaseId;
  service.state.closed = true;
  service.change("closed");
  assert.equal(host.getState().leased, false);
  assert.equal(host.getState().closedActivationId, "act-1");
  // The activation is gone: asking again is a `CLOSED` answer, not a request that dies in the
  // dark and comes back as a timeout.
  await assert.rejects(host.list(), (error) => {
    assert.equal(error.code, "CLOSED");
    return true;
  });
  service.state.closed = false;
  service.state.ready = true;
  service.state.activationId = "act-2";
  service.change("ready", { activationId: "act-2" });
  const next = await host.list();
  assert.equal(next.tasks.length, 1);
  const lastLease = [...service.state.requests].reverse().find((entry) => entry.operation === "list").payload.leaseId;
  assert.notEqual(firstLease, lastLease);
  host.dispose();
});

test("a response frame the client is not waiting on is dropped", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  service.start();
  const host = client(bus);
  const list = host.list();
  await new Promise((resolve) => setImmediate(resolve));
  const listRequest = service.state.requests.find((entry) => entry.operation === "list");
  // A late frame for a request nobody owns, and one for a request under a different operation.
  bus.emit(BG_HOST_RESPONSE_CHANNEL, { schema_version: BG_HOST_RESPONSE_SCHEMA, request_id: "ghost", operation: "list", ok: true, result: {} });
  bus.emit(BG_HOST_RESPONSE_CHANNEL, { schema_version: BG_HOST_RESPONSE_SCHEMA, request_id: listRequest.requestId, operation: "detail", ok: false, error: { code: "NOT_FOUND", message: "wrong operation" } });
  assert.equal((await list).tasks.length, 1);
  host.dispose();
});

test("the log request is bounded and tails by default", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  service.start();
  const host = client(bus);
  const fromTheEnd = await host.logs("t-1", { maxBytes: 999_999 });
  assert.equal(service.state.logRequests.at(-1).maxBytes, 65536);
  assert.equal(service.state.logRequests.at(-1).tail, true);
  assert.equal(fromTheEnd.totalBytes, 40);
  await host.logs("t-1", { tail: false });
  assert.equal(service.state.logRequests.at(-1).tail, false);
  host.dispose();
});

test("dispose releases the lease, leaves no listener and answers nothing more", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  service.start();
  const host = client(bus);
  await host.list();
  const listenerCount = bus.listenerCount(BG_HOST_RESPONSE_CHANNEL) + bus.listenerCount(BG_HOST_CHANGED_CHANNEL);
  assert.equal(listenerCount, 2);
  host.dispose();
  assert.equal(bus.listenerCount(BG_HOST_RESPONSE_CHANNEL), 0);
  assert.equal(bus.listenerCount(BG_HOST_CHANGED_CHANNEL), 0);
  assert.ok(service.state.requests.some((entry) => entry.operation === "unsubscribe"));
  await assert.rejects(host.list(), (error) => {
    assert.equal(error.code, "DISPOSED");
    return true;
  });
  host.dispose();
});

test("the write operations answer the documented result shapes", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  service.start();
  const host = client(bus);
  const detail = await host.detail("t-1");
  assert.equal(detail.task.task.id, "t-1", "the snapshot is under the view, under `task`");
  assert.equal(detail.task.kind, "shell");
  const rerun = await host.rerun("t-1");
  assert.equal(rerun.sourceTaskId, "t-1");
  assert.notEqual(rerun.task.id, "t-1", "a rerun is a new task, never the old id");
  await assert.rejects(host.stopAll([]), (error) => {
    // An empty selection is refused by the service, so the panel never sends one: "Stop all"
    // appears only when something is running.
    assert.equal(error.code, "INVALID_REQUEST");
    return true;
  });
  const stopAll = await host.stopAll(["t-1", "gone"]);
  assert.deepEqual(stopAll.results.map((entry) => entry.outcome), ["stopped", "not_found"]);
  assert.equal(stopAll.stopped, 1);
  assert.equal(stopAll.notFound, 1);
  const seen = await host.markSeen(["t-1", "t-running"]);
  assert.deepEqual(seen.results.map((entry) => entry.outcome), ["marked", "not_terminal"]);
  assert.equal(seen.counts.unseenCompleted, 0);
  // The ids are the exact set the caller confirmed; the extension maps over the array it is
  // handed, so a bare string is a request per character and a panel that marks nothing.
  const one = await host.markSeen(["t-1"]);
  assert.deepEqual(one.results, [{ taskId: "t-1", outcome: "marked" }]);
  host.dispose();
});

test("two clients on one bus each keep their own lease and sequence", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  service.start();
  const a = new BackgroundTaskHostClient(bus, { clientId: "pi-web:a" });
  const b = new BackgroundTaskHostClient(bus, { clientId: "pi-web:b" });
  await a.list();
  await b.list();
  const leased = service.state.requests.filter((entry) => entry.operation === "list");
  assert.equal(new Set(leased.map((entry) => entry.payload.leaseId)).size, 2);
  a.dispose();
  b.dispose();
});

test("a change handler that throws does not stop the feed", async () => {
  const bus = createEventBus();
  const service = createFakeHostService(bus);
  service.start();
  const warnings = [];
  const host = client(bus, { logger: { warn: (message) => warnings.push(message) } });
  host.onChanges(() => {
    throw new Error("a panel that exploded");
  });
  let arrived = 0;
  host.onChanges(() => {
    arrived += 1;
  });
  service.change("changed", { revision: 5 });
  assert.equal(arrived, 1);
  assert.equal(warnings.length, 1);
  host.dispose();
});
