import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// The sidebar's pins through the server: the hook is rendered against the React
// stand-in with a scripted fetch, so a test sees exactly which request a click
// sends and which state the next render reads.
const shimPath = fileURLToPath(new URL("./__fixtures__/react-hook-shim.mjs", import.meta.url));
const jiti = createJiti(import.meta.url, { tsconfigPaths: true, alias: { react: shimPath } });
const { renderHook } = await import(shimPath);

const storage = new Map();
const listeners = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
  addEventListener: (type, handler) => listeners.set(type, handler),
  removeEventListener: (type) => listeners.delete(type),
};
globalThis.document = {
  visibilityState: "visible",
  addEventListener: (type, handler) => listeners.set(type, handler),
  removeEventListener: (type) => listeners.delete(type),
};

const { useSidebarPins } = await jiti.import("./useSidebarPins.ts");

const answers = [];
const requests = [];
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? "GET";
  requests.push({ url, method, body: init.body === undefined ? undefined : JSON.parse(init.body) });
  const answer = answers.shift();
  if (!answer) throw new Error(`no answer scripted for ${method} ${url}`);
  return answer();
};

const json = (status, body) => () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const served = (state) => json(200, { state });
const refused = (status, error) => json(status, { error });
const uiState = (revision, extra = {}) => ({ version: 1, revision, sessions: {}, projects: {}, ...extra });

/**
 * Let the scripted fetches and their JSON bodies resolve, rendering after each
 * hop: the shim runs an effect only in a render, and the migration effect (and
 * every write behind it) starts there. Flushing once at the end would measure
 * a state whose writes had barely begun.
 */
async function settle(hook) {
  for (let index = 0; index < 20; index++) {
    await new Promise((resolve) => setImmediate(resolve));
    hook.flush();
  }
}

const mounted = [];
test.beforeEach(() => {
  storage.clear();
  requests.length = 0;
  answers.length = 0;
});
test.afterEach(() => {
  for (const hook of mounted.splice(0)) hook.unmount();
  assert.equal(answers.length, 0, "every scripted answer was used");
});

function render(onWriteFailed) {
  const hook = renderHook(useSidebarPins, onWriteFailed);
  mounted.push(hook);
  return hook;
}

const posts = () => requests.filter((request) => request.method === "POST");

test("the pins a window shows are the server's, and a toggle writes there", async () => {
  answers.push(served(uiState(3, { sessions: { a: { pinnedAt: 10 } }, projects: { "/repo-a": { pinnedAt: 11, root: "/repo-a" } } })));
  const hook = render();
  await settle(hook);

  assert.deepEqual([...hook.result.pinnedIds], ["a"]);
  assert.deepEqual([...hook.result.pinnedProjectRoots], ["/repo-a"]);
  assert.equal(hook.result.synced, true);
  assert.deepEqual(posts(), [], "a browser with nothing local has nothing to push");

  answers.push(served(uiState(4, { sessions: { a: { pinnedAt: 10 }, b: { pinnedAt: 20 } } })));
  const pinned = await hook.result.toggleSessionPin("b");
  hook.flush();
  assert.equal(pinned, true);
  assert.deepEqual(posts()[0].body, { action: "set", ids: ["b"], pinned: true });
  assert.deepEqual([...hook.result.pinnedIds], ["a", "b"]);

  // The same call on a pinned family is an unpin.
  answers.push(served(uiState(5, { sessions: { a: { pinnedAt: 10 } } })));
  await hook.result.toggleSessionPin("b");
  hook.flush();
  assert.deepEqual(posts()[1].body, { action: "set", ids: ["b"], pinned: false });
  assert.deepEqual([...hook.result.pinnedIds], ["a"]);
});

test("a project pin goes to the server keyed by the root the sidebar groups by", async () => {
  answers.push(served(uiState(1)));
  const hook = render();
  await settle(hook);

  answers.push(served(uiState(2, { projects: { "/repo-b": { pinnedAt: 30, root: "/repo-b" } } })));
  const pinned = await hook.result.toggleProjectPin("/repo-b");
  hook.flush();
  assert.equal(pinned, true);
  assert.deepEqual(posts()[0].body, { action: "pin-project", projectKey: "/repo-b", root: "/repo-b", pinned: true });
  assert.deepEqual([...hook.result.pinnedProjectRoots], ["/repo-b"]);

  answers.push(served(uiState(3)));
  await hook.result.toggleProjectPin("/repo-b");
  hook.flush();
  assert.deepEqual(posts()[1].body, { action: "pin-project", projectKey: "/repo-b", root: "/repo-b", pinned: false });
  assert.deepEqual([...hook.result.pinnedProjectRoots], []);
});

