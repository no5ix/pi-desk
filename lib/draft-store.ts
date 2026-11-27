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
 * parked draft. The id is the first segment and the cwd the rest, because a Windows cwd carries a
 * drive letter's colon.
 */
function parkedKeyForFreshComposerKey(key: string): string | null {
  if (!key.startsWith(NEW_SESSION_PREFIX)) return null;
  const rest = key.slice(NEW_SESSION_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator <= 0 || separator === rest.length - 1) return null;
  return parkedNewSessionDraftKey(rest.slice(separator + 1));
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
  const parked = parkedKeyForFreshComposerKey(key);
  if (parked) return parked;
  return isStoredDraftKey(key) ? key : null;
}

/**
 * The attachments a reload brings back. The draft's text is in localStorage and comes with the
 * first read; the bytes are in IndexedDB and arrive a moment later, so the composer asks for
 * them and takes them only while its own attachments are still empty — a screenshot pasted while
 * the store was opening is the user's, not something to overwrite.
 */
export async function loadStoredDraftAttachments(key: string): Promise<ChatDraft | null> {
  const durable = durableAttachmentsKey(key);
  if (!durable) return null;
  const stored = await loadDraftAttachments(durable);
  if (!stored || (stored.images.length === 0 && stored.files.length === 0)) return null;
  const current = drafts.get(key) ?? readStoredDraft(key) ?? { value: "", images: [] };
  if (current.images.length > 0 || (current.files?.length ?? 0) > 0) return null;
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
 * The draft's attachments to the durable store. Called with every draft write — the composer
 * writes on each keystroke — and the store skips the write when the attachments have not changed,
 * so typing never carries a screenshot. Best-effort: a refused store loses nothing in memory.
 */
function persistDraftAttachments(key: string, draft: ChatDraft): void {
  const durable = durableAttachmentsKey(key);
  if (!durable) return;
  const attachments: DraftAttachments = { images: draft.images, files: draft.files ?? [] };
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

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    // Deleting the last character is the user clearing the box: the durable copy goes with it,
    // so a reload never offers back a prompt that was typed away.
    clearDraftWithMirror(key);
    return;
  }
  seededKeys.add(key);
  const previous = drafts.get(key);
  drafts.set(key, cloneDraft(draft));
  if (!draft.value) removeStoredDraft(key);
  else if (previous?.value !== draft.value) scheduleStoredDraft(key);
  const mirror = mirrorKeyFor(key);
  if (mirror) writeMirroredDraft(mirror, draft);
  persistDraftAttachments(key, draft);
}

export function clearDraft(key: string): void {
  seededKeys.add(key);
  drafts.delete(key);
  removeStoredDraft(key);
  const durable = durableAttachmentsKey(key);
  if (durable) void removeDraftAttachments(durable);
}

/**
 * A prompt that was SENT: the composer's draft and the durable copy it mirrors are both gone, so
 * a reload never offers the prompt again. Only the send says this; a composer that is cleared
 * because the page moved on (a key switch, a mount that had nothing to show) leaves the
 * project's parked prompt alone, which is the whole point of parking it.
 */
export function clearSentDraft(key: string): void {
  clearDraftWithMirror(key);
}

function clearDraftWithMirror(key: string): void {
  clearDraft(key);
  const mirror = mirrorKeyFor(key);
  if (!mirror) return;
  drafts.delete(mirror);
  removeStoredDraft(mirror);
  // The mirror is released when a composer unmounts, and a key whose mirror has gone has no
  // durable attachment key of its own, so the parked draft's picture is cleared from here.
  void removeDraftAttachments(mirror);
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
  clearDraft(previousKey);
  if (!previous) return next;

  const merged = next
    ? mergeRestoredSubmissionDraft(next.value, next.images, previous.value, previous.images)
    : previous;
  setDraft(nextKey, merged);
  return cloneDraft(merged);
}
