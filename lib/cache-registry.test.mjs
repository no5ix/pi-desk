import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false, alias: { "@": process.cwd() } });
const {
  getCachePruner,
  listCachePruners,
  registerCachePruner,
} = await jiti.import("./cache-registry.ts");

function fakePruner(name, initial) {
  const state = { held: initial };
  return {
    pruner: {
      name,
      bytes: () => state.held,
      prune: (target) => {
        const freed = Math.max(0, state.held - Math.max(0, target));
        state.held -= freed;
        return freed;
      },
    },
    state,
  };
}

test("a cache publishes its pruner under a name, and replacing it is per name", () => {
  const first = fakePruner("test:registry-a", 100);
  const unregister = registerCachePruner(first.pruner);
  assert.equal(getCachePruner("test:registry-a"), first.pruner);

  // A hot reload re-evaluates the module: its own entry is replaced, not a
  // second copy added under a suffixed name.
  const second = fakePruner("test:registry-a", 50);
  registerCachePruner(second.pruner);
  assert.equal(getCachePruner("test:registry-a"), second.pruner);
  assert.equal(listCachePruners().filter((pruner) => pruner.name === "test:registry-a").length, 1);

  unregister();
  // The stale unregister must not drop the module that replaced it.
  assert.equal(getCachePruner("test:registry-a"), second.pruner);
  registerCachePruner(second.pruner);
});

test("every long-lived cache the server meters has a pruner beside it", async () => {
  // The valve can only release what signs up. These are the stores the debug
  // meter names (lib/server-memory.ts); a cache added there needs a pruner here,
  // and this list is where the next one gets noticed as missing.
  const expected = [
    "read-only session views",
    "calendar prompt cache",
    "artifact index",
    "composer queues",
    "terminals",
    "file listings",
  ];
  await Promise.all([
    jiti.import("./session-reader.ts"),
    jiti.import("./session-prompts.ts"),
    jiti.import("./artifact-index.ts"),
    jiti.import("./composer-queue.ts"),
    jiti.import("./terminal-manager.ts"),
    jiti.import("../app/api/file-index/route.ts"),
  ]);
  const names = new Set(listCachePruners().map((pruner) => pruner.name));
  assert.deepEqual(expected.filter((name) => !names.has(name)), [], "a cache holds memory with no way to release it");
});

test("a pruner reports its bytes and gives them back down to the target", () => {
  const { pruner, state } = fakePruner("test:registry-b", 1000);
  registerCachePruner(pruner);
  assert.equal(pruner.bytes(), 1000);
  assert.equal(pruner.prune(400), 600);
  assert.equal(state.held, 400);
  assert.equal(pruner.prune(400), 0);
});
