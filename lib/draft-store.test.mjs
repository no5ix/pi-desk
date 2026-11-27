import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
    this.failWrites = false;
  }
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.values.set(key, String(value));
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

globalThis.window = new EventTarget();
globalThis.document = Object.assign(new EventTarget(), { visibilityState: "visible" });

function useStorage(initial) {
  const storage = new MemoryStorage(initial);
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => storage });
  return storage;
}

const stored = (storage, key) => JSON.parse(storage.getItem(`pi-web:draft:${key}`) ?? "null");

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const store = await jiti.import("@/lib/draft-store");
const byteStore = await jiti.import("@/lib/draft-attachment-store");

/** A screenshot in the unit the byte store counts in: valid base64, a few hundred KB. */
const SCREENSHOT = { data: Buffer.alloc(300 * 1024, 1).toString("base64"), mimeType: "image/png" };

/** The byte store on a memory backend, so a test can look at what a reload reads back. */
function useByteStore() {
  const kv = byteStore.createMemoryDraftAttachmentKv();
  byteStore.setDraftAttachmentKv(kv);
  return kv;
}

/** Put the page's own backend back (a page with no IndexedDB at all). */
const attachments = { reset: () => byteStore.setDraftAttachmentKv(null) };

/** Let the fire-and-forget attachment writes and removals land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A reload: a fresh copy of the module, with empty memory, over the same storage. */
async function reload() {
  return createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false }).import("@/lib/draft-store");
}

test("a session's draft text comes back after a reload, without its images", async () => {
  const storage = useStorage();
  store.setDraft("session-a", { value: "Hello", images: [{ data: "AAAA", mimeType: "image/png" }] });
  assert.equal(storage.getItem("pi-web:draft:session-a"), null, "the write waits for the delay");
  store.flushStoredDrafts();
  assert.equal(stored(storage, "session-a").text, "Hello");
  assert.equal(JSON.stringify(stored(storage, "session-a")).includes("AAAA"), false);

  const reloaded = await reload();
  assert.deepEqual(reloaded.getDraft("session-a"), { value: "Hello", images: [] });
});

test("the delayed write still lands, and leaving the page writes at once", async () => {
  const storage = useStorage();
  store.setDraft("session-delay", { value: "typed", images: [] });
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert.equal(stored(storage, "session-delay").text, "typed");

  store.setDraft("session-pagehide", { value: "before reload", images: [] });
  window.dispatchEvent(new Event("pagehide"));
  assert.equal(stored(storage, "session-pagehide").text, "before reload");

  store.setDraft("session-hidden", { value: "tab hidden", images: [] });
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  document.visibilityState = "visible";
  assert.equal(stored(storage, "session-hidden").text, "tab hidden");
});

test("clearing or emptying the text removes the stored copy at once", async () => {
  const storage = useStorage();
  store.setDraft("session-sent", { value: "send me", images: [] });
  store.flushStoredDrafts();
  store.clearDraft("session-sent");
  assert.equal(storage.getItem("pi-web:draft:session-sent"), null);

  // A pending write is dropped with the draft.
  store.setDraft("session-pending", { value: "x", images: [] });
  store.clearDraft("session-pending");
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:session-pending"), null);

  store.setDraft("session-images", { value: "caption", images: [] });
  store.flushStoredDrafts();
  store.setDraft("session-images", { value: "", images: [{ data: "AAAA", mimeType: "image/png" }] });
  assert.equal(storage.getItem("pi-web:draft:session-images"), null);
  assert.equal(store.getDraft("session-images").images.length, 1, "memory keeps the images");

  const reloaded = await reload();
  assert.equal(reloaded.getDraft("session-sent"), null);
  assert.equal(reloaded.getDraft("session-images"), null);
});

