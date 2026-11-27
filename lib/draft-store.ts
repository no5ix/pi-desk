import {
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "./image-attachments";
import { CHAT_ATTACHMENT_MAX_FILES, splitMessageForComposer } from "./chat-attachments";
import { getBrowserStorage } from "./browser-storage";
import {
  clearDraftAttachments,
  loadDraftAttachments,
  removeDraftAttachments,
  saveDraftAttachments,
  type DraftAttachments,
} from "./draft-attachment-store";

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

/** A text file attached in a chat composer (see lib/chat-attachments.ts). */
export interface ChatDraftFile {
  id: string;
  name: string;
  size: number;
  text: string;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  /**
   * Attached text files. Never in localStorage — a file can be 256 KB, which the budget the
   * drafts share cannot hold. Within the byte store's caps they are kept there with the images,
   * so a reload brings them back (lib/draft-attachment-store.ts).
   */
  files?: ChatDraftFile[];
}

const drafts = new Map<string, ChatDraft>();

const PARKED_NEW_SESSION_PREFIX = "parked-new:";
/** AppShell's fresh composer key: `new:<draftId>:<cwd>`. */
const NEW_SESSION_PREFIX = "new:";

/** Where a fresh composer's draft waits once the page leaves it; the next fresh composer in that cwd takes it back. */
export function parkedNewSessionDraftKey(cwd: string): string {
  return `${PARKED_NEW_SESSION_PREFIX}${cwd}`;
}

// A session's draft text outlives a reload (#1718). Memory stays the source of
// truth while the page lives; localStorage is a write-through copy, read once
// per key the first time this page asks for that key. Attachments are never in
// that copy — a pasted screenshot is not a few kilobytes — they go to the byte
// store and are read back on request (loadStoredDraftAttachments).
// One storage key per draft, so a write rewrites only the draft that changed.
const STORAGE_PREFIX = "pi-web:draft:";
/** Stored drafts kept, the most recently written first. */
export const MAX_STORED_DRAFTS = 50;
/**
 * Longer text stays in memory only, and its older stored copy is removed: a cut
 * prompt would come back looking whole. 20,000 UTF-16 units is pages of typed
 * prompt; 50 such drafts stay near 1M units, about a fifth of the ~5M a browser
 * grants an origin, which pi-web's other stored preferences share.
 */
export const MAX_STORED_DRAFT_LENGTH = 20_000;
/** Changed drafts are written at most this often while typing goes on. */
const STORE_INTERVAL_MS = 300;

interface DraftStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Keys whose stored copy this page has read or replaced. */
const seededKeys = new Set<string>();
const pendingStores = new Set<string>();
/** Keys kept out of storage, with how many holds each has. */
const storeHolds = new Map<string, number>();
let storeTimer: ReturnType<typeof setTimeout> | null = null;
let flushListenersAdded = false;

/**
 * A fresh composer's key holds a per-composer id (`new:<draftId>:<cwd>`), so it names the same
 * draft across a reload; the parked key does — it is the project's, and it is what the next
 * fresh composer in that cwd adopts. So the parked key is stored, and the `new:` key is not:
 * a per-composer id would leave a copy behind in storage that nothing ever reads again.
 */
function isStoredDraftKey(key: string): boolean {
  return !key.startsWith(NEW_SESSION_PREFIX);
}

/**
 * A fresh composer's key, and the durable per-project key its draft survives a reload under
 * (`parked-new:<cwd>` — the key the next fresh composer in that project takes back).
 */
const draftMirrors = new Map<string, string>();

/**
 * Keeps `key`'s draft in step with `mirrorKey` while the registration lives. AppShell registers
 * the pair for the page's fresh composer, so a New Session draft typed in a project's composer
 * is stored under that project and comes back after a reload; creating the session rekeys the
 * parked draft away, and clearing a composer clears the stored copy with it.
 */
export function registerDraftMirror(key: string, mirrorKey: string): () => void {
  if (!key || !mirrorKey || key === mirrorKey) return () => {};
  draftMirrors.set(key, mirrorKey);
  const own = drafts.get(key);
  if (own) {
    writeMirroredDraft(mirrorKey, own);
  } else {
    // A composer that has not written anything yet takes back what the project parked, so a
    // reload does not lose the prompt. Registration never clears the durable copy: an empty
    // composer has nothing to say about it.
    const durable = getDraft(mirrorKey);
    if (durable) drafts.set(key, cloneDraft(durable));
  }
  return () => {
    if (draftMirrors.get(key) === mirrorKey) draftMirrors.delete(key);
  };
}

function mirrorKeyFor(key: string): string | null {
  const mirror = draftMirrors.get(key);
  return mirror && mirror !== key ? mirror : null;
}

/**
 * The parked key a fresh composer's key belongs to. `new:<draftId>:<cwd>` names the draft of one
 * composer, and a page owns a new id each time it opens, so the durable copy is the project's
 * parked draft.
 *
 * The cwd is matched by suffix against the parked keys this page knows — the drafts it holds and
 * the mirrors the shell registered — because a draft id is not always one colon-free segment (a
 * restored composer's id carries a cwd), and a Windows cwd carries a colon of its own. Splitting
 * the key on a colon gets both cases wrong; matching a known parked key's cwd cannot.
 */
function parkedKeyForFreshComposerKey(key: string): string | null {
  if (!key.startsWith(NEW_SESSION_PREFIX)) return null;
  let best: string | null = null;
  for (const candidate of knownParkedKeys()) {
    const cwd = candidate.slice(PARKED_NEW_SESSION_PREFIX.length);
    if (!cwd) continue;
    if (key.endsWith(`:${cwd}`) && (best === null || candidate.length > best.length)) best = candidate;
  }
  return best;
}

function knownParkedKeys(): Iterable<string> {
  const keys = new Set<string>();
  for (const key of drafts.keys()) if (key.startsWith(PARKED_NEW_SESSION_PREFIX)) keys.add(key);
  for (const key of seededKeys) if (key.startsWith(PARKED_NEW_SESSION_PREFIX)) keys.add(key);
  for (const mirror of draftMirrors.values()) {
    if (mirror.startsWith(PARKED_NEW_SESSION_PREFIX)) keys.add(mirror);
  }
  const storage = getBrowserStorage();
  if (storage) {
    for (let index = 0; index < storage.length; index += 1) {
      const stored = storage.key(index);
      const key = stored?.slice(STORAGE_PREFIX.length) ?? "";
      if (key.startsWith(PARKED_NEW_SESSION_PREFIX)) keys.add(key);
    }
  }
  return keys;
}

/**
 * Where a key's attachments are kept on disk: its durable key. A fresh composer (`new:<id>:<cwd>`)
 * has none of its own, so its screenshots belong to the project's parked draft it mirrors — the
 * mirror is registered by the app shell, whose effect runs after this component's, so the parked
 * key is also derived from the composer's own key. A session's composer has no mirror and keeps
 * its own. A key with none of these is page-only, and so are its attachments.
 */
function durableAttachmentsKey(key: string): string | null {
  const mirror = mirrorKeyFor(key);
  if (mirror) return mirror;
  return isStoredDraftKey(key) ? key : null;
}

/**
 * The same key for a read, which may not know the mirror yet.
 *
 * The composer asks for its attachments as it mounts, and the shell registers the parked key in
 * an effect of its own that can land a bit later. A read that misses the mirror finds the
 * project's parked record by the composer key's own shape. A write may take that shape only once
 * this page has the record in hand (see ownedDurableKeys): a stale composer key must not delete,
 * and must not write over, the record its successor owns.
 */
function durableAttachmentsKeyForRead(key: string): string | null {
  const durable = durableAttachmentsKey(key);
  if (durable) return durable;
  return parkedKeyForFreshComposerKey(key);
}

/** The durable key for a write or a removal: the mirror, the key's own record, or a parked record this page has opened. */
function durableAttachmentsKeyForWrite(key: string): string | null {
  const durable = durableAttachmentsKey(key);
  if (durable) return durable;
  const parked = parkedKeyForFreshComposerKey(key);
  return parked && ownedDurableKeys.has(parked) ? parked : null;
}

/**
 * The attachments a reload brings back. The draft's text is in localStorage and comes with the
 * first read; the bytes are in IndexedDB and arrive a moment later, so the composer asks for
 * them and takes them only while its own attachments are still empty — a screenshot pasted while
 * the store was opening is the user's, not something to overwrite.
 */
export async function loadStoredDraftAttachments(key: string): Promise<ChatDraft | null> {
  const durable = durableAttachmentsKeyForRead(key);
  if (!durable) return null;
  const stored = await loadDraftAttachments(durable);
  if (!stored || (stored.images.length === 0 && stored.files.length === 0)) return null;
  // The page has the bytes in hand now: from here it may throw them away, and only from here.
  ownedDurableKeys.add(durable);
  const current = drafts.get(key) ?? readStoredDraft(key) ?? { value: "", images: [] };
  if (current.images.length > 0 || (current.files?.length ?? 0) > 0) {
    // The composer has attachments of its own — a paste that landed while the store was opening,
    // or the answer of an earlier ask (a dev double mount). They win, and the caller gets the
    // draft it already holds rather than nothing, so a second ask cannot read as "nothing to
    // restore" and leave the pictures off the box.
    const owner = durable === key ? current : getDraft(durable);
    return cloneDraft({ ...current, value: current.value || owner?.value || "" });
  }
  // The durable key owns the prompt too (a fresh composer's parked draft). A composer that has no
  // text of its own takes it with the attachments: the bytes and the words they belong to are one
  // draft, and a page that rekeys the parked draft to its own composer key gets the text from
  // there, so this is the fallback for a page that asks for the bytes first.
  const durableDraft = durable === key ? current : getDraft(durable);
  const merged: ChatDraft = {
    value: current.value || durableDraft?.value || "",
    images: stored.images,
    ...(stored.files.length ? { files: stored.files } : {}),
  };
  drafts.set(key, cloneDraft(merged));
  return cloneDraft(merged);
}

/**
 * The durable attachment keys this page has written bytes to, or opened bytes from. Only such a
 * page may delete a record; see dropDurableRecord.
 */
const ownedDurableKeys = new Set<string>();

function persistDraftAttachments(
  key: string,
  draft: ChatDraft,
  options: DraftWriteOptions = {},
): void {
  const durable = durableAttachmentsKeyForWrite(key);
  if (!durable) return;
  const attachments: DraftAttachments = { images: draft.images, files: draft.files ?? [] };
  if (attachments.images.length === 0 && attachments.files.length === 0) {
    // A draft of text only writes no bytes: the composer's keystrokes are text, and a text-only
    // draft of a page that has not opened the record says nothing about it.
    if (options.keepDurableAttachmentsWhenEmpty) return;
    dropDurableRecord(durable);
    return;
  }
  ownedDurableKeys.add(durable);
  void saveDraftAttachments(durable, attachments);
}

/** The mirror write, with the guard that matters: a durable key never mirrors anything. */
function writeMirroredDraft(mirror: string, draft: ChatDraft): void {
  seededKeys.add(mirror);
  const previous = drafts.get(mirror);
  drafts.set(mirror, cloneDraft(draft));
  if (!draft.value) removeStoredDraft(mirror);
  else if (previous?.value !== draft.value) scheduleStoredDraft(mirror);
}

function readStoredDraft(key: string): ChatDraft | null {
  if (seededKeys.has(key) || !isStoredDraftKey(key)) return null;
  seededKeys.add(key);
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    const text = parsed && typeof parsed === "object" ? (parsed as { text?: unknown }).text : null;
    if (typeof text !== "string" || !text || text.length > MAX_STORED_DRAFT_LENGTH) return null;
    const draft: ChatDraft = { value: text, images: [] };
    drafts.set(key, draft);
    return draft;
  } catch {
    return null;
  }
}

