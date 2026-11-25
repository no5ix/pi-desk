// Fork-owned: the composer's content, one copy per device.
//
// A composer draft used to be *mirrored*: one shared record per composer that
// every device wrote to and read back, with last-write-wins on the writer's
// clock. The mirror's whole failure class came from that shared surface — a copy
// arriving from the server repainted the composer a user was typing in, a device
// whose clock ran ahead won every race, an empty copy wiped a prompt, an
// oversized attachment made the write land trimmed. Every one of those needed a
// guard, and the guards needed stamps, signatures and a "this composer stopped
// being mirrored" set.
//
// So the shared surface is gone. Each device keeps **its own** copy of what is
// in its composer, under `(composer identity, device id)`, and no device can
// edit or delete another's:
//
// - The device id is a segment of the record, never part of the key, and the
//   route derives the record from the caller's own device id. There is no
//   address that names somebody else's copy.
// - The store mints a write **token** the first time a device writes, hands it
//   to that device, and requires it on every later write and delete. A device
//   only ever holds its own token, so claiming a foreign device id is refused
//   (403) rather than honoured.
// - Nothing is applied to a composer automatically. Another device's copy is
//   data the user picks up (the row above the composer prepends it); it is never
//   a write that arrives on a poll.
//
// Keys are the same shared composer identities as before, never device
// randomness: `session:<id>` for an open session, `cwd:<folder>` for a fresh
// composer (`new:<draft id>:<cwd>` carries the device's own draft id, so that
// part is dropped), `parked-new:<cwd>` for a draft left behind. Two devices that
// open the same session, or a fresh composer in the same folder, are looking at
// the same composer, and each one's copy shows up on the others.
//
// A copy may be partial: the size caps drop what they cannot carry, and the
// counts are stored with the copy so the row can say so. A read-only copy that
// reports itself incomplete is honest; a *repainted* composer that quietly lost
// the user's screenshots is what used to destroy their work.

import type { ChatDraftFile, ChatDraftImage } from "./draft-store";

export type ComposerDeviceKind = "desktop" | "phone" | "tablet" | "other";

/**
 * The browser a copy was typed in, as its row's mark: Safari's compass, Chrome's
 * wheel, … `other` is a browser this app has no mark for, and its row wears the
 * device glyph instead.
 */
export type ComposerBrowser = "safari" | "chrome" | "edge" | "firefox" | "opera" | "other";

export interface ComposerDeviceCopy {
  /** The writing device's own id. The record's second segment. */
  deviceId: string;
  /** A short human label: `mac`, `iphone`, `ipad`, `windows`, … */
  label: string;
  kind: ComposerDeviceKind;
  /** The writing device's browser. The row's mark; `other` for an unknown one. */
  browser: ComposerBrowser;
  value: string;
  images: ChatDraftImage[];
  files: ChatDraftFile[];
  /** The writing device's clock. It only ever orders that device's own copies. */
  updatedAt: number;
  /** Attachments the caps refused, so the row can say the copy is incomplete. */
  droppedImages: number;
  droppedFiles: number;
}

/** A composer's copies live as long as a tab plausibly stays open. */
const COPY_TTL_MS = 24 * 60 * 60 * 1000;
/** Composers and copies kept per process; a long tail of closed tabs is dropped. */
const MAX_COMPOSERS = 40;
const MAX_COPIES_PER_COMPOSER = 8;
/** lib/draft-store.ts persists images up to this size; the copy carries the same. */
const MAX_IMAGE_DATA_CHARS = 400_000;
const MAX_IMAGES = 8;
/** lib/chat-attachments.ts caps a text attachment at 256 KB, and the composer at 5. */
const MAX_FILES = 5;
const MAX_VALUE_CHARS = 200_000;
/** The whole snapshot, counted in characters. A copy past this is refused. */
const MAX_SNAPSHOT_CHARS = 4_000_000;
export const MAX_DEVICE_ID_CHARS = 64;
export const MAX_LABEL_CHARS = 64;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const KINDS: readonly ComposerDeviceKind[] = ["desktop", "phone", "tablet", "other"];
const BROWSERS: readonly ComposerBrowser[] = ["safari", "chrome", "edge", "firefox", "opera", "other"];
export const MAX_BROWSER_CHARS = 24;

