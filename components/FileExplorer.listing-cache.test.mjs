import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (file) => (await readFile(new URL(file, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/**
 * The file tree asks for a directory once.
 *
 * Measured on a production build, a warm directory listing is 12–26 ms: the cost a
 * reader feels is the requests the tree itself makes twice — the development double
 * effect, a refresh bump, an expansion that races a prefetch — and the folders
 * fetched one at a time as the reader opens them. The listings now go through
 * `lib/file-listing-cache.ts`, and a folder's children are prefetched behind it.
 *
 * These assertions keep the wiring: every listing goes through the cache, the
 * tree's refresh is a force and not a bypass, a write ends the window it opened,
 * and the prefetch stays a bounded courtesy.
 */

test("every listing goes through the cache, and the raw request lives in one place", async () => {
  const explorer = await read("./FileExplorer.tsx");
  assert.match(explorer, /import \{ childDirectoriesOf, directoryCache \} from "@\/lib\/file-listing-cache";/,
    "the tree uses the fork-owned cache, not an upstream file");
  assert.match(explorer, /const entries = await directoryCache\.list\(dirPath, showHidden, \(\) => fetchRawEntries\(dirPath, showHidden\), \{ force \}\);/,
    "one request per directory per window, and the fetcher is the raw listing");
  assert.match(explorer, /async function fetchRawEntries\(dirPath: string, showHidden: boolean\): Promise<FileEntry\[\]> \{\s*const res = await fetch\(`\/api\/files\/\$\{encodeFilePathForApi\(dirPath\)\}\?type=list/,
    "the URL and the shape the route answers are unchanged: this is a queue, not a new endpoint");
});

test("the tree's refresh asks again; the opening pair is one request", async () => {
  const explorer = await read("./FileExplorer.tsx");
  assert.match(explorer, /fetchEntries\(cwd, showHidden, true\)/,
    "the root listing runs force: the cache window never hides a refresh, and the development double effect joins one request");
});

test("a folder's children are prefetched, within a bound", async () => {
  const explorer = await read("./FileExplorer.tsx");
  assert.match(explorer, /const PREFETCH_CHILD_DIRS = 6;/, "a big folder lends six of its folders to the prefetch");
  assert.match(explorer, /const PREFETCH_ALL_UNDER = 12;/, "a small one is prefetched whole");
  assert.match(explorer, /children\.length <= PREFETCH_ALL_UNDER \? children : children\.slice\(0, PREFETCH_CHILD_DIRS\)/,
    "a home directory with a hundred folders is not prefetched hundred-wide: the reader opens one");
  assert.match(explorer, /void directoryCache\.prefetch\(prefetchable, showHidden, \(child\) => fetchRawEntries\(child, showHidden\)\);/,
    "the prefetch runs behind the listing, and it fetches raw (the cache joins it, it does not recurse)");
});

test("writing in the tree ends the window it opened", async () => {
  const explorer = await read("./FileExplorer.tsx");
  const ops = explorer.match(/const runFileOp = useCallback\(async \(target: string[\s\S]*?\}, \[\]\);/);
  assert.ok(ops, "the row menu's operations run through one funnel");
  assert.match(ops[0], /directoryCache\.invalidate\(target\);\s*directoryCache\.invalidateTree\(target\);\s*setTreeRefreshKey/,
    "a create, rename, delete or move forgets the folder, its subtree and the listings above it, before the refresh bump");
  assert.match(explorer, /applyUploadResult\(data, directory\);\s*\/\/[^\n]*\n\s*directoryCache\.invalidate\(directory\);/,
    "an upload ends the window of the folder the files landed in");
});

test("the cache's own bounds are the tree's, and the lib keeps them honest", async () => {
  const lib = await read("../lib/file-listing-cache.ts");
  assert.match(lib, /export const LISTING_TTL_MS = 15_000;/,
    "the window covers the reader, not only the burst: the app invalidates the moment it changes something");
  assert.match(lib, /export const PREFETCH_CONCURRENCY = 3;/,
    "three prefetched directories in flight: the browser's own budget is smaller than a folder's list");
  assert.match(lib, /\/\/ A refused or failing listing is not an answer: the next caller asks again\./,
    "a 403 is not cached as a listing");
  assert.match(lib, /const keyFor = \(dirPath: string, showHidden: boolean\) => `\$\{showHidden \? "1" : "0"\}\|\$\{dirPath\}`;/,
    "showing generated files is a different answer, not the cached one");
});