function storedDraftTime(storage: DraftStorage, storageKey: string): number {
  try {
    const at = (JSON.parse(storage.getItem(storageKey) ?? "") as { at?: unknown } | null)?.at;
    return typeof at === "number" && Number.isFinite(at) ? at : 0;
  } catch {
    return 0;
  }
}

function storedDraftKeys(storage: DraftStorage): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
  }
  return keys;
}

function evictOldStoredDrafts(storage: DraftStorage): void {
  const keys = storedDraftKeys(storage);
  if (keys.length <= MAX_STORED_DRAFTS) return;
  keys
    .map((key) => ({ key, at: storedDraftTime(storage, key) }))
    .sort((a, b) => b.at - a.at)
    .slice(MAX_STORED_DRAFTS)
    .forEach(({ key }) => storage.removeItem(key));
}

function writeStoredDraft(storage: DraftStorage, key: string): void {
  const storageKey = STORAGE_PREFIX + key;
  const text = drafts.get(key)?.value ?? "";
  try {
    if (!text || text.length > MAX_STORED_DRAFT_LENGTH) {
      storage.removeItem(storageKey);
      return;
    }
    const added = storage.getItem(storageKey) === null;
    storage.setItem(storageKey, JSON.stringify({ text, at: Date.now() }));
    if (added) evictOldStoredDrafts(storage);
  } catch {
    // Full or refused storage: an older copy must not come back instead.
    try {
      storage.removeItem(storageKey);
    } catch {
      // Storage is best-effort; memory still holds the draft.
    }
  }
}