type StoredCopy = ComposerDeviceCopy & { token: string | null };
type GlobalWithCopies = typeof globalThis & {
  __piComposerCopies?: Map<string, Map<string, StoredCopy>>;
};

function composers(): Map<string, Map<string, StoredCopy>> {
  const scope = globalThis as GlobalWithCopies;
  if (!scope.__piComposerCopies) scope.__piComposerCopies = new Map();
  return scope.__piComposerCopies;
}

function copiesFor(composerKey: string, create: boolean): Map<string, StoredCopy> | undefined {
  const all = composers();
  let copies = all.get(composerKey);
  if (!copies && create) {
    copies = new Map();
    all.set(composerKey, copies);
  }
  return copies;
}

function pruneAll(now: number): void {
  const all = composers();
  for (const [composerKey, copies] of all) {
    for (const [deviceId, copy] of copies) {
      if (now - copy.updatedAt > COPY_TTL_MS) copies.delete(deviceId);
    }
    while (copies.size > MAX_COPIES_PER_COMPOSER) {
      // Drop this composer's oldest write, not an arbitrary one.
      let oldestId: string | null = null;
      let oldest = Infinity;
      for (const [deviceId, copy] of copies) {
        if (copy.updatedAt < oldest) {
          oldest = copy.updatedAt;
          oldestId = deviceId;
        }
      }
      if (oldestId === null) break;
      copies.delete(oldestId);
    }
    if (copies.size === 0) all.delete(composerKey);
  }
  while (all.size > MAX_COMPOSERS) {
    // The composer with the oldest surviving write goes first.
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [composerKey, copies] of all) {
      const newest = Math.max(...[...copies.values()].map((copy) => copy.updatedAt));
      if (newest < oldest) {
        oldest = newest;
        oldestKey = composerKey;
      }
    }
    if (oldestKey === null) break;
    all.delete(oldestKey);
  }
}

/** `new:<draft id>:<cwd>` carries a device's own draft id, so it cannot name the
 *  composer two devices share. The folder can. A session id and `parked-new:<cwd>`
 *  are shared identities already, so they pass through. */
export function composerCopyKey(draftKey: string): string {
  const match = /^new:[^:]*:([\s\S]+)$/.exec(draftKey);
  if (match) return `cwd:${match[1]}`;
  return draftKey;
}

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && DEVICE_ID_PATTERN.test(value);
}

function deviceKind(value: unknown): ComposerDeviceKind {
  return KINDS.includes(value as ComposerDeviceKind) ? (value as ComposerDeviceKind) : "other";
}

function labelFor(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  // The name the user reads is `${label}-content-copy`, so the label is a slug:
  // short, no spaces, no path or host that would leak into a visible name.
  const slug = raw.replace(/[^a-z0-9-]/g, "").slice(0, MAX_LABEL_CHARS);
  return slug || "device";
}

/** A browser slug, or `other`. The row draws a mark from a fixed set, so a slug
 *  outside it is the fallback, never a string handed to the renderer. */
function browserFor(value: unknown): ComposerBrowser {
  const slug = typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z]/g, "") : "";
  return BROWSERS.includes(slug as ComposerBrowser) ? slug as ComposerBrowser : "other";
}

/** A composer with nothing in it: nothing to offer the other devices. */
export function isCopyEmpty(copy: Pick<ComposerDeviceCopy, "value" | "images" | "files">): boolean {
  return !copy.value.trim() && copy.images.length === 0 && copy.files.length === 0;
}

/** Size guards. Oversized images and files are dropped and counted; a snapshot
 *  past the whole-copy cap is refused, since a copy that lost its text is no
 *  copy at all. */