test("a fresh composer's own key stays in memory; its project's parked key is what is stored", () => {
  const storage = useStorage();
  const composerKey = "new:abc:/project-1";
  const parked = store.parkedNewSessionDraftKey("/project-1");
  const release = store.registerDraftMirror(composerKey, parked);
  store.setDraft(composerKey, { value: "first prompt", images: [] });
  store.flushStoredDrafts();
  assert.equal(stored(storage, parked)?.text, "first prompt", "the New Session draft is stored under the project");
  assert.equal(stored(storage, composerKey), null, "the per-composer key never reaches storage");

  store.rekeyDraft(composerKey, "session-promoted");
  store.flushStoredDrafts();
  assert.equal(stored(storage, "session-promoted")?.text, "first prompt");
  release();
  store.clearDraft("session-promoted");
  store.clearDraft(parked);
});

test("a failed send's text restored into a session's draft is stored, merged with the stored text", async () => {
  const storage = useStorage({ "pi-web:draft:session-restore": JSON.stringify({ text: "typed since", at: 1 }) });
  store.restoreDraftSubmission("session-restore", "sent text");
  store.flushStoredDrafts();
  assert.equal(stored(storage, "session-restore").text, "sent text\n\ntyped since");
});

test("text over the length cap stays in memory and its older stored copy is removed", () => {
  const storage = useStorage();
  store.setDraft("session-long", { value: "short", images: [] });
  store.flushStoredDrafts();
  const long = "x".repeat(store.MAX_STORED_DRAFT_LENGTH + 1);
  store.setDraft("session-long", { value: long, images: [] });
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:session-long"), null);
  assert.equal(store.getDraft("session-long").value, long);
});

test("only the most recently written drafts are kept", () => {
  const initial = {};
  for (let index = 0; index < store.MAX_STORED_DRAFTS; index++) {
    initial[`pi-web:draft:old-${index}`] = JSON.stringify({ text: `old ${index}`, at: index + 1 });
  }
  initial["pi-web:other-preference"] = "kept";
  const storage = useStorage(initial);
  store.setDraft("session-newest", { value: "newest", images: [] });
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:old-0"), null);
  assert.notEqual(storage.getItem("pi-web:draft:old-1"), null);
  assert.equal(stored(storage, "session-newest").text, "newest");
  assert.equal(storage.getItem("pi-web:other-preference"), "kept");
  assert.equal([...storage.values.keys()].filter((key) => key.startsWith("pi-web:draft:")).length, store.MAX_STORED_DRAFTS);
});

test("a refused write keeps the draft in memory and drops the stale stored copy", () => {
  const storage = useStorage({ "pi-web:draft:session-full": JSON.stringify({ text: "stale", at: 1 }) });
  assert.equal(store.getDraft("session-full").value, "stale");
  storage.failWrites = true;
  store.setDraft("session-full", { value: "current", images: [] });
  assert.doesNotThrow(() => store.flushStoredDrafts());
  assert.equal(storage.getItem("pi-web:draft:session-full"), null);
  assert.equal(store.getDraft("session-full").value, "current");
});

test("unavailable or corrupt storage falls back to memory", () => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get: () => { throw new Error("SecurityError"); },
  });
  store.setDraft("session-private", { value: "private mode", images: [] });
  assert.doesNotThrow(() => store.flushStoredDrafts());
  assert.equal(store.getDraft("session-private").value, "private mode");
  assert.doesNotThrow(() => store.clearDraft("session-private"));

  useStorage({
    "pi-web:draft:session-corrupt": "{not json",
    "pi-web:draft:session-wrong": JSON.stringify({ text: 42 }),
  });
  assert.equal(store.getDraft("session-corrupt"), null);
  assert.equal(store.getDraft("session-wrong"), null);
});

test("typing that goes on is still written at the interval", async () => {
  const storage = useStorage();
  store.setDraft("session-typing", { value: "a", images: [] });
  await new Promise((resolve) => setTimeout(resolve, 200));
  store.setDraft("session-typing", { value: "ab", images: [] });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(stored(storage, "session-typing").text, "ab");
});