/** Writes the drafts changed since the last write. Leaving or hiding the page flushes at once. */
export function flushStoredDrafts(): void {
  if (storeTimer !== null) clearTimeout(storeTimer);
  storeTimer = null;
  const keys = [...pendingStores];
  pendingStores.clear();
  const storage = getBrowserStorage();
  if (!storage) return;
  for (const key of keys) writeStoredDraft(storage, key);
}

function flushWhenHidden(): void {
  if (document.visibilityState === "hidden") flushStoredDrafts();
}

function scheduleStoredDraft(key: string): void {
  if (!isStoredDraftKey(key) || storeHolds.has(key) || !getBrowserStorage()) return;
  pendingStores.add(key);
  if (!flushListenersAdded) {
    flushListenersAdded = true;
    window.addEventListener("pagehide", flushStoredDrafts);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", flushWhenHidden);
  }
  // Not reset by later changes: typing that goes on still gets written.
  if (storeTimer === null) storeTimer = setTimeout(flushStoredDrafts, STORE_INTERVAL_MS);
}

/** Written at once: a reload right after a send must not bring the text back. */
function removeStoredDraft(key: string): void {
  pendingStores.delete(key);
  if (!isStoredDraftKey(key)) return;
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Storage is best-effort.
  }
}

/**
 * Keeps a key's draft out of storage, its stored copy removed at once, until
 * the returned release runs: for text whose meaning a reload would lose (a
 * history edit's target, a command already running). Memory keeps the draft,
 * and the release stores it again.
 */