test("the first sync pushes the pins this browser kept on its own, once", async () => {
  storage.set("pi-web:pinned-sessions", JSON.stringify(["s1", "s2"]));
  storage.set("pi-web:pinned-chats", JSON.stringify(["c1", "s1"]));
  storage.set("pi-web:pinned-projects", JSON.stringify(["/repo-a"]));

  // The server already holds another device's pin: the push adds to it.
  answers.push(served(uiState(7, { sessions: { other: { pinnedAt: 1 } } })));
  const hook = render();
  answers.push(served(uiState(8, { sessions: { other: { pinnedAt: 1 }, s1: { pinnedAt: 9 }, s2: { pinnedAt: 9 }, c1: { pinnedAt: 9 } } })));
  answers.push(served(uiState(9, {
    sessions: { other: { pinnedAt: 1 }, s1: { pinnedAt: 9 }, s2: { pinnedAt: 9 }, c1: { pinnedAt: 9 } },
    projects: { "/repo-a": { pinnedAt: 9, root: "/repo-a" } },
  })));
  await settle(hook);

  assert.deepEqual(posts().map((request) => request.body), [
    { action: "set", ids: ["c1", "s1", "s2"], pinned: true },
    { action: "pin-project", projectKey: "/repo-a", root: "/repo-a", pinned: true },
  ]);
  assert.deepEqual([...hook.result.pinnedIds].sort(), ["c1", "other", "s1", "s2"]);
  assert.deepEqual([...hook.result.pinnedProjectRoots], ["/repo-a"]);
  assert.equal(storage.get("pi-web:pins-migrated-to-server"), "1");
  for (const key of ["pi-web:pinned-sessions", "pi-web:pinned-chats", "pi-web:pinned-projects"]) {
    assert.equal(storage.has(key), false, `${key} is retired with the push`);
  }

  // A second window of the same browser never pushes again.
  answers.push(served(uiState(9, { sessions: { other: { pinnedAt: 1 }, s1: { pinnedAt: 9 } } })));
  const second = render();
  await settle(second);
  assert.deepEqual(posts().length, 2, "the marker, not a re-push, decides");
});

test("a refused push leaves the browser un-migrated, so the next load tries again", async () => {
  storage.set("pi-web:pinned-sessions", JSON.stringify(["s1"]));
  const failures = [];
  answers.push(served(uiState(1)));
  answers.push(refused(409, "locked"));
  const hook = render((message) => failures.push(message));
  answers.push(served(uiState(1)));
  await settle(hook);

  assert.deepEqual(posts().map((request) => request.body), [{ action: "set", ids: ["s1"], pinned: true }]);
  assert.equal(storage.has("pi-web:pins-migrated-to-server"), false);
  assert.deepEqual(JSON.parse(storage.get("pi-web:pinned-sessions")), ["s1"], "the local pins stay until they landed");
  assert.deepEqual(failures, [], "a migration push is quiet; the tree still shows the optimistic pin");
});

test("a pin refused by the server reaches the caller with the server's reason", async () => {
  answers.push(served(uiState(1)));
  const failures = [];
  const hook = render((message) => failures.push(message));
  await settle(hook);

  answers.push(refused(409, "Another process holds the session UI state lock"));
  // The rollback read is part of the same call, so its answer is queued first.
  answers.push(served(uiState(1)));
  const ok = await hook.result.toggleSessionPin("s9");
  await settle(hook);

  assert.equal(ok, false);
  assert.deepEqual(failures, ["Another process holds the session UI state lock"]);
  assert.deepEqual([...hook.result.pinnedIds], [], "the optimistic pin rolls back to what the server holds");
});

test("a revision from the running frames re-reads the state, so a pin made elsewhere arrives", async () => {
  answers.push(served(uiState(4, { sessions: { a: { pinnedAt: 10 } } })));
  const hook = render();
  await settle(hook);
  assert.deepEqual([...hook.result.pinnedIds], ["a"]);

  // The same revision is no news: no second GET.
  hook.result.noteRevision(4);
  hook.flush();
  assert.equal(requests.length, 1);

  answers.push(served(uiState(5, { sessions: { a: { pinnedAt: 10 }, b: { pinnedAt: 22 } } })));
  hook.result.noteRevision(5);
  await settle(hook);
  assert.deepEqual(requests.map((request) => request.method), ["GET", "GET"]);
  assert.deepEqual([...hook.result.pinnedIds], ["a", "b"]);
});

test("a window coming back from the background re-reads the state", async () => {
  answers.push(served(uiState(1)));
  const hook = render();
  await settle(hook);
  assert.equal(requests.length, 1);

  answers.push(served(uiState(2, { sessions: { away: { pinnedAt: 5 } } })));
  listeners.get("visibilitychange")();
  await settle(hook);
  assert.equal(requests.length, 2);
  assert.deepEqual([...hook.result.pinnedIds], ["away"]);
});
