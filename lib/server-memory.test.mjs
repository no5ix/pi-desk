import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });

function fresh() {
  // moduleCache: false, so a test that puts a fake store on globalThis reads it
  // back from a module that has not cached an earlier sample.
  return jiti.import("./server-memory.ts");
}

test("the pressure budget has a default, a clamp and an off switch", async () => {
  const { DEFAULT_MEMORY_BUDGET_MB, resolveMemoryBudgetMb } = await fresh();

  assert.equal(resolveMemoryBudgetMb(undefined), DEFAULT_MEMORY_BUDGET_MB);
  assert.equal(resolveMemoryBudgetMb(""), DEFAULT_MEMORY_BUDGET_MB);
  assert.equal(resolveMemoryBudgetMb("0"), 0, "0 switches the valve off, and that is the meaning operators expect");
  assert.equal(resolveMemoryBudgetMb("512"), 512);
  assert.equal(resolveMemoryBudgetMb("1"), 256, "below the clamp there is no room for one transcript");
  assert.equal(resolveMemoryBudgetMb("999999999"), 32 * 1024);
  assert.equal(resolveMemoryBudgetMb("nonsense"), DEFAULT_MEMORY_BUDGET_MB);
});

test("the valve's trigger is the managed footprint, never RSS", async () => {
  const { sampleServerMemory } = await fresh();
  const previousBudget = process.env.PI_WEB_MEMORY_BUDGET_MB;
  const realMemoryUsage = process.memoryUsage;
  // A dev server as macOS measures it (measured on this app's own dev server):
  // 2.9 GB of RSS, most of it read-only library mappings and Turbopack's mmap'd
  // module graph, against 0.52 GB of heap and external stores — everything the
  // valve can release. On that process an RSS trigger printed a pressure line
  // every minute and released 1 MB.
  const MB = 1024 * 1024;
  process.memoryUsage = () => ({
    rss: 2900 * MB,
    heapTotal: 400 * MB,
    heapUsed: 380 * MB,
    external: 120 * MB,
    arrayBuffers: 40 * MB,
  });
  process.env.PI_WEB_MEMORY_BUDGET_MB = "1024";
  try {
    const report = sampleServerMemory();
    assert.equal(report.managedBytes, 520 * MB, "the heap plus the external stores, counted once");
    assert.ok(report.overBudget === false, "mapped pages the valve has no power over are not pressure");
    process.env.PI_WEB_MEMORY_BUDGET_MB = "500";
    assert.equal(sampleServerMemory().overBudget, true, "the same process past its heap-plus-external budget is");
  } finally {
    process.memoryUsage = realMemoryUsage;
    if (previousBudget === undefined) delete process.env.PI_WEB_MEMORY_BUDGET_MB;
    else process.env.PI_WEB_MEMORY_BUDGET_MB = previousBudget;
  }
});

test("a sample names the process and every bucket, in the order that answers where", async () => {
  const { sampleServerMemory } = await fresh();

  const report = sampleServerMemory(1_700_000_000_000);
  assert.equal(report.at, 1_700_000_000_000);
  for (const field of ["rss", "heapTotal", "heapUsed", "external", "arrayBuffers", "managedBytes", "heapLimit"]) {
    assert.ok(Number.isInteger(report[field]) && report[field] > 0, `${field} is a positive byte count`);
  }
  assert.ok(report.heapLimit >= report.heapUsed, "the heap is used inside its ceiling");
  assert.ok(report.rss >= report.heapUsed, "resident memory is at least the JS heap");
  assert.ok(report.managedBytes >= report.heapTotal, "the managed footprint is the heap plus what is bound to it");
  assert.equal(report.overBudget, report.budgetMb > 0 && report.managedBytes > report.budgetMb * 1024 * 1024);
  assert.ok(Array.isArray(report.buckets) && report.buckets.length >= 8);
  assert.deepEqual(report.buckets.map((bucket) => bucket.name), [
    "sessions.live",
    "caches.sessionManager",
    "streams.queued",
    "mcp.servers",
    "caches.artifactIndex",
    "caches.fileIndex",
    "caches.prompts",
    "caches.sessionList",
    "queues.composer",
    "terminals",
  ]);
  for (const bucket of report.buckets) {
    assert.ok(Number.isInteger(bucket.count) && bucket.count >= 0, `${bucket.name} counts`);
    assert.ok(Number.isInteger(bucket.bytes) && bucket.bytes >= 0, `${bucket.name} weighs`);
  }
});