export function normalizeDeviceCopy(input: {
  value?: unknown;
  images?: unknown;
  files?: unknown;
}): { ok: true; copy: Pick<ComposerDeviceCopy, "value" | "images" | "files" | "droppedImages" | "droppedFiles"> } | { ok: false; error: string } {
  const value = typeof input.value === "string" ? input.value : "";
  if (value.length > MAX_VALUE_CHARS) {
    return { ok: false, error: `Composer text is too large to sync (max ${MAX_VALUE_CHARS} characters).` };
  }
  const incomingImages = Array.isArray(input.images) ? input.images : [];
  const images = incomingImages.filter((image): image is ChatDraftImage => {
    return typeof image === "object" && image !== null
      && typeof (image as ChatDraftImage).data === "string"
      && typeof (image as ChatDraftImage).mimeType === "string"
      && (image as ChatDraftImage).data.length <= MAX_IMAGE_DATA_CHARS;
  }).slice(0, MAX_IMAGES);
  const incomingFiles = Array.isArray(input.files) ? input.files : [];
  const files = incomingFiles.filter((file): file is ChatDraftFile => {
    return typeof file === "object" && file !== null
      && typeof (file as ChatDraftFile).id === "string"
      && typeof (file as ChatDraftFile).name === "string"
      && typeof (file as ChatDraftFile).text === "string";
  }).slice(0, MAX_FILES);
  const droppedImages = Math.max(0, incomingImages.length - images.length);
  const droppedFiles = Math.max(0, incomingFiles.length - files.length);
  const copy = { value, images, files, droppedImages, droppedFiles };
  if (isCopyEmpty(copy)) return { ok: true, copy };
  let size = value.length;
  for (const image of images) size += image.data.length + image.mimeType.length;
  for (const file of files) size += file.text.length + file.name.length;
  if (size > MAX_SNAPSHOT_CHARS) return { ok: false, error: "Attachments are too large to sync." };
  return { ok: true, copy };
}

export type DeviceCopyWrite =
  | { ok: true; token: string; copy: ComposerDeviceCopy | null }
  | { ok: false; reason: "forbidden"; copy: ComposerDeviceCopy | null }
  | { ok: false; reason: "invalid"; error: string }
  | { ok: false; reason: "too-large"; error: string; copy: ComposerDeviceCopy | null };

/**
 * Writes this device's copy of the composer. The record is addressed by the
 * caller's own device id, so a write cannot land on another device's copy; a
 * device that already has one must present the token the store handed it.
 * An empty composer removes this device's copy.
 */
export function writeDeviceCopy(
  composerKey: string,
  deviceId: unknown,
  input: {
    token?: unknown;
    label?: unknown;
    kind?: unknown;
    browser?: unknown;
    value?: unknown;
    images?: unknown;
    files?: unknown;
    updatedAt?: unknown;
  },
): DeviceCopyWrite {
  if (!isDeviceId(deviceId)) return { ok: false, reason: "invalid", error: "deviceId is required." };
  const normalized = normalizeDeviceCopy(input);
  if (!normalized.ok) {
    return { ok: false, reason: "too-large", error: normalized.error, copy: publicCopy(copiesFor(composerKey, false)?.get(deviceId) ?? null) };
  }
  const copies = copiesFor(composerKey, true)!;
  const existing = copies.get(deviceId);
  const token = typeof input.token === "string" && input.token ? input.token : null;
  if (existing?.token && existing.token !== token) {
    // Somebody is writing under a device id that is not theirs. The token is the
    // only thing that tells the two apart, and this is the rule the whole design
    // rests on: a device never edits another device's copy.
    return { ok: false, reason: "forbidden", copy: publicCopy(existing) };
  }
  const minted = existing?.token ?? crypto.randomUUID();
  if (isCopyEmpty(normalized.copy)) {
    // The composer is empty: this device has nothing to offer, and a stale copy
    // on another device would offer the user a prompt they have already sent.
    copies.delete(deviceId);
    if (copies.size === 0) composers().delete(composerKey);
    return { ok: true, token: minted, copy: null };
  }
  const stamp = typeof input.updatedAt === "number" && Number.isFinite(input.updatedAt) ? input.updatedAt : Date.now();
  // A device's own clock orders its own copies; keep it moving forward so a clock
  // that jumps back cannot make this device's newer content look older to itself.
  const updatedAt = existing ? Math.max(stamp, existing.updatedAt + 1) : stamp;
  const record: StoredCopy = {
    deviceId,
    label: labelFor(input.label),
    kind: deviceKind(input.kind),
    browser: browserFor(input.browser),
    value: normalized.copy.value,
    images: normalized.copy.images,
    files: normalized.copy.files,
    updatedAt,
    droppedImages: normalized.copy.droppedImages,
    droppedFiles: normalized.copy.droppedFiles,
    token: minted,
  };
  copies.set(deviceId, record);
  pruneAll(updatedAt);
  return { ok: true, token: minted, copy: publicCopy(record) };
}