test("a held key stays out of storage until every hold is released", async () => {
  const storage = useStorage({ "pi-web:draft:session-held": JSON.stringify({ text: "/compact", at: 1 }) });
  assert.equal(store.getDraft("session-held").value, "/compact");
  const releaseEdit = store.holdStoredDraft("session-held");
  assert.equal(storage.getItem("pi-web:draft:session-held"), null, "the stored copy goes at once");
  const releaseCommand = store.holdStoredDraft("session-held");
  store.setDraft("session-held", { value: "rewritten", images: [] });
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:session-held"), null);

  releaseCommand();
  releaseCommand();
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:session-held"), null, "another hold remains");
  assert.equal((await reload()).getDraft("session-held"), null);

  releaseEdit();
  store.flushStoredDrafts();
  assert.equal(stored(storage, "session-held").text, "rewritten", "the release stores the draft again");

  const releaseCleared = store.holdStoredDraft("session-held");
  store.clearDraft("session-held");
  releaseCleared();
  store.flushStoredDrafts();
  assert.equal(storage.getItem("pi-web:draft:session-held"), null);
});

test("signing out removes every stored draft and nothing else", () => {
  const storage = useStorage({
    "pi-web:draft:one": JSON.stringify({ text: "one", at: 1 }),
    "pi-web:draft:two": JSON.stringify({ text: "two", at: 2 }),
    "pi-web:other-preference": "kept",
  });
  store.setDraft("session-pending-signout", { value: "pending", images: [] });
  store.clearStoredDrafts();
  store.flushStoredDrafts();
  assert.deepEqual([...storage.values.keys()], ["pi-web:other-preference"]);
});

test("the stored copy seeds a key once; the page's own changes win after that", () => {
  const storage = useStorage({ "pi-web:draft:session-once": JSON.stringify({ text: "from storage", at: 1 }) });
  assert.equal(store.getDraft("session-once").value, "from storage");
  store.clearDraft("session-once");
  storage.setItem("pi-web:draft:session-once", JSON.stringify({ text: "another tab", at: 2 }));
  assert.equal(store.getDraft("session-once"), null);
});

// The desktop's text-file attachments (lib/chat-attachments.ts): durable only where the browser
// has a byte store (lib/draft-attachment-store.ts). localStorage stays text-only.
const chatFile = (id, name, text) => ({ id, name, size: text.length, text });

test("attached files belong to the draft they were attached in and never reach storage", async () => {
  const storage = useStorage();
  store.setDraft("chat-files", { value: "notes", images: [], files: [chatFile("f1", "notes.md", "SECRET A")] });
  assert.equal(store.getDraft("chat-other"), null, "a file in one draft does not create another");
  assert.deepEqual(store.getDraft("chat-files")?.files.map((file) => file.name), ["notes.md"]);
  store.flushStoredDrafts();
  for (const [key, value] of storage.values.entries()) {
    assert.equal(value.includes("SECRET A"), false, `${key} carries a file's text`);
  }

  const reloaded = await reload();
  assert.equal(reloaded.getDraft("chat-files")?.files, undefined, "with no byte store, a file does not come back: localStorage is text");
  store.clearDraft("chat-files");
  attachments.reset();
});

test("a draft holding only a file is not empty", () => {
  useStorage();
  store.setDraft("chat-file-only", { value: "", images: [], files: [chatFile("f1", "notes.md", "SECRET B")] });
  assert.ok(store.getDraft("chat-file-only"), "the composer's own state keeps the attachment");
  store.clearDraft("chat-file-only");
});

test("a submission restored with file markup comes back as attachments, not text", () => {
  useStorage();
  const message = 'look\n\n<attached_file name="a.txt">\nBODY\n</attached_file>';
  const restored = store.restoreDraftSubmission("chat-r", message);
  assert.equal(restored.value, "look");
  assert.deepEqual(restored.files.map((file) => [file.name, file.text]), [["a.txt", "BODY"]]);
  store.clearDraft("chat-r");
});

// --- New Session drafts across a reload (AppShell mirrors the fresh composer's key) -------