export function holdStoredDraft(key: string): () => void {
  storeHolds.set(key, (storeHolds.get(key) ?? 0) + 1);
  removeStoredDraft(key);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const holds = (storeHolds.get(key) ?? 1) - 1;
    if (holds > 0) {
      storeHolds.set(key, holds);
      return;
    }
    storeHolds.delete(key);
    if (drafts.get(key)?.value) scheduleStoredDraft(key);
  };
}

/** Removes every stored draft (signing out); drafts in this page's memory stay. */
export function clearStoredDrafts(): void {
  pendingStores.clear();
  void clearDraftAttachments();
  const storage = getBrowserStorage();
  if (!storage) return;
  try {
    storedDraftKeys(storage).forEach((key) => storage.removeItem(key));
  } catch {
    // Storage is best-effort.
  }
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
    ...(draft.files ? { files: draft.files.map((file) => ({ ...file })) } : {}),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  // Attached text files count: a composer holding only a file is not empty.
  return !draft.value && draft.images.length === 0 && (draft.files?.length ?? 0) === 0;
}

export function getDraft(key: string): ChatDraft | null {
  const draft = drafts.get(key) ?? readStoredDraft(key);
  return draft ? cloneDraft(draft) : null;
}

/**
 * A draft write's options. Only a page moving a draft between two of its own keys asks for this:
 * a parked draft's bytes live under the durable key the composer inherits, and the page doing the
 * move has not read them (that read is async), so its text-only draft must not answer for them.
 */