function publicCopy(record: StoredCopy | null | undefined): ComposerDeviceCopy | null {
  if (!record) return null;
  // The token never leaves the store: it is the write key, not content.
  return {
    deviceId: record.deviceId,
    label: record.label,
    kind: record.kind,
    browser: record.browser,
    value: record.value,
    images: record.images,
    files: record.files,
    updatedAt: record.updatedAt,
    droppedImages: record.droppedImages,
    droppedFiles: record.droppedFiles,
  };
}

/** Desktop copies first, then phones, then tablets: the laptop's draft is the one
 *  a phone shows at the top, and an iPad lists the mac above the phone. Within a
 *  kind, the most recent write leads. */
const KIND_ORDER: Record<ComposerDeviceKind, number> = { desktop: 0, phone: 1, tablet: 2, other: 3 };

export function compareDeviceCopies(a: ComposerDeviceCopy, b: ComposerDeviceCopy): number {
  const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (byKind !== 0) return byKind;
  if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
  return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
}

/** The other devices' copies of this composer. `selfDeviceId`'s own copy is
 *  never included: this device is looking at its own composer already. */
export function readDeviceCopies(composerKey: string, selfDeviceId?: unknown): ComposerDeviceCopy[] {
  pruneAll(Date.now());
  const copies = copiesFor(composerKey, false);
  if (!copies) return [];
  const self = isDeviceId(selfDeviceId) ? selfDeviceId : null;
  const list = [...copies.values()]
    .filter((record) => record.deviceId !== self)
    .map((record) => publicCopy(record)!)
    .filter((copy) => !isCopyEmpty(copy));
  return list.sort(compareDeviceCopies);
}

export type DeviceCopyDelete =
  | { ok: true }
  | { ok: false; reason: "forbidden" }
  | { ok: false; reason: "invalid"; error: string };

/** Removes this device's own copy — the prompt was sent, so it is no longer a draft. */
export function deleteDeviceCopy(composerKey: string, deviceId: unknown, token: unknown): DeviceCopyDelete {
  if (!isDeviceId(deviceId)) return { ok: false, reason: "invalid", error: "deviceId is required." };
  const copies = copiesFor(composerKey, false);
  const existing = copies?.get(deviceId);
  if (!existing) return { ok: true };
  if (existing.token && existing.token !== (typeof token === "string" ? token : null)) {
    return { ok: false, reason: "forbidden" };
  }
  copies!.delete(deviceId);
  if (copies!.size === 0) composers().delete(composerKey);
  return { ok: true };
}

/** Test seam: the store lives on globalThis so a route's hot reload keeps it. */
export function clearAllComposerCopies(): void {
  const scope = globalThis as GlobalWithCopies;
  if (scope.__piComposerCopies) scope.__piComposerCopies.clear();
}