test("a New Session draft is stored under its project, not under the composer's own key", () => {
  const storage = useStorage();
  const composerKey = "new:draft-1:/repo/a";
  const parked = "parked-new:/repo/a";
  const release = store.registerDraftMirror(composerKey, parked);
  store.setDraft(composerKey, { value: "ship the search box", images: [{ data: "AAAA", mimeType: "image/png" }] });
  store.flushStoredDrafts();
  assert.equal(stored(storage, parked)?.text, "ship the search box", "the project's key carries the prompt");
  assert.equal(stored(storage, composerKey), null, "a per-composer id never reaches storage");
  release();
  store.clearDraft(composerKey);
});

test("the next fresh composer in that project takes the draft back after a reload", async () => {
  const storage = useStorage();
  const composerKey = "new:initial:/repo/b";
  const parked = "parked-new:/repo/b";
  const release = store.registerDraftMirror(composerKey, parked);
  store.setDraft(composerKey, { value: "fix the sidebar search", images: [] });
  store.flushStoredDrafts();
  release();

  const reloaded = await reload();
  const nextKey = "new:9f2c1:/repo/b";
  const adopt = reloaded.registerDraftMirror(nextKey, parked);
  assert.equal(reloaded.getDraft(nextKey)?.value, "fix the sidebar search", "a reload mints a new composer id, the project's prompt comes back");
  // Sending the prompt clears the composer, and the project's stored copy goes with it.
  reloaded.clearSentDraft(nextKey);
  reloaded.flushStoredDrafts();
  assert.equal(stored(storage, parked), null, "the send clears the stored copy with it");
  adopt();
});

test("clearing an empty composer leaves the prompt the project parked", () => {
  const storage = useStorage({ "pi-web:draft:parked-new:/repo/e": JSON.stringify({ text: "keep me", at: 1 }) });
  const composerKey = "new:draft-9:/repo/e";
  const release = store.registerDraftMirror(composerKey, "parked-new:/repo/e");
  store.clearDraft(composerKey);
  store.flushStoredDrafts();
  assert.equal(stored(storage, "parked-new:/repo/e")?.text, "keep me", "a composer with nothing to clear never erases the project's prompt");
  release();
});

test("typing the prompt away deletes the project's stored copy", () => {
  const storage = useStorage();
  const composerKey = "new:d-2:/repo/h";
  const parked = "parked-new:/repo/h";
  const release = store.registerDraftMirror(composerKey, parked);
  store.setDraft(composerKey, { value: "will be deleted", images: [] });
  store.flushStoredDrafts();
  assert.equal(stored(storage, parked)?.text, "will be deleted");
  store.setDraft(composerKey, { value: "", images: [] });
  store.flushStoredDrafts();
  assert.equal(stored(storage, parked), null, "an emptied composer empties the stored copy too");
  release();
});

test("one project's draft never shows up in another project's composer", () => {
  const storage = useStorage();
  const a = store.registerDraftMirror("new:d-1:/repo/f", "parked-new:/repo/f");
  const b = store.registerDraftMirror("new:d-1:/repo/g", "parked-new:/repo/g");
  store.setDraft("new:d-1:/repo/f", { value: "project a prompt", images: [] });
  store.flushStoredDrafts();
  assert.equal(stored(storage, "parked-new:/repo/f")?.text, "project a prompt");
  assert.equal(stored(storage, "parked-new:/repo/g"), null, "the other project keeps its own (empty) draft");
  assert.equal(store.getDraft("new:d-1:/repo/g"), null, "the other project's composer starts empty");
  a();
  b();
  store.clearDraft("new:d-1:/repo/f");
});

test("a refused write (quota, private mode) loses the stored copy rather than an older one", () => {
  const storage = useStorage();
  storage.failWrites = true;
  const composerKey = "new:d-2:/repo/d";
  const parked = "parked-new:/repo/d";
  const release = store.registerDraftMirror(composerKey, parked);
  assert.doesNotThrow(() => {
    store.setDraft(composerKey, { value: "typed while storage is full", images: [] });
    store.flushStoredDrafts();
  });
  assert.equal(store.getDraft(composerKey)?.value, "typed while storage is full", "memory still holds the draft");
  assert.equal(stored(storage, parked), null);
  release();
  store.clearDraft(composerKey);
});

