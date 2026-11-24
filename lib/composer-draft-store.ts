// Fork-owned: the server-side copy of what is in a composer.
//
// A composer draft lived in localStorage (lib/draft-store.ts) — one per browser,
// so a prompt typed on the laptop was invisible on the phone. The app is one
// server that several devices drive, so the copy that syncs has to sit here:
// the draft a device is editing is mirrored under a shared key, and every other
// device reads it back.
//
// Keys are shared identities, never device randomness: `session:<id>` for an
// open session (the id is the session file's) and `cwd:<folder>` for a fresh
// composer, where two devices that open a new session in the same folder are
// writing the same draft. See composerSyncKey().
//
// Writes are last-write-wins on the client's own clock (`updatedAt`): the
// composer pushes on a short debounce, so the text that was typed last is the
// text everybody sees. A device that is typing has a newer `updatedAt` than the
// copy it is about to receive, so its own keystrokes never come back over it.

import type { ChatDraftFile, ChatDraftImage } from "./draft-store";

export interface ComposerDraftSnapshot {
  value: string;
  images: ChatDraftImage[];
  files: ChatDraftFile[];
  /** The writing client's clock. The newest write wins. */
  updatedAt: number;
}

/** A draft is worth keeping as long as a tab plausibly stays open. */
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
/** The local store's own cap (lib/draft-store.ts), so the server never holds a
 *  long tail of drafts no browser is showing. */
const MAX_DRAFTS = 40;
/** lib/draft-store.ts persists images up to this size; the same rule keeps one
 *  composer's attachments from filling the process. */
const MAX_IMAGE_DATA_CHARS = 400_000;
const MAX_IMAGES = 8;
/** A text attachment is 256 KB at most (lib/chat-attachments.ts). */
const MAX_FILES = 8;
const MAX_VALUE_CHARS = 200_000;
/** The whole snapshot, counted in characters. Beyond this the write is refused
 *  rather than truncated: a silently shortened attachment is worse than none. */
const MAX_SNAPSHOT_CHARS = 4_000_000;

type GlobalWithDrafts = typeof globalThis & { __piComposerDrafts?: Map<string, ComposerDraftSnapshot> };

function drafts(): Map<string, ComposerDraftSnapshot> {
  const scope = globalThis as GlobalWithDrafts;
  if (!scope.__piComposerDrafts) scope.__piComposerDrafts = new Map();
  return scope.__piComposerDrafts;
}

function prune(now: number): void {
  const store = drafts();
  for (const [key, draft] of store) {
    if (now - draft.updatedAt > DRAFT_TTL_MS) store.delete(key);
  }
  while (store.size > MAX_DRAFTS) {
    // Drop the oldest write, not an arbitrary entry.
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [key, draft] of store) {
      if (draft.updatedAt < oldest) {
        oldest = draft.updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey === null) break;
    store.delete(oldestKey);
  }
}

/** `new:<draft id>:<cwd>` carries a device's own draft id, so it cannot be the
 *  key two devices share. The folder can. A session id and `parked-new:<cwd>`
 *  are already shared, so they pass through. */
export function composerSyncKey(draftKey: string): string {
  const match = /^new:[^:]*:([\s\S]+)$/.exec(draftKey);
  if (match) return `cwd:${match[1]}`;
  return draftKey;
}

export function readComposerDraft(key: string): ComposerDraftSnapshot | null {
  const store = drafts();
  const draft = store.get(key);
  if (!draft) return null;
  if (Date.now() - draft.updatedAt > DRAFT_TTL_MS) {
    store.delete(key);
    return null;
  }
  return draft;
}

/** Size guards, applied to the incoming snapshot. Returns null when the payload
 *  is too large to keep at all; oversized images and files are dropped. */
export function normalizeComposerDraft(input: {
  value?: unknown;
  images?: unknown;
  files?: unknown;
  updatedAt?: unknown;
}): { ok: true; draft: ComposerDraftSnapshot } | { ok: false; error: string } {
  const value = typeof input.value === "string" ? input.value : "";
  if (value.length > MAX_VALUE_CHARS) return { ok: false, error: `Composer text is too large to sync (max ${MAX_VALUE_CHARS} characters).` };
  const images = (Array.isArray(input.images) ? input.images : []).filter((image): image is ChatDraftImage => {
    return typeof image === "object" && image !== null
      && typeof (image as ChatDraftImage).data === "string"
      && typeof (image as ChatDraftImage).mimeType === "string"
      && (image as ChatDraftImage).data.length <= MAX_IMAGE_DATA_CHARS;
  }).slice(0, MAX_IMAGES);
  const files = (Array.isArray(input.files) ? input.files : []).filter((file): file is ChatDraftFile => {
    return typeof file === "object" && file !== null
      && typeof (file as ChatDraftFile).id === "string"
      && typeof (file as ChatDraftFile).name === "string"
      && typeof (file as ChatDraftFile).text === "string";
  }).slice(0, MAX_FILES);
  const draft: ComposerDraftSnapshot = {
    value,
    images,
    files,
    updatedAt: typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now(),
  };
  let size = value.length;
  for (const image of images) size += image.data.length + image.mimeType.length;
  for (const file of files) size += file.text.length + file.name.length;
  if (size > MAX_SNAPSHOT_CHARS) return { ok: false, error: "Attachments are too large to sync." };
  return { ok: true, draft };
}

/** Last-write-wins. A stale write is refused and the stored copy is returned,
 *  so the client can see what it is behind. */
export function writeComposerDraft(
  key: string,
  input: Parameters<typeof normalizeComposerDraft>[0],
): { ok: true; draft: ComposerDraftSnapshot } | { ok: false; error: string; draft?: ComposerDraftSnapshot } {
  const normalized = normalizeComposerDraft(input);
  if (!normalized.ok) return normalized;
  const store = drafts();
  const current = store.get(key);
  if (current && current.updatedAt > normalized.draft.updatedAt) {
    return { ok: false, error: "A newer draft is already stored.", draft: current };
  }
  store.set(key, normalized.draft);
  prune(normalized.draft.updatedAt);
  return { ok: true, draft: normalized.draft };
}

export function clearComposerDraft(key: string): void {
  drafts().delete(key);
}

/** Test seam: the store lives on globalThis so a route's hot reload keeps it. */
export function clearAllComposerDrafts(): void {
  drafts().clear();
}
