// The durable half of a composer's attachments.
//
// A draft's text survives a page reload through localStorage (lib/draft-store.ts), which is a few
// kilobytes per draft and shares a ~5 MB origin budget. A pasted screenshot is not a few
// kilobytes, so the text came back and the picture did not: a New Session page refreshed in the
// middle of a prompt lost the screenshot that prompt was written about, and the thumbnail in the
// composer went with it. Attachments therefore live in IndexedDB, keyed by the same draft key the
// text is stored under, and localStorage keeps exactly the text it kept before.
//
// Every entry point is best-effort: where IndexedDB is unavailable (the server, a private window,
// a browser that blocks the API) a call resolves and the draft simply stays in memory.

import { CHAT_ATTACHMENT_MAX_FILES } from "./chat-attachments";
import { getBase64DecodedByteLength } from "./image-attachments";
import type { ChatDraftFile, ChatDraftImage } from "./draft-store";

/** IndexedDB location of the store: one object store, one record per draft key. */
export const DRAFT_ATTACHMENT_DB_NAME = "pi-web:draft-attachments";
export const DRAFT_ATTACHMENT_STORE_NAME = "drafts";

/**
 * Screenshots kept for one composer. Ten is a screen of them; beyond that a reload restores a
 * wall of thumbnails nobody can see at once, and the write is slower than the paste.
 */
export const MAX_STORED_DRAFT_IMAGES = 10;
/** One clip this big is a video, not a screenshot: it stays in memory for this page only. */
export const MAX_STORED_DRAFT_IMAGE_BYTES = 4 * 1024 * 1024;
/** What one composer's attachments may take on disk, images and text files together. */
export const MAX_STORED_DRAFT_ATTACHMENT_BYTES = 8 * 1024 * 1024;
/**
 * Composers whose attachments are kept, the most recently written first. A draft's durable copy
 * is a project's parked New Session draft or a session, so this is a handful of projects' worth.
 */
export const MAX_STORED_DRAFT_ATTACHMENT_KEYS = 10;
/** A text file this long is not a file the composer was meant to carry (see the chat cap). */
const MAX_STORED_DRAFT_FILE_CHARS = 256 * 1024;

export interface DraftAttachments {
  images: ChatDraftImage[];
  files: ChatDraftFile[];
}

/** What is kept for one draft key, with the time it was written (the eviction order). */
export interface DraftAttachmentRecord extends DraftAttachments {
  at: number;
}

/** The storage a store runs on. IndexedDB in the page, a Map in a test. */
export interface DraftAttachmentKv {
  get(key: string): Promise<DraftAttachmentRecord | null>;
  set(key: string, record: DraftAttachmentRecord): Promise<void>;
  delete(key: string): Promise<void>;
  /** Remove every record past the `keep` most recent. */
  evict(keep: number): Promise<void>;
  /** Remove every record. */
  clearAll(): Promise<void>;
}