// --- The attachments that survive a reload (lib/draft-attachment-store.ts).
//
// A New Session page refreshed in the middle of a prompt kept the words and threw away the
// screenshot the words were about. The text is localStorage's business and the bytes are the byte
// store's, so they come back on two beats: `getDraft` answers at once, the loader a moment later.
// These tests reload both modules over the same localStorage and the same byte store.

/** A reload: fresh copies of both modules over the same storage and byte store. */
async function reloadWithByteStore(kv) {
  const fresh = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false });
  const freshBytes = await fresh.import("@/lib/draft-attachment-store");
  freshBytes.setDraftAttachmentKv(kv);
  const freshStore = await fresh.import("@/lib/draft-store");
  return { store: freshStore, bytes: freshBytes };
}

test("a New Session page's screenshot comes back after a reload, with its prompt", async () => {
  const storage = useStorage();
  const kv = useByteStore();
  const composerKey = "new:d-9:/repo/f";
  const parked = "parked-new:/repo/f";
  const release = store.registerDraftMirror(composerKey, parked);
  store.setDraft(composerKey, {
    value: "look at this screenshot",
    images: [SCREENSHOT],
    files: [chatFile("f1", "notes.md", "the notes")],
  });
  store.flushStoredDrafts();
  await settle();
  assert.equal(stored(storage, parked)?.text, "look at this screenshot");
  assert.ok(
    !JSON.stringify(stored(storage, parked)).includes(SCREENSHOT.data.slice(0, 32)),
    "localStorage is still text only: the bytes live in the byte store",
  );
  assert.equal(kv.records.size, 1, "one composer, one record");
  assert.ok(kv.records.has(parked), "a fresh composer's picture is the project's parked draft's");

  const reloaded = await reloadWithByteStore(kv);
  assert.equal(reloaded.store.getDraft(parked)?.value, "look at this screenshot", "the text is back at once");
  const restored = await reloaded.store.loadStoredDraftAttachments(composerKey);
  assert.equal(restored?.images.length, 1, "the screenshot is back too");
  assert.equal(restored?.images[0].mimeType, "image/png");
  assert.deepEqual(restored?.files.map((file) => file.name), ["notes.md"], "and the attached file with it");
  assert.equal(restored?.value, "look at this screenshot");
  assert.deepEqual(reloaded.store.getDraft(composerKey)?.images.map((image) => image.mimeType), ["image/png"], "the composer's draft now carries it");
  release();
  attachments.reset();
});

test("a sent prompt takes its durable attachments with it", async () => {
  useStorage();
  const kv = useByteStore();
  store.setDraft("session-send", { value: "ship it", images: [SCREENSHOT] });
  await settle();
  assert.ok(kv.records.has("session-send"));
  store.clearSentDraft("session-send");
  await settle();
  assert.equal(kv.records.size, 0, "a reload never offers back a prompt that was sent, picture included");
  assert.equal(await store.loadStoredDraftAttachments("session-send"), null);
  attachments.reset();
});

test("typing the prompt away takes the durable attachments with it", async () => {
  useStorage();
  const kv = useByteStore();
  const composerKey = "new:d-10:/repo/h";
  const parked = "parked-new:/repo/h";
  const release = store.registerDraftMirror(composerKey, parked);
  store.setDraft(composerKey, { value: "look here", images: [SCREENSHOT] });
  await settle();
  assert.ok(kv.records.has(parked));
  store.setDraft(composerKey, { value: "", images: [] });
  await settle();
  assert.equal(kv.records.size, 0, "the box was cleared: a reload offers nothing back");
  release();
  attachments.reset();
});

