import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const attachments = await jiti.import("@/lib/draft-attachment-store");
const {
  MAX_STORED_DRAFT_IMAGES,
  MAX_STORED_DRAFT_IMAGE_BYTES,
  MAX_STORED_DRAFT_ATTACHMENT_KEYS,
  createDraftAttachmentStore,
  createMemoryDraftAttachmentKv,
  draftAttachmentSignature,
  sanitizeDraftAttachments,
} = attachments;

/** Base64 of `bytes` decoded bytes, so a size cap can be stated in the unit the cap uses. */
function base64OfBytes(bytes) {
  return Buffer.alloc(bytes, 1).toString("base64");
}
const image = (bytes, mimeType = "image/png") => ({ data: base64OfBytes(bytes), mimeType });
const file = (id, name, chars) => ({ id, name, size: chars, text: "x".repeat(chars) });

test("the byte store keeps a screenshot and drops what only a video is", () => {
  const small = image(200 * 1024);
  const clean = sanitizeDraftAttachments([small], [file("f1", "notes.md", 1000)]);
  assert.deepEqual(clean.images, [{ data: small.data, mimeType: "image/png" }]);
  assert.deepEqual(clean.files, [file("f1", "notes.md", 1000)]);

  const oversized = sanitizeDraftAttachments([image(MAX_STORED_DRAFT_IMAGE_BYTES + 1)], []);
  assert.deepEqual(oversized.images, [], "one 10 MB clip is not written to disk; it stays in memory");

  const tooMany = sanitizeDraftAttachments(
    Array.from({ length: MAX_STORED_DRAFT_IMAGES + 5 }, () => image(1024)),
    [],
  );
  assert.equal(tooMany.images.length, MAX_STORED_DRAFT_IMAGES, "a reload restores a page of thumbnails, not a wall");

  const notBase64 = sanitizeDraftAttachments([{ data: "not base64 at all", mimeType: "image/png" }], []);
  assert.deepEqual(notBase64.images, [], "a value that is not base64 is not stored");
  const notImage = sanitizeDraftAttachments([{ data: base64OfBytes(16), mimeType: "application/pdf" }], []);
  assert.deepEqual(notImage.images, [], "only images are attachments here");

  const bigTotal = sanitizeDraftAttachments(
    Array.from({ length: MAX_STORED_DRAFT_IMAGES }, () => image(2 * 1024 * 1024)),
    [],
  );
  assert.ok(
    bigTotal.images.length < MAX_STORED_DRAFT_IMAGES,
    "one composer's attachments stop at the byte budget, not only at the count",
  );
});

test("the signature is what a write is skipped for", () => {
  const a = [image(1024)];
  const b = [image(2048)];
  assert.equal(draftAttachmentSignature(a, []), draftAttachmentSignature([image(1024)], []));
  assert.notEqual(draftAttachmentSignature(a, []), draftAttachmentSignature(b, []));
  assert.notEqual(
    draftAttachmentSignature(a, [file("f1", "a.md", 10)]),
    draftAttachmentSignature(a, [file("f2", "a.md", 10)]),
    "an attached file is part of the draft's bytes",
  );
});

test("the store round-trips a draft's attachments and keeps the newest composers", async () => {
  const kv = createMemoryDraftAttachmentKv();
  const store = createDraftAttachmentStore(kv);
  const screenshot = image(300 * 1024);
  await store.save("parked-new:/repo", { images: [screenshot], files: [] });
  assert.deepEqual(await store.load("parked-new:/repo"), { images: [screenshot], files: [] });

  // Every keystroke writes the draft; the attachments have not changed, so the disk is not touched.
  const writesBefore = kv.writes;
  await store.save("parked-new:/repo", { images: [screenshot], files: [] });
  assert.equal(kv.writes, writesBefore, "typing does not rewrite a screenshot");

  await store.save("parked-new:/repo", { images: [], files: [] });
  assert.equal(await store.load("parked-new:/repo"), null, "a cleared composer has nothing durable");

  for (let index = 0; index < MAX_STORED_DRAFT_ATTACHMENT_KEYS + 4; index += 1) {
    await store.save(`session-${index}`, { images: [image(1024)], files: [] });
  }
  assert.equal(
    kv.records.size,
    MAX_STORED_DRAFT_ATTACHMENT_KEYS,
    "the oldest composers' attachments are the ones that go",
  );
  assert.ok(await store.load(`session-${MAX_STORED_DRAFT_ATTACHMENT_KEYS + 3}`), "the newest stays");
  assert.equal(await store.load("session-0"), null, "the oldest goes");

  await store.clear();
  assert.equal(kv.records.size, 0);
});

test("a store the browser refuses never reaches the caller", async () => {
  const broken = {
    async get() { throw new Error("blocked"); },
    async set() { throw new Error("quota"); },
    async delete() { throw new Error("blocked"); },
    async evict() { throw new Error("blocked"); },
    async clearAll() { throw new Error("blocked"); },
  };
  const store = createDraftAttachmentStore(broken);
  assert.equal(await store.load("session-a"), null);
  await store.save("session-a", { images: [image(1024)], files: [] });
  await store.remove("session-a");
  await store.clear();
  await store.save("session-a", { images: [image(1024)], files: [] });
  assert.ok(true, "no throw: the draft simply stays in memory");
});

test("the app's store runs on the injected backend", async () => {
  const kv = createMemoryDraftAttachmentKv();
  attachments.setDraftAttachmentKv(kv);
  try {
    await attachments.saveDraftAttachments("parked-new:/repo", { images: [image(4096)], files: [] });
    const loaded = await attachments.loadDraftAttachments("parked-new:/repo");
    assert.equal(loaded.images.length, 1);
    await attachments.removeDraftAttachments("parked-new:/repo");
    assert.equal(await attachments.loadDraftAttachments("parked-new:/repo"), null);
  } finally {
    attachments.setDraftAttachmentKv(null);
  }
});
