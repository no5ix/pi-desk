import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const store = await jiti.import("@/lib/composer-draft-store.ts");
const route = await jiti.import("./route.ts");

const { clearAllComposerDrafts, composerSyncKey, normalizeComposerDraft, readComposerDraft, writeComposerDraft } = store;

function put(body) {
  return route.PUT(new Request("http://localhost/api/composer-draft", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function get(key) {
  return route.GET(new Request(`http://localhost/api/composer-draft?key=${encodeURIComponent(key)}`));
}

test("the sync key is a shared identity, not this browser's draft id", () => {
  // Two devices that open a new composer in the same folder write the same draft.
  assert.equal(composerSyncKey("new:7f3a:/repo"), "cwd:/repo");
  // A Windows folder carries its own colon; the draft id never does.
  assert.equal(composerSyncKey("new:7f3a:C:\\work\\repo"), "cwd:C:\\work\\repo");
  // A session id and a parked draft are shared already.
  assert.equal(composerSyncKey("1f0b2c3d-0000-4000-8000-000000000000"), "1f0b2c3d-0000-4000-8000-000000000000");
  assert.equal(composerSyncKey("parked-new:/repo"), "parked-new:/repo");
});

test("the newest write wins, and the loser is told what it is behind", () => {
  clearAllComposerDrafts();
  const t0 = Date.now();
  const base = { value: "first", images: [], files: [] };
  assert.deepEqual(writeComposerDraft("k", { ...base, updatedAt: t0 - 1000 }).draft.value, "first");
  const older = writeComposerDraft("k", { value: "older", images: [], files: [], updatedAt: t0 - 2000 });
  assert.equal(older.ok, false);
  assert.equal(older.draft.value, "first", "the stored copy comes back for the loser");
  assert.deepEqual(writeComposerDraft("k", { value: "typed later", images: [], files: [], updatedAt: t0 }).draft.value, "typed later");
  assert.equal(readComposerDraft("k").value, "typed later");
});

test("a draft a day old is gone", () => {
  clearAllComposerDrafts();
  writeComposerDraft("old", { value: "stale", images: [], files: [], updatedAt: Date.now() - 25 * 60 * 60 * 1000 });
  assert.equal(readComposerDraft("old"), null);
});

test("the size guards drop attachments and refuse an impossible composer", () => {
  clearAllComposerDrafts();
  const small = { data: "a".repeat(1000), mimeType: "image/png" };
  const huge = { data: "b".repeat(400_001), mimeType: "image/png" };
  const file = (id) => ({ id, name: `${id}.ts`, size: 10, text: "code" });
  const kept = normalizeComposerDraft({
    value: "ship it",
    images: [small, huge, small, small, small, small, small, small, small],
    files: [file("a"), file("b"), file("c"), file("d"), file("e"), file("f"), file("g"), file("h"), file("i")],
    updatedAt: 1,
  });
  assert.equal(kept.ok, true);
  assert.deepEqual(kept.draft.images.map((image) => image.data[0]), ["a", "a", "a", "a", "a", "a", "a", "a"], "the over-cap image is dropped");
  assert.equal(kept.draft.files.length, 8);
  assert.equal(normalizeComposerDraft({ value: "x".repeat(200_001), images: [], files: [] }).ok, false);
  // Eight images at the local cap are already 3.2 MB; the whole-snapshot guard is
  // what stops the case the per-item caps cannot: many text attachments.
  assert.equal(normalizeComposerDraft({
    value: "", images: [], files: Array.from({ length: 8 }, (_, i) => ({ id: `f${i}`, name: "x.ts", size: 1, text: "c".repeat(600_000) })),
  }).ok, false, "4 MB of attachments is not a composer, it is an upload");
});

test("the route round-trips a composer between two clients", async () => {
  clearAllComposerDrafts();
  const key = "new:device-a:/repo";
  const written = await put({ key, value: "hello from the laptop", images: [{ data: "AAA", mimeType: "image/png" }], files: [{ id: "f1", name: "a.ts", size: 2, text: "x" }], updatedAt: Date.now() });
  assert.equal(written.status, 200);
  // The phone reads it under its own draft id: the folder is the shared identity.
  const read = await get("new:device-b:/repo");
  assert.equal(read.status, 200);
  const draft = (await read.json()).draft;
  assert.equal(draft.value, "hello from the laptop");
  assert.deepEqual(draft.images, [{ data: "AAA", mimeType: "image/png" }]);
  assert.equal(draft.files.length, 1);

  const stale = await put({ key: "new:device-c:/repo", value: "older typing", images: [], files: [], updatedAt: Date.now() - 60_000 });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).draft.value, "hello from the laptop");

  assert.equal((await (await get("no-such-key")).json()).draft, null);
  assert.equal((await route.GET(new Request("http://localhost/api/composer-draft"))).status, 400);
  const removed = await route.DELETE(new Request(`http://localhost/api/composer-draft?key=${encodeURIComponent(key)}`, { method: "DELETE" }));
  assert.equal(removed.status, 200);
  assert.equal((await (await get(key)).json()).draft, null);
});

test("a body the size of an upload is refused before it is parsed", async () => {
  clearAllComposerDrafts();
  const response = await route.PUT(new Request("http://localhost/api/composer-draft", {
    method: "PUT",
    body: JSON.stringify({ key: "cwd:/repo", value: "y".repeat(6_000_001) }),
  }));
  assert.equal(response.status, 413);
  const badJson = await route.PUT(new Request("http://localhost/api/composer-draft", { method: "PUT", body: "{" }));
  assert.equal(badJson.status, 400);
});

test("a snapshot that lost attachments is refused, never stored trimmed", async () => {
  clearAllComposerDrafts();
  const t0 = Date.now();
  writeComposerDraft("trimmed", { value: "before the screenshot", images: [], files: [], updatedAt: t0 - 5000 });
  // A pasted screenshot is routinely larger than the store's image cap.
  const huge = "A".repeat(400_001);
  const result = writeComposerDraft("trimmed", {
    value: "with a screenshot",
    images: [{ mimeType: "image/png", data: huge, name: "shot.png" }],
    files: [],
    updatedAt: t0,
  });
  assert.equal(result.ok, false);
  assert.equal(result.dropped, 1, "the count names what the guards refused");
  assert.equal(readComposerDraft("trimmed").value, "before the screenshot", "the stored draft is untouched");

  const response = await put({
    key: "trimmed",
    value: "with a screenshot",
    images: [{ mimeType: "image/png", data: huge }],
    files: [],
    updatedAt: t0,
  });
  // A "cannot sync" answer: the client stops mirroring this composer, so the user's
  // composer keeps its attachments instead of repainting itself from the trim.
  assert.equal(response.status, 413);
  assert.equal((await response.json()).draft.value, "before the screenshot");
  assert.equal(normalizeComposerDraft({ value: "ok", images: [], files: [], updatedAt: t0 }).dropped, 0,
    "a draft that fits reports no drop");
});

test("the store keeps no empty draft: an empty write is the clear", () => {
  clearAllComposerDrafts();
  const t0 = Date.now();
  writeComposerDraft("cleared", { value: "typed on the laptop", images: [], files: [], updatedAt: t0 - 1000 });
  // The debounced echo of a send arrives with the send's stamp — a clear is never stale.
  const cleared = writeComposerDraft("cleared", { value: "", images: [], files: [], updatedAt: t0 - 1000 });
  assert.equal(cleared.ok, true);
  assert.equal(readComposerDraft("cleared"), null, "no empty copy for a poll to paint over a typed composer");
});
