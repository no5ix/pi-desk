import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

// `?type=watch-all` carries a page's file watchers over one connection, so that open file
// tabs cannot spend the browser's six connections per host and starve a refresh
// (lib/file-watch-stream.ts, e2e/offline-navigation.mjs). What the connection costs, and
// what it may reach, is what this file guards.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-watch-all-")));
const home = path.join(root, "home");
fs.mkdirSync(path.join(home, ".ssh"), { recursive: true });
fs.writeFileSync(path.join(home, ".ssh", "id_ed25519"), "private key");
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
process.env.HOME = home;
process.env.PI_AGENT_HOME = home;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");
const { countFileWatches } = await jiti.import("../../../lib/file-watch-registry.ts");
allowFileRoot(root);

const decoder = new TextDecoder();

async function openWatchAll(entries, signal) {
  const url = `http://localhost/api/files/watch-all?type=watch-all&paths=${encodeURIComponent(JSON.stringify(entries))}`;
  const response = await GET(
    new NextRequest(url, signal ? { signal } : undefined),
    { params: Promise.resolve({ path: ["watch-all"] }) },
  );
  return response;
}

async function openStream(entries, signal) {
  const response = await openWatchAll(entries, signal);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = decoder.decode((await reader.read()).value);
  assert.match(first, /^data: \{"type":"connected"/);
  return { response, reader, frame: JSON.parse(first.slice("data: ".length).trim()) };
}

/** Frames of a live stream, until one matches, or the filesystem has had its time. */
async function framesUntil(reader, matches, ms = 8_000) {
  const seen = [];
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), Math.max(50, deadline - Date.now()))),
    ]);
    if (result.timeout || result.done) break;
    for (const line of decoder.decode(result.value).split("\n")) {
      if (!line.startsWith("data: ")) continue;
      const frame = JSON.parse(line.slice("data: ".length));
      seen.push(frame);
      if (matches(frame)) return seen;
    }
  }
  return seen;
}

const files = ["a.ts", "b.ts", "c.ts", "sibling.md"].map((name) => {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, `one ${name}`);
  return filePath;
});
const [aFile, bFile, cFile] = files;

test("one stream carries the watchers of many files", async () => {
  const baseline = countFileWatches();
  const { reader, frame } = await openStream([
    { filePath: aFile, sessionId: null },
    { filePath: bFile, sessionId: null },
    { filePath: cFile, sessionId: null },
  ]);

  assert.deepEqual(frame.paths.slice().sort(), [aFile, bFile, cFile].sort());
  // What the browser's pool spends is the connection: three watched files, one stream.
  assert.equal(countFileWatches(), baseline + 1);
  await reader.cancel();
  assert.equal(countFileWatches(), baseline);
});

test("a change names the file that moved, and a sibling's change names nothing", async () => {
  const { reader } = await openStream([
    { filePath: aFile, sessionId: "s-1" },
    { filePath: bFile, sessionId: null },
  ]);

  fs.writeFileSync(bFile, "two");
  const change = (await framesUntil(reader, (frame) => frame.type === "change"))
    .find((frame) => frame.type === "change");
  assert.ok(change, "the watcher of a watched file reports its change");
  assert.equal(change.filePath, bFile);
  assert.equal(change.sessionId, null);
  assert.equal(typeof change.size, "number");
  await reader.cancel();
});

test("a watched file that disappears is reported, once", async () => {
  const gone = path.join(root, "gone.ts");
  fs.writeFileSync(gone, "one");
  const { reader } = await openStream([{ filePath: gone, sessionId: null }]);

  fs.rmSync(gone);
  const reported = (await framesUntil(reader, (frame) => frame.type === "removed"))
    .filter((frame) => frame.type === "removed");
  assert.deepEqual(reported.map((frame) => frame.filePath), [gone]);
  fs.writeFileSync(gone, "one again");
  await new Promise((resolve) => setTimeout(resolve, 200));
  const again = (await framesUntil(reader, () => false, 300)).filter((frame) => frame.type === "removed");
  assert.deepEqual(again, [], "a file that comes back is not a second removal");
  await reader.cancel();
});

test("a client gone without a cancel lets go of the stream when its request is aborted", async () => {
  const baseline = countFileWatches();
  const client = new AbortController();
  const { reader } = await openStream([{ filePath: aFile, sessionId: null }], client.signal);

  assert.equal(countFileWatches(), baseline + 1);
  client.abort();
  assert.equal(countFileWatches(), baseline);
  assert.equal((await reader.read()).done, true, "the stream ends with the request");
  await reader.cancel();
  assert.equal(countFileWatches(), baseline, "a later cancel counts nothing twice");
});

test("a path outside the allowed roots is dropped, and so is a credential store", async () => {
  const outside = "/definitely/not/allowed/secret.ts";
  const credential = path.join(home, ".ssh", "id_ed25519");

  const onlyOutside = await openWatchAll([{ filePath: outside, sessionId: null }]);
  assert.equal(onlyOutside.status, 403, "a stream that may watch nothing is not opened");

  const onlyCredential = await openWatchAll([{ filePath: credential, sessionId: null }]);
  assert.equal(onlyCredential.status, 403, "the key store is not watchable, roots or no roots");

  const mixed = await openStream([
    { filePath: outside, sessionId: null },
    { filePath: credential, sessionId: null },
    { filePath: aFile, sessionId: null },
  ]);
  assert.deepEqual(mixed.frame.paths, [aFile], "one stale tab cannot break the stream of the files the page may read");
  await mixed.reader.cancel();
});

test("a watch list that is not a list of absolute paths is a 400", async () => {
  const cases = [
    "not json",
    "[]",
    "{}",
    JSON.stringify([{ filePath: "relative.ts" }]),
    JSON.stringify([{ filePath: 7 }]),
    JSON.stringify([{ filePath: aFile, sessionId: {} }]),
    JSON.stringify(Array.from({ length: 65 }, (_, i) => ({ filePath: path.join(root, `f${i}.ts`) }))),
    JSON.stringify([{ filePath: aFile }, { filePath: aFile }, ...Array.from({ length: 63 }, (_, i) => ({ filePath: path.join(root, `g${i}.ts`) }))]),
  ];
  for (const paths of cases) {
    const url = `http://localhost/api/files/watch-all?type=watch-all&paths=${encodeURIComponent(paths)}`;
    const response = await GET(
      new NextRequest(url),
      { params: Promise.resolve({ path: ["watch-all"] }) },
    );
    assert.equal(response.status, 400, paths.slice(0, 60));
  }
});

test("a parent directory segment in a watched path is refused", async () => {
  // path.join would collapse this; the escaped string is what a client can send.
  const response = await openWatchAll([
    { filePath: `${root}/link/../a.ts`, sessionId: null },
  ]);
  assert.equal(response.status, 403, "the escaped path is dropped, and nothing is left to watch");
});