export interface DraftWriteOptions {
  keepDurableAttachmentsWhenEmpty?: boolean;
}

export function setDraft(key: string, draft: ChatDraft, options: DraftWriteOptions = {}): void {
  if (isEmptyDraft(draft)) {
    // Deleting the last character is the user clearing the box: the durable copy goes with it, so
    // a reload never offers back a prompt that was typed away.
    clearDraftWithMirror(key, { keepDurableAttachments: options.keepDurableAttachmentsWhenEmpty });
    return;
  }
  seededKeys.add(key);
  const previous = drafts.get(key);
  drafts.set(key, cloneDraft(draft));
  if (!draft.value) removeStoredDraft(key);
  else if (previous?.value !== draft.value) scheduleStoredDraft(key);
  const mirror = mirrorKeyFor(key);
  if (mirror) writeMirroredDraft(mirror, draft);
  persistDraftAttachments(key, draft, options);
}

interface ClearOptions {
  /** A send: the prompt and its pictures are gone, and the page clearing has them in hand. */
  sent?: boolean;
  /** A draft that is only moving between keys of one page: it says nothing about the bytes. */
  keepDurableAttachments?: boolean;
}

export function clearDraft(key: string, options: ClearOptions = {}): void {
  seededKeys.add(key);
  drafts.delete(key);
  removeStoredDraft(key);
  dropDurableRecord(durableAttachmentsKeyForWrite(key), options);
}

/**
 * A durable record leaves with a key, for one of three reasons.
 *
 * A send says the prompt and its pictures are gone. The user taking a picture out, or clearing the
 * box, says it through ownership: the page that wrote the bytes, or opened them into its composer,
 * is the page allowed to delete them. A page that is only moving a draft between two of its keys —
 * a reload's restore, the handover from the project's parked draft — has not read them and says
 * nothing: a delete from one of those writes is the screenshot lost on refresh.
 */
function dropDurableRecord(durable: string | null, mode: ClearOptions = {}): void {
  if (!durable || mode.keepDurableAttachments) return;
  if (!mode.sent && !ownedDurableKeys.delete(durable)) return;
  ownedDurableKeys.delete(durable);
  void removeDraftAttachments(durable);
}

/**
 * A prompt that was SENT: the composer's draft and the durable copy it mirrors are both gone, so
 * a reload never offers the prompt again. Only the send says this; a composer that is cleared
 * because the page moved on (a key switch, a mount that had nothing to show) leaves the
 * project's parked prompt alone, which is the whole point of parking it.
 */
export function clearSentDraft(key: string): void {
  clearDraftWithMirror(key, { sent: true });
}

function clearDraftWithMirror(key: string, mode: ClearOptions = {}): void {
  clearDraft(key, { ...mode, keepDurableAttachments: true });
  dropDurableRecord(durableAttachmentsKeyForWrite(key), mode);
  const mirror = mirrorKeyFor(key);
  if (!mirror) return;
  drafts.delete(mirror);
  removeStoredDraft(mirror);
  // The project's parked copy of a New Session draft holds the composer's pictures, and the
  // composer's key no longer points at it once the mirror is released, so this is where they go.
  dropDurableRecord(mirror, mode);
}

export function mergeRestoredSubmissionText(submitted: string, current: string): string {
  if (!submitted.trim()) return current;
  if (!current.trim()) return submitted;
  return `${submitted}\n\n${current}`;
}

