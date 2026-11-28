import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { createDirectoryCache, childDirectoriesOf, ancestorDirectories, PREFETCH_CONCURRENCY } =
  await jiti.import("./file-listing-cache.ts");

/**
 * The tree's listings, fetched once.
 *
 * The server answers a warm directory in 12–26 ms; what the reader waits for is
 * the same directory asked twice — the development double effect, a refresh bump, a
 * folder collapsed and reopened, an expansion that races a prefetch. These
 * assertions are the three rules the cache is built on: in flight is enough, a
 * short window is not a lifetime, and a failure is never an answer.
 */

function counter() {
  const state = { calls: 0, inFlight: 0, maxInFlight: 0 };
  const fetch = (dir, delay = 5) => async () => {
    state.calls += 1;
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    await new Promise((resolve) => setTimeout(resolve, delay));
    state.inFlight -= 1;
    return [{ dir }];
  };
  return { state, fetch };
}

test("two callers asking for one directory are one request", async () => {
  const cache = createDirectoryCache();
  const { state, fetch } = counter();
  const [a, b] = await Promise.all([cache.list("/p/src", false, fetch("/p/src")), cache.list("/p/src", false, fetch("/p/src"))]);
  assert.equal(state.calls, 1, "the second caller joined the running request");
  assert.equal(state.maxInFlight, 1);
  assert.deepEqual(a, b);
  assert.deepEqual(cache.stats(), { hits: 0, fetches: 1, inflightJoins: 1, prefetched: 0 });
});

test("a directory answered inside the window is not asked for again", async () => {
  const cache = createDirectoryCache(30);
  const { state, fetch } = counter();
  await cache.list("/p/src", false, fetch("/p/src"));
  const again = await cache.list("/p/src", false, fetch("/p/src"));
  assert.equal(state.calls, 1, "a folder collapsed and reopened answers at once");
  assert.deepEqual(again, [{ dir: "/p/src" }]);

  await cache.list("/p/src", true, fetch("/p/src/hidden-visible"));
  assert.equal(state.calls, 2, "showing hidden files is a different answer, not the cached one");

  await new Promise((resolve) => setTimeout(resolve, 40));
  await cache.list("/p/src", false, fetch("/p/src"));
  assert.equal(state.calls, 3, "the window ends and the next look is a fresh one");
});

test("the tree's refresh asks again, and a failure is never an answer", async () => {
  const cache = createDirectoryCache();
  const { state, fetch } = counter();
  await cache.list("/p", false, fetch("/p"));
  await cache.list("/p", false, fetch("/p"), { force: true });
  assert.equal(state.calls, 2, "force is the tree's refresh: the window is not a lock");

  let failed = 0;
  const boom = () => {
    failed += 1;
    return Promise.reject(new Error("Access denied"));
  };
  await assert.rejects(cache.list("/p/secret", false, boom), /Access denied/);
  await assert.rejects(cache.list("/p/secret", false, boom), /Access denied/);
  assert.equal(failed, 2, "a refused directory stays retryable, not cached as an answer");
});

test("a prefetch fills the cache, at a bounded concurrency, and never in the foreground", async () => {
  const cache = createDirectoryCache();
  const state = { calls: 0, inFlight: 0, maxInFlight: 0 };
  const fetch = (dir) => {
    state.calls += 1;
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    return new Promise((resolve) => setTimeout(() => {
      state.inFlight -= 1;
      resolve([{ dir }]);
    }, 12));
  };
  const dirs = ["/p/a", "/p/b", "/p/c", "/p/d", "/p/e", "/p/f", "/p/g"];
  await cache.prefetch(dirs, false, fetch);
  assert.equal(state.calls, dirs.length, "each prefetched directory was asked once");
  assert.ok(state.maxInFlight <= PREFETCH_CONCURRENCY, `the prefetch kept ${state.maxInFlight} requests in flight, the bound is ${PREFETCH_CONCURRENCY}`);

  const before = state.calls;
  const opened = await cache.list("/p/c", false, () => Promise.reject(new Error("should not fetch")));
  assert.deepEqual(opened, [{ dir: "/p/c" }], "the folder the reader opened is already answered");
  assert.equal(state.calls, before, "opening it cost no request");

  await cache.prefetch(["/p/a", "/p/z"], false, (dir) => (dir === "/p/z" ? Promise.reject(new Error("Access denied")) : Promise.resolve([{ dir }])));
  assert.equal(state.maxInFlight <= PREFETCH_CONCURRENCY, true);
  await assert.rejects(cache.list("/p/z", false, () => Promise.reject(new Error("Access denied"))), /Access denied/,
    "a prefetched refusal is swallowed by the prefetch and not cached as an answer");
  const seen = await cache.list("/p/z", false, () => Promise.resolve([{ dir: "reader" }]));
  assert.deepEqual(seen, [{ dir: "reader" }], "the reader who opens it asks for itself and sees the answer");
});

test("writing in a folder ends the window for it and for every listing above it", async () => {
  const cache = createDirectoryCache(60_000);
  const { state, fetch } = counter();
  await cache.list("/p", false, fetch("/p"));
  await cache.list("/p/src", false, fetch("/p/src"));
  await cache.list("/p/src/app", false, fetch("/p/src/app"));
  await cache.list("/p/docs", false, fetch("/p/docs"));
  assert.equal(state.calls, 4);

  cache.invalidate("/p/src/app");
  await cache.list("/p/src/app", false, fetch("/p/src/app"));
  await cache.list("/p/src", false, fetch("/p/src"));
  await cache.list("/p", false, fetch("/p"));
  assert.equal(state.calls, 7, "the file's directory and its ancestors answer afresh: a new file changes the parent's listing");
  await cache.list("/p/docs", false, fetch("/p/docs"));
  assert.equal(state.calls, 7, "a sibling folder keeps its answer");

  cache.invalidateTree("/p/src");
  await cache.list("/p/src/app", false, fetch("/p/src/app"));
  await cache.list("/p/src", false, fetch("/p/src"));
  await cache.list("/p", false, fetch("/p"));
  await cache.list("/p/docs", false, fetch("/p/docs"));
  assert.equal(state.calls, 9, "the subtree and the listings above it answer afresh; a sibling outside the subtree keeps its answer");
});

test("the helpers name the tree's own shapes", () => {
  assert.deepEqual(ancestorDirectories("/p/src/app/file.ts"), ["/p/src/app", "/p/src", "/p", "/"]);
  const entries = [{ name: "src", isDir: true }, { name: "README.md", isDir: false }, { name: "app", isDir: true }];
  const nameOf = (e) => e.name;
  const isDirOf = (e) => e.isDir;
  assert.deepEqual(childDirectoriesOf(entries, "/p", nameOf, isDirOf), ["/p/src", "/p/app"]);
  assert.deepEqual(childDirectoriesOf(entries, "/", nameOf, isDirOf), ["/src", "/app"]);
});
