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

// The desktop's text-file attachments (lib/chat-attachments.ts): page-life only.
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
  assert.equal(reloaded.getDraft("chat-files")?.files, undefined, "a file never comes back after a reload");
  store.clearDraft("chat-files");
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