export function mergeRestoredSubmissionDraft(
  submittedText: string,
  submittedImages: ChatDraftImage[] | undefined,
  currentText: string,
  currentImages: ChatDraftImage[],
  submittedFiles: ChatDraftFile[] | undefined = undefined,
  currentFiles: ChatDraftFile[] | undefined = undefined,
): ChatDraft {
  const images = [...(submittedImages ?? []), ...currentImages]
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(({ data, mimeType }) => ({ data, mimeType }));
  const files = [...(submittedFiles ?? []), ...(currentFiles ?? [])]
    .filter((file, index, all) => all.findIndex((other) => other.id === file.id) === index)
    .slice(0, CHAT_ATTACHMENT_MAX_FILES)
    .map((file) => ({ ...file }));

  return {
    value: mergeRestoredSubmissionText(submittedText, currentText),
    images,
    ...(files.length ? { files } : {}),
  };
}

export function restoreDraftSubmission(
  key: string,
  text: string,
  images?: ChatDraftImage[],
  files?: ChatDraftFile[],
): ChatDraft {
  const current = getDraft(key) ?? { value: "", images: [] };
  // A submission that carried attached files comes back as attachments, not as markup.
  const split = splitMessageForComposer(text);
  const restored = mergeRestoredSubmissionDraft(
    split.text,
    images,
    current.value,
    current.images,
    [...(files ?? []), ...split.files],
    current.files,
  );
  setDraft(key, restored);
  return restored;
}

export function rekeyDraft(
  previousKey: string,
  nextKey: string,
  currentDraft?: ChatDraft,
): ChatDraft | null {
  if (previousKey === nextKey) return currentDraft ? cloneDraft(currentDraft) : getDraft(nextKey);

  const storedPrevious = getDraft(previousKey);
  const previous = currentDraft && !isEmptyDraft(currentDraft)
    ? cloneDraft(currentDraft)
    : (storedPrevious ?? (currentDraft ? cloneDraft(currentDraft) : null));
  const next = getDraft(nextKey);
  // Moving a draft never throws its attachments away: the bytes live under the durable key that
  // both of these keys share, and the page that rekeys has not read them yet.
  clearDraft(previousKey, { keepDurableAttachments: true });
  if (!previous) return next;

  const merged = next ? mergeRekeyedDraft(next, previous) : previous;
  setDraft(nextKey, merged, { keepDurableAttachmentsWhenEmpty: true });
  return cloneDraft(merged);
}

/**
 * Two keys of one composer, merged.
 *
 * A reload moves the project's parked draft onto the composer's own key, and the composer has
 * usually been seeded from that same draft — so both keys carry the same prompt and the same
 * screenshot. Joining them as a submission merge repeats the words and shows the picture twice.
 * Only text that genuinely differs (two composers, one project) is worth joining.
 */
function mergeRekeyedDraft(next: ChatDraft, previous: ChatDraft): ChatDraft {
  const oneText =
    !next.value.trim() || !previous.value.trim() || next.value.trim() === previous.value.trim();
  const value = oneText
    ? (previous.value.trim() ? previous.value : next.value)
    : `${previous.value}\n\n${next.value}`;
  const files = [...(previous.files ?? []), ...(next.files ?? [])]
    .filter((file, index, all) => all.findIndex((other) => other.id === file.id) === index)
    .slice(0, CHAT_ATTACHMENT_MAX_FILES)
    .map((file) => ({ ...file }));
  return {
    value,
    images: dedupeDraftImages([...previous.images, ...next.images]),
    ...(files.length > 0 ? { files } : {}),
  };
}

/** The same picture by data, once. A 400 KB base64 string is a heavy Set key, so a fingerprint is. */
function dedupeDraftImages(images: ChatDraftImage[]): ChatDraftImage[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const fingerprint = `${image.mimeType}:${image.data.length}:${image.data.slice(0, 64)}`;
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });
}