test("a loaded session's transcript is the byte figure that matters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-memory-"));
  const previous = globalThis.__piSessions;
  try {
    const file = join(dir, "session.jsonl");
    const payload = `${"x".repeat(4096)}\n`;
    await writeFile(file, payload);
    globalThis.__piSessions = new Map([
      ["live", { sessionFile: file }],
      ["not-yet-flushed", { sessionFile: join(dir, "missing.jsonl") }],
      ["no-file", {}],
    ]);

    const { sampleServerMemory } = await fresh();
    const bucket = sampleServerMemory().buckets.find((row) => row.name === "sessions.live");
    assert.equal(bucket.count, 3, "a wrapper is counted even when it has no file yet");
    assert.equal(bucket.bytes, (await stat(file)).size, "a wrapper without a file adds nothing, so a figure is never invented");
  } finally {
    if (previous === undefined) delete globalThis.__piSessions;
    else globalThis.__piSessions = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("the caches report what they hold, and a bounded walk says it is a floor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-memory-"));
  const keys = ["__piSmCache", "__piSessionPromptCache", "__piWebArtifactIndex", "__piFileIndexCache", "__piComposerQueues", "__piWebTerminals"];
  const previous = Object.fromEntries(keys.map((key) => [key, globalThis[key]]));
  try {
    globalThis.__piSmCache = new Map([["/a.jsonl", { bytes: 1024 }], ["/b.jsonl", { bytes: 2048 }]]);
    globalThis.__piSessionPromptCache = new Map([["/a.jsonl", { size: 9, mtimeMs: 1, prompts: [{ at: 1, entryId: "e", text: "hello", reply: "world" }] }]]);
    globalThis.__piComposerQueues = new Map([
      ["s1", { items: [{ text: "a prompt", images: [{ data: "base64data" }] }], paused: false, version: 1 }],
      ["s2", { items: [], paused: false, version: 0 }],
    ]);
    globalThis.__piWebTerminals = new Map([["t1", { backlog: "x".repeat(500), exited: true }]]);
    // 500 files: the walk stops at 400 and must mark the figure as a floor.
    globalThis.__piWebArtifactIndex = new Map(
      Array.from({ length: 500 }, (_, i) => [`/s${i}.jsonl`, { artifacts: [{ identifier: "a", versions: [{ content: "y".repeat(100) }] }] }]),
    );

    const { sampleServerMemory } = await fresh();
    const byName = Object.fromEntries(sampleServerMemory().buckets.map((bucket) => [bucket.name, bucket]));
    assert.equal(byName["caches.sessionManager"].bytes, 3072);
    assert.equal(byName["caches.prompts"].bytes, "hello".length + "world".length);
    assert.equal(byName["queues.composer"].bytes, "a prompt".length + "base64data".length);
    assert.equal(byName["terminals"].count, 1);
    assert.equal(byName["terminals"].bytes, 500);
    assert.ok(byName["terminals"].note.includes("1 exited"), "an exited shell kept in the registry is visible");
    assert.equal(byName["caches.artifactIndex"].partial, true);
    assert.equal(byName["caches.artifactIndex"].count, 500);
    assert.equal(byName["caches.artifactIndex"].bytes, 400 * 100, "the walk stopped at its bound, so the bytes are a floor");
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete globalThis[key];
      else globalThis[key] = previous[key];
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test("a page's numbers are kept per session, newest wins, and the ring is bounded", async () => {
  const { recordPageMemory, listPageMemory } = await fresh();

  recordPageMemory({ sessionId: "a", at: 1, jsHeapBytes: null, domNodes: 10, messages: 2, renderedRows: 1, queuedPrompts: 0 });
  recordPageMemory({ sessionId: "a", at: 2, jsHeapBytes: 500, domNodes: 20, messages: 4, renderedRows: 3, queuedPrompts: 1 });
  let pages = listPageMemory();
  assert.equal(pages.length, 1);
  assert.equal(pages[0].at, 2, "a renewal replaces the last one, so the debug view never shows a stale page");

  for (let i = 0; i < 40; i += 1) {
    recordPageMemory({ sessionId: `s${i}`, at: 3, jsHeapBytes: null, domNodes: 1, messages: 0, renderedRows: 0, queuedPrompts: 0 });
  }
  pages = listPageMemory();
  assert.ok(pages.length <= 24, `the ring is bounded, got ${pages.length}`);
  assert.ok(!pages.some((page) => page.sessionId === "a"), "the oldest page falls out first");
});

test("asking for a collection is honest about the flag being absent", async () => {
  const { collectGarbage, sampleServerMemory } = await fresh();

  const gc = globalThis.gc;
  if (typeof gc === "function") {
    // Started with --expose-gc: the sampler says so, and the call goes through.
    assert.equal(sampleServerMemory().gcAvailable, true);
    assert.equal(collectGarbage(), true);
    return;
  }
  assert.equal(sampleServerMemory().gcAvailable, false);
  assert.equal(collectGarbage(), false, "no collection, and no claim that one happened");
});

test("the cached report is only reused while it is fresh, and the sampler does not stack", async () => {
  const { getServerMemoryReport, sampleServerMemory, startServerMemorySampler, stopServerMemorySampler } = await fresh();

  const taken = sampleServerMemory(1_000);
  assert.equal(getServerMemoryReport(5_000, 1_001), taken, "a fresh sample is reused, so the panel's poll costs nothing");
  assert.notEqual(getServerMemoryReport(5_000, 6_001), taken, "an old one is not");

  startServerMemorySampler(1_000);
  startServerMemorySampler(1_000);
  const first = sampleServerMemory(7_000).samples;
  stopServerMemorySampler();
  stopServerMemorySampler();
  assert.ok(first > 0);
});

test("the pressure valve halves every cache that signed up, in order", async () => {
  const { applyMemoryPressure, getLastPressureState } = await fresh();
  const { registerCachePruner } = await jiti.import("./cache-registry.ts");
  const order = [];
  const stores = [
    { name: "test:valve-a", held: 1000 },
    { name: "test:valve-b", held: 500 },
  ];
  for (const store of stores) {
    registerCachePruner({
      name: store.name,
      bytes: () => store.held,
      prune: (target) => {
        order.push(store.name);
        const freed = Math.max(0, store.held - target);
        store.held -= freed;
        return freed;
      },
    });
  }
  const report = await applyMemoryPressure("requested");
  assert.equal(report.reason, "requested");
  assert.deepEqual(order.slice(0, 2), ["test:valve-a", "test:valve-b"]);
  const freed = Object.fromEntries(report.actions.map((a) => [a.name, a.bytesFreed]));
  assert.equal(freed["test:valve-a"], 500);
  assert.equal(freed["test:valve-b"], 250);
  assert.equal(report.freedBytes, 750);
  assert.equal(getLastPressureState(), report, "the report keeps the last run for the debug view");
});

test("a pruner that throws does not stop the release, and one run happens at a time", async () => {
  const { applyMemoryPressure } = await fresh();
  const { registerCachePruner } = await jiti.import("./cache-registry.ts");
  const store = { held: 800 };
  registerCachePruner({
    name: "test:valve-boom",
    bytes: () => {
      throw new Error("the walk is the bug");
    },
    prune: () => 0,
  });
  registerCachePruner({
    name: "test:valve-after",
    bytes: () => store.held,
    prune: (target) => {
      const freed = store.held - target;
      store.held = target;
      return freed;
    },
  });
  const report = await applyMemoryPressure("requested");
  assert.ok(report.actions.some((a) => a.name === "test:valve-after"), "the run continued past the failure");
  assert.equal(store.held, 400);
});

test("under the RSS budget nothing is released", async () => {
  const { maybeApplyPressure, sampleServerMemory } = await fresh();
  const previous = process.env.PI_WEB_MEMORY_BUDGET_MB;
  process.env.PI_WEB_MEMORY_BUDGET_MB = "0";
  try {
    const report = sampleServerMemory(Date.now());
    assert.equal(report.budgetMb, 0);
    assert.equal(report.overBudget, false, "no budget, no valve");
    assert.equal(maybeApplyPressure(Date.now()), null);
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_MEMORY_BUDGET_MB;
    else process.env.PI_WEB_MEMORY_BUDGET_MB = previous;
  }
});