export interface DraftAttachmentStore {
  load(key: string): Promise<DraftAttachments | null>;
  save(key: string, attachments: DraftAttachments): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** A stable, cheap fingerprint of an attachment list: what a write is skipped for. */
export function draftAttachmentSignature(
  images: readonly ChatDraftImage[],
  files: readonly ChatDraftFile[],
): string {
  return `${images.map((image) => `${image.mimeType}:${image.data.length}`).join(",")}`
    + `|${files.map((file) => `${file.id}:${file.size}:${file.text.length}`).join(",")}`;
}

/**
 * The attachments worth writing: valid base64 images within the per-image and per-composer
 * budgets, and the text files the composer's own count allows. What is dropped stays in memory,
 * so a reload loses an oversized clip and keeps everything a person can act on.
 */
export function sanitizeDraftAttachments(
  images: readonly ChatDraftImage[] | undefined,
  files: readonly ChatDraftFile[] | undefined,
): DraftAttachments {
  const keptImages: ChatDraftImage[] = [];
  const keptFiles: ChatDraftFile[] = [];
  let bytes = 0;
  for (const file of files ?? []) {
    if (keptFiles.length >= CHAT_ATTACHMENT_MAX_FILES) break;
    if (!file || typeof file.text !== "string" || typeof file.name !== "string") continue;
    if (file.text.length > MAX_STORED_DRAFT_FILE_CHARS) continue;
    if (bytes + file.text.length > MAX_STORED_DRAFT_ATTACHMENT_BYTES) break;
    bytes += file.text.length;
    keptFiles.push({ id: file.id, name: file.name, size: file.size, text: file.text });
  }
  for (const image of images ?? []) {
    if (keptImages.length >= MAX_STORED_DRAFT_IMAGES) break;
    const size = image?.data ? getBase64DecodedByteLength(image.data) : null;
    if (size === null || !image.mimeType?.startsWith("image/")) continue;
    if (size > MAX_STORED_DRAFT_IMAGE_BYTES) continue;
    if (bytes + size > MAX_STORED_DRAFT_ATTACHMENT_BYTES) break;
    bytes += size;
    keptImages.push({ data: image.data, mimeType: image.mimeType });
  }
  return { images: keptImages, files: keptFiles };
}

/**
 * The store: sanitize, skip the writes nothing changed, keep the newest records, never throw.
 * The signature map is what keeps typing cheap — the composer writes its draft on every
 * keystroke, and a 400 KB screenshot must not go to disk with each one.
 */
export function createDraftAttachmentStore(kv: DraftAttachmentKv): DraftAttachmentStore {
  const signatures = new Map<string, string>();
  const isEmpty = (attachments: DraftAttachments) =>
    attachments.images.length === 0 && attachments.files.length === 0;

  return {
    async load(key) {
      try {
        const record = await kv.get(key);
        if (!record) return null;
        const clean = sanitizeDraftAttachments(record.images, record.files);
        if (isEmpty(clean)) {
          signatures.delete(key);
          return null;
        }
        signatures.set(key, draftAttachmentSignature(clean.images, clean.files));
        return clean;
      } catch {
        return null;
      }
    },

    async save(key, attachments) {
      const clean = sanitizeDraftAttachments(attachments.images, attachments.files);
      const signature = draftAttachmentSignature(clean.images, clean.files);
      if (signatures.get(key) === signature) return;
      signatures.set(key, signature);
      try {
        if (isEmpty(clean)) {
          await kv.delete(key);
          return;
        }
        await kv.set(key, { at: Date.now(), images: clean.images, files: clean.files });
        await kv.evict(MAX_STORED_DRAFT_ATTACHMENT_KEYS);
      } catch {
        // A full or blocked store: memory keeps the attachments for this page.
        signatures.delete(key);
      }
    },

    async remove(key) {
      signatures.delete(key);
      try {
        await kv.delete(key);
      } catch {
        // Best-effort.
      }
    },

    async clear() {
      signatures.clear();
      try {
        await kv.clearAll();
      } catch {
        // Best-effort.
      }
    },
  };
}

// --- The page's backend: IndexedDB.

function promiseRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

let database: Promise<IDBDatabase> | null = null;

/** Open the database once. A failed open is forgotten, so a later call can try again. */
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is unavailable"));
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DRAFT_ATTACHMENT_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(DRAFT_ATTACHMENT_STORE_NAME);
        // The eviction order. An index, because the records are screenshots: counting them by
        // reading their bodies is the expensive thing this avoids.
        store.createIndex("at", "at", { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB open blocked"));
    }).catch((error: unknown) => {
      database = null;
      throw error;
    });
  }
  return database;
}

