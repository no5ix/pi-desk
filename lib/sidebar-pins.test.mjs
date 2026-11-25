import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// Pins live on the server (`lib/session-ui-state.ts`); this module is the pure
// layer: the sets the sidebar reads, and the one-time push of the pins an older
// build kept in this browser's localStorage.
const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
};

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  forgetLocalPins,
  localPinsMigrated,
  markLocalPinsMigrated,
  pinnedIdsOf,
  pinnedProjectRootsOf,
  pinRequestsForLocalPins,
  projectPinKeyOf,
  readLocalPins,
} = await jiti.import("./sidebar-pins.ts");

const state = (sessions, projects, extra = {}) => ({
  version: 1,
  revision: 1,
  sessions,
  projects,
  ...extra,
});

const clearStorage = () => storage.clear();

test.afterEach(clearStorage);

test("the pinned sets come from the server's entries, not from this browser", () => {
  const model = state(
    {
      root1: { pinnedAt: 10 },
      root2: { archivedAt: 20 },
      root3: { pinnedAt: 5, archivedAt: 30 },
      root4: {},
      broken: { pinnedAt: "yesterday" },
    },
    {
      "/repo-a": { pinnedAt: 1, root: "/repo-a" },
      "/repo-b": { pinnedAt: 2, root: "/work/repo-b" },
      "/no-root": { pinnedAt: 3, root: "" },
    },
  );
  assert.deepEqual([...pinnedIdsOf(model)], ["root1", "root3"], "pinnedAt set, archived or not (the tree decides what shows)");
  assert.deepEqual([...pinnedProjectRootsOf(model)], ["/repo-a", "/work/repo-b"], "a pinned project's stored root, so a project with no session is still marked");
  assert.deepEqual([...pinnedIdsOf(state({}, {}))], []);
});

test("local pins merge the retired keys and ignore junk", () => {
  storage.set("pi-web:pinned-chats", JSON.stringify(["chat-1", 7, null, ""]));
  storage.set("pi-web:pinned-sessions", JSON.stringify(["sess-1", "chat-1", "sess-2"]));
  storage.set("pi-web:pinned-projects", JSON.stringify(["/repo-a", "/repo-a", 3]));
  assert.deepEqual(readLocalPins(), { ids: ["chat-1", "sess-1", "sess-2"], roots: ["/repo-a"] });

  clearStorage();
  assert.deepEqual(readLocalPins(), { ids: [], roots: [] }, "a browser that never pinned anything");

  storage.set("pi-web:pinned-sessions", "not json");
  assert.deepEqual(readLocalPins(), { ids: [], roots: [] });
});

test("the migration writes one set per 500 ids and one pin-project per root", () => {
  const ids = Array.from({ length: 750 }, (_, index) => `s${index}`);
  const requests = pinRequestsForLocalPins({ ids, roots: ["/repo-a", "/repo-b"] });
  assert.deepEqual(requests.map((request) => request.action), ["set", "set", "pin-project", "pin-project"]);
  assert.equal(requests[0].ids.length, 500);
  assert.equal(requests[1].ids.length, 250);
  assert.deepEqual(requests[0].ids.slice(0, 2), ["s0", "s1"]);
  assert.deepEqual(requests[2], { action: "pin-project", projectKey: projectPinKeyOf("/repo-a"), root: "/repo-a", pinned: true });

  assert.deepEqual(pinRequestsForLocalPins({ ids: [], roots: [] }), [], "nothing pinned locally is nothing to migrate");

  // One id the server would refuse takes its whole request down, and a refused
  // migration never finishes: what cannot be stored is dropped, not pushed.
  const junk = pinRequestsForLocalPins({ ids: ["ok-1", "", " leading", "trail ", "__proto__"], roots: ["", "/x".repeat(3000)] });
  assert.deepEqual(junk.map((request) => request.action), ["set"]);
  assert.deepEqual(junk[0].ids, ["ok-1"]);
  assert.deepEqual(pinRequestsForLocalPins({ ids: [], roots: ["", "x".repeat(5000)] }), [], "a root over the project-key length is not stored");
});

test("the migration marker is per browser, and the retired keys go with it", () => {
  assert.equal(localPinsMigrated(), false);
  storage.set("pi-web:pinned-sessions", JSON.stringify(["sess-1"]));
  storage.set("pi-web:pinned-projects", JSON.stringify(["/repo-a"]));

  markLocalPinsMigrated();
  assert.equal(localPinsMigrated(), true);
  forgetLocalPins();
  assert.deepEqual([...storage.keys()].sort(), ["pi-web:pins-migrated-to-server"]);
});