test("a composer that already has attachments keeps them, and gets its own draft back", async () => {
  useStorage();
  const kv = useByteStore();
  const key = "session-live";
  store.setDraft(key, { value: "look", images: [SCREENSHOT], files: [] });
  await settle();
  // A second ask (the box is open, the picture is on it) must not answer "nothing to restore".
  const again = await store.loadStoredDraftAttachments(key);
  assert.equal(again?.images?.length, 1, "the composer's own attachments come back to it");
  assert.equal(again?.value, "look");
  attachments.reset();
});

test("a page with no byte store keeps the text and loses the attachments", async () => {
  const storage = useStorage();
  attachments.reset();
  const composerKey = "new:d-11:/repo/i";
  const parked = "parked-new:/repo/i";
  const release = store.registerDraftMirror(composerKey, parked);
  store.setDraft(composerKey, { value: "no indexeddb here", images: [SCREENSHOT] });
  store.flushStoredDrafts();
  await settle();
  assert.equal(stored(storage, parked)?.text, "no indexeddb here", "the text is stored as it always was");
  const reloaded = await reload();
  assert.equal(reloaded.getDraft(parked)?.value, "no indexeddb here");
  assert.equal(await reloaded.loadStoredDraftAttachments(composerKey), null, "nothing to read, and no throw");
  release();
});

test("a reload that rekeys the parked draft keeps one copy of the screenshot", async () => {
  const storage = useStorage();
  const kv = useByteStore();
  const composerKey = "new:d-11:/repo/rekey";
  const parked = "parked-new:/repo/rekey";
  store.setDraft(parked, { value: "look at this", images: [SCREENSHOT], files: [] });
  store.flushStoredDrafts();
  await settle();
  assert.ok(kv.records.has(parked), "the project parked the prompt and the picture");
  assert.equal(stored(storage, parked)?.text, "look at this", "the prompt is in localStorage");

  // The reload, in the order the shell does it. The screenshot lives only in the byte store; the
  // parked draft in localStorage is text. The composer opens on the parked draft, then the parked
  // draft is rekeyed onto the composer's own key — which clears that key and writes it again in
  // the same breath. A delete that lands last is a picture lost on refresh, and a merge that
  // counts the draft twice is a picture shown twice.
  const reloaded = await reloadWithByteStore(kv);
  reloaded.store.registerDraftMirror(composerKey, parked);
  reloaded.store.rekeyDraft(parked, composerKey);
  reloaded.store.flushStoredDrafts();
  await settle();
  assert.ok(kv.records.has(parked), "the record survives the rekey's delete-and-write");
  assert.equal(kv.records.get(parked)?.images?.length, 1, "with one copy of the screenshot");
  assert.equal(stored(storage, parked)?.text, "look at this", "and the prompt");
  const restored = await reloaded.store.loadStoredDraftAttachments(composerKey);
  assert.equal(restored?.images?.length, 1, "the composer reads the screenshot back");
  assert.equal(restored?.value, "look at this", "with the prompt it belongs to");

  // The other shape of the same reload, inside one page: the composer's key was seeded from the
  // parked draft, so both keys hold the same picture, and the rekey's merge must not show it twice.
  const composer = reloaded.store.getDraft(composerKey);
  assert.equal(composer?.images?.length, 1, "one copy of the screenshot in the composer, not two");
});

test("a keystroke does not rewrite the screenshot", async () => {
  useStorage();
  const kv = useByteStore();
  const composerKey = "new:d-12:/repo/j";
  const parked = "parked-new:/repo/j";
  const release = store.registerDraftMirror(composerKey, parked);
  store.setDraft(composerKey, { value: "a", images: [SCREENSHOT] });
  await settle();
  const writes = kv.writes;
  for (const text of ["ab", "abc", "abcd"]) store.setDraft(composerKey, { value: text, images: [SCREENSHOT] });
  await settle();
  assert.equal(kv.writes, writes, "the draft moved, the attachments did not: no screenshot rewrite per keystroke");
  store.setDraft(composerKey, { value: "abcd", images: [SCREENSHOT, SCREENSHOT] });
  await settle();
  assert.equal(kv.writes, writes + 1, "a second screenshot is a real change, and is written");
  release();
  attachments.reset();
});