export const indexedDbDraftAttachmentKv: DraftAttachmentKv = {
  async get(key) {
    const db = await openDatabase();
    const result = await promiseRequest(db.transaction(DRAFT_ATTACHMENT_STORE_NAME).objectStore(DRAFT_ATTACHMENT_STORE_NAME).get(key));
    return (result as DraftAttachmentRecord | undefined) ?? null;
  },

  async set(key, record) {
    const db = await openDatabase();
    const tx = db.transaction(DRAFT_ATTACHMENT_STORE_NAME, "readwrite");
    tx.objectStore(DRAFT_ATTACHMENT_STORE_NAME).put(record, key);
    await txComplete(tx);
  },

  async delete(key) {
    const db = await openDatabase();
    const tx = db.transaction(DRAFT_ATTACHMENT_STORE_NAME, "readwrite");
    tx.objectStore(DRAFT_ATTACHMENT_STORE_NAME).delete(key);
    await txComplete(tx);
  },

  async evict(keep) {
    const db = await openDatabase();
    const tx = db.transaction(DRAFT_ATTACHMENT_STORE_NAME, "readwrite");
    const store = tx.objectStore(DRAFT_ATTACHMENT_STORE_NAME);
    const excess = (await promiseRequest(store.count())) - keep;
    if (excess > 0) {
      // The index walks oldest first, so the first `excess` records are the ones to drop. The
      // walk is driven from the cursor's own event: a transaction does not survive being
      // awaited step by step.
      await new Promise<void>((resolve, reject) => {
        let removed = 0;
        const request = store.index("at").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || removed >= excess) {
            resolve();
            return;
          }
          cursor.delete();
          removed += 1;
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    }
    await txComplete(tx);
  },

  async clearAll() {
    const db = await openDatabase();
    const tx = db.transaction(DRAFT_ATTACHMENT_STORE_NAME, "readwrite");
    tx.objectStore(DRAFT_ATTACHMENT_STORE_NAME).clear();
    await txComplete(tx);
  },
};

// --- The store the app uses.
//
// The store and its backend live on `globalThis`, the way the repo's other shared server state
// does: a module can be instantiated twice (Next's dev and production graphs, a test that reloads
// the module to simulate a reload), and two copies of the byte store would write the same record
// twice and know nothing about each other's signatures.

interface DraftAttachmentGlobals {
  __piDraftAttachmentKv?: DraftAttachmentKv | null;
  __piDraftAttachmentStore?: DraftAttachmentStore | null;
}

function globalScope(): DraftAttachmentGlobals {
  return globalThis as unknown as DraftAttachmentGlobals;
}

/**
 * Test seam: run the app's store on another backend (a memory Map), so a unit test can write an
 * attachment and read it back through a fresh copy of the module — an actual reload.
 */
export function setDraftAttachmentKv(kv: DraftAttachmentKv | null): void {
  const scope = globalScope();
  scope.__piDraftAttachmentKv = kv;
  scope.__piDraftAttachmentStore = kv ? createDraftAttachmentStore(kv) : null;
}

/** The app's store, or null where the browser has no durable byte store at all. */
export function getDraftAttachmentStore(): DraftAttachmentStore | null {
  const scope = globalScope();
  if (scope.__piDraftAttachmentStore) return scope.__piDraftAttachmentStore;
  if (!scope.__piDraftAttachmentKv) {
    if (typeof indexedDB === "undefined") return null;
    scope.__piDraftAttachmentKv = indexedDbDraftAttachmentKv;
  }
  scope.__piDraftAttachmentStore = createDraftAttachmentStore(scope.__piDraftAttachmentKv);
  return scope.__piDraftAttachmentStore;
}

export async function loadDraftAttachments(key: string): Promise<DraftAttachments | null> {
  if (!key) return null;
  const store = getDraftAttachmentStore();
  if (!store) return null;
  try {
    return await store.load(key);
  } catch {
    return null;
  }
}

export async function saveDraftAttachments(key: string, attachments: DraftAttachments): Promise<void> {
  if (!key) return;
  const store = getDraftAttachmentStore();
  if (!store) return;
  await store.save(key, attachments);
}

export async function removeDraftAttachments(key: string): Promise<void> {
  if (!key) return;
  const store = getDraftAttachmentStore();
  if (!store) return;
  await store.remove(key);
}

export async function clearDraftAttachments(): Promise<void> {
  const store = getDraftAttachmentStore();
  if (!store) return;
  await store.clear();
}

/** A memory backend for tests and for a page with no IndexedDB to fall back on. */
export function createMemoryDraftAttachmentKv(initial?: Record<string, DraftAttachmentRecord>): DraftAttachmentKv & {
  records: Map<string, DraftAttachmentRecord>;
  /** How many writes reached the backend: what proves a keystroke did not rewrite a screenshot. */
  writes: number;
} {
  const records = new Map<string, DraftAttachmentRecord>(Object.entries(initial ?? {}));
  let writes = 0;
  const kv = {
    records,
    get writes() {
      return writes;
    },
    async get(key) {
      const record = records.get(key);
      return record
        ? { at: record.at, images: record.images.map((image) => ({ ...image })), files: record.files.map((file) => ({ ...file })) }
        : null;
    },
    async set(key, record) {
      writes += 1;
      records.set(key, { at: record.at, images: record.images.map((image) => ({ ...image })), files: record.files.map((file) => ({ ...file })) });
    },
    async delete(key) {
      records.delete(key);
    },
    async evict(keep) {
      // The same walk the IndexedDB index gives: oldest first, and records written in the same
      // millisecond in ascending key order. Dropping the tail of an insertion-ordered list would
      // throw away the newest composer's screenshot.
      const ordered = [...records.entries()].sort((a, b) =>
        a[1].at - b[1].at || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      ordered.slice(0, Math.max(0, ordered.length - keep)).forEach(([key]) => records.delete(key));
    },
    async clearAll() {
      records.clear();
    },
  };
  return kv;
}
