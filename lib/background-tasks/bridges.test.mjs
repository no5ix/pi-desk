import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * The bridges: one host client per live conversation, the panel's only way to the extension.
 *
 * The registry is the app's own state, so it is the app's responsibility to keep it honest: a
 * bridge is created when a conversation starts, released when it closes, replaced (with its
 * client disposed) when a conversation is recreated, and a bridge that leaks is a client that
 * keeps two listeners on a bus whose extension is gone.
 */
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const {
  attachBackgroundTasksBridge,
  getBackgroundTasksBridge,
  listBackgroundTasksBridges,
  listBackgroundTasksBridgesForCwd,
  releaseAllBackgroundTasksBridges,
  releaseBackgroundTasksBridge,
  subscribeBackgroundTasksBridgeRegistry,
} = await jiti.import("./bridges.ts");

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
      return () => handlers.set(channel, (handlers.get(channel) ?? []).filter((entry) => entry !== handler));
    },
    listenerCount(channel) {
      return (handlers.get(channel) ?? []).length;
    },
  };
}

test.beforeEach(() => releaseAllBackgroundTasksBridges());
test.afterEach(() => releaseAllBackgroundTasksBridges());

test("a bridge is keyed by the conversation and found by its project", () => {
  const a = attachBackgroundTasksBridge("s-1", "/repo", createEventBus());
  const b = attachBackgroundTasksBridge("s-2", "/repo", createEventBus());
  attachBackgroundTasksBridge("s-3", "/other", createEventBus());

  assert.equal(getBackgroundTasksBridge("s-1")?.sessionId, "s-1");
  assert.equal(getBackgroundTasksBridge("s-1")?.cwd, "/repo");
  assert.equal(getBackgroundTasksBridge("s-9"), undefined);
  assert.deepEqual(listBackgroundTasksBridgesForCwd("/repo").map((bridge) => bridge.sessionId), ["s-1", "s-2"]);
  assert.deepEqual(listBackgroundTasksBridgesForCwd("/repo/nested").map((bridge) => bridge.sessionId), [],
    "a project's registries are its own; a nested path is a different project");
  assert.equal(listBackgroundTasksBridges().length, 3);
  assert.ok(a.createdAt <= b.createdAt);
  assert.equal(releaseBackgroundTasksBridge("s-1"), true);
  assert.equal(releaseBackgroundTasksBridge("s-1"), false, "releasing a bridge that is gone answers false");
  assert.equal(getBackgroundTasksBridge("s-1"), undefined);
});

test("a bridge that is replaced disposes the client it is replacing", async () => {
  const first = attachBackgroundTasksBridge("s-1", "/repo", createEventBus());
  const bus = createEventBus();
  const second = attachBackgroundTasksBridge("s-1", "/repo", bus);
  assert.notEqual(first.client, second.client);
  assert.equal(listBackgroundTasksBridges().length, 1, "one bridge per conversation");
  await assert.rejects(first.client.list(), (error) => {
    assert.equal(error.code, "DISPOSED");
    return true;
  });
  assert.equal(bus.listenerCount("pi-background-tasks:host:response:v1"), 1);
  assert.equal(bus.listenerCount("pi-background-tasks:host:changed:v1"), 1);
});

test("releasing a bridge closes its listeners, so a closed conversation is not a reader", () => {
  const bus = createEventBus();
  const bridge = attachBackgroundTasksBridge("s-1", "/repo", bus);
  assert.equal(bus.listenerCount("pi-background-tasks:host:response:v1"), 1);
  assert.equal(bus.listenerCount("pi-background-tasks:host:changed:v1"), 1);
  releaseBackgroundTasksBridge("s-1");
  assert.equal(bus.listenerCount("pi-background-tasks:host:response:v1"), 0);
  assert.equal(bus.listenerCount("pi-background-tasks:host:changed:v1"), 0);
  assert.equal(releaseAllBackgroundTasksBridges(), 0);

  attachBackgroundTasksBridge("s-2", "/repo", bus);
  attachBackgroundTasksBridge("s-3", "/repo", bus);
  assert.equal(releaseAllBackgroundTasksBridges(), 2);
  assert.equal(listBackgroundTasksBridges().length, 0);
  assert.equal(bridge.sessionId, "s-1");
});

test("the registry tells its watchers, and a watcher that throws does not stop the rest", () => {
  const seen = [];
  const off = subscribeBackgroundTasksBridgeRegistry(() => seen.push("a"));
  const broken = subscribeBackgroundTasksBridgeRegistry(() => {
    throw new Error("a pump that exploded");
  });
  const also = subscribeBackgroundTasksBridgeRegistry(() => seen.push("b"));
  attachBackgroundTasksBridge("s-1", "/repo", createEventBus());
  assert.deepEqual(seen, ["a", "b"]);
  releaseBackgroundTasksBridge("s-1");
  assert.deepEqual(seen, ["a", "b", "a", "b"]);
  off();
  broken();
  also();
  attachBackgroundTasksBridge("s-2", "/repo", createEventBus());
  // Every watcher unsubscribed: the registry keeps telling, and nobody is left listening.
  assert.deepEqual(seen, ["a", "b", "a", "b"], "a listener that unsubscribed is not called again");
  releaseAllBackgroundTasksBridges();
});
