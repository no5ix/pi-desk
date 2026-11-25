"use client";

// Fork-owned: the composer's per-device copies, as the client sees them.
//
// This device writes **its own** copy of what is in its composer
// (`PUT /api/composer-copies`, under `(composer identity, this device id)`) and
// reads back the *other* devices' copies. Those copies are never applied to the
// composer. They are listed in a row above it, and the user picks one up — the
// row's click prepends its content into the composer (`components/ComposerDeviceCopies.tsx`).
//
// That is the whole design, and it is deliberate: the shared draft this replaces
// wrote every device into one record and read it back on a poll, so a copy
// arriving from the server repainted the composer the user was typing in. The
// guards that fixed it (a last-write-wins stamp, a "loaded drafts are not my
// edit" signature, a blank-copy refusal, a set of composers too large to
// mirror) all existed to protect a surface that was being written from two
// places at once. Here each device writes one record and reads the others as
// data, so none of that machinery is needed:
//
// - No device writes another's copy: the route derives the record from the
//   caller's own device id and checks the write token the store handed it.
// - Nothing overwrites the composer while the user types, because a copy only
//   reaches the composer through a click.
// - A copy that lost an attachment to the caps stays on the list with a note
//   about it, instead of repainting a composer without the screenshots.
//
// Pushes are debounced so typing costs one request per pause; polls run only
// while the tab is visible, because a hidden tab has nobody reading it.

import type { ChatDraftFile, ChatDraftImage } from "./draft-store";
import {
  compareDeviceCopies,
  composerCopyKey,
  type ComposerDeviceCopy,
} from "./composer-copy-store";
import { getDeviceIdentity } from "./device-identity";

export type { ComposerDeviceCopy };

const PUSH_DEBOUNCE_MS = 700;
/** Exported for the test that waits out a full poll: a watcher that must go quiet
 *  is only provable over one interval. */
export const POLL_INTERVAL_MS = 4_000;
const TOKEN_HEADER = "x-composer-copy-token";

interface DraftSnapshot {
  value: string;
  images: ChatDraftImage[];
  files: ChatDraftFile[];
}

const pendingPushes = new Map<string, DraftSnapshot>();
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<(copies: ComposerDeviceCopy[]) => void>>();
/**
 * Composers this device may no longer write: the server said the copy is another
 * device's (403), or the snapshot is past what a copy may hold (413). Pushes
 * stop for the tab's life — re-PUTting a snapshot that answers the same way on
 * every keystroke is traffic that changes nothing. The rows keep polling: a
 * device that cannot write can still read the others.
 */
const pushRefused = new Set<string>();

function isBlank(snapshot: DraftSnapshot): boolean {
  return !snapshot.value.trim() && snapshot.images.length === 0 && snapshot.files.length === 0;
}

function self() {
  return getDeviceIdentity();
}

function emit(key: string, copies: ComposerDeviceCopy[]): void {
  for (const listener of listeners.get(key) ?? []) listener(copies);
}

async function sendPush(key: string): Promise<void> {
  const snapshot = pendingPushes.get(key);
  if (!snapshot) return;
  const device = self();
  try {
    const response = await fetch("/api/composer-copies", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key,
        deviceId: device.id,
        token: device.tokenFor(key),
        label: device.label,
        kind: device.kind,
        ...snapshot,
        updatedAt: Date.now(),
      }),
    });
    if (response.status === 403 || response.status === 413) {
      // The store will not take this composer's copy from this device. Keep the
      // user's content in the composer and stop asking.
      pushRefused.add(key);
      pendingPushes.delete(key);
      return;
    }
    if (!response.ok) {
      // The next edit retries; a draft that cannot sync stays on this device.
      pendingPushes.set(key, snapshot);
      return;
    }
    const data = await response.json().catch(() => null) as { token?: unknown } | null;
    if (typeof data?.token === "string" && data.token) device.rememberToken(key, data.token);
    // The push that landed is the composer's current content; a newer edit that
    // arrived while the request was in flight stays queued.
    if (pendingPushes.get(key) === snapshot) pendingPushes.delete(key);
  } catch {
    // Offline, a closed tunnel, a server that is restarting: the same.
    pendingPushes.set(key, snapshot);
  }
}

function cancelPush(key: string): void {
  pendingPushes.delete(key);
  const timer = pushTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pushTimers.delete(key);
  }
}

/** Mirrors this device's composer. Nothing else can write this record. */
export function pushDeviceCopy(draftKey: string, snapshot: DraftSnapshot): void {
  const key = composerCopyKey(draftKey);
  if (isBlank(snapshot)) {
    // The composer was sent, or emptied. Its copy goes with it, so another
    // device's row never offers a prompt that has already been sent.
    clearDeviceCopy(draftKey);
    return;
  }
  if (pushRefused.has(key)) return;
  pendingPushes.set(key, snapshot);
  const timer = pushTimers.get(key);
  if (timer) clearTimeout(timer);
  pushTimers.set(key, setTimeout(() => {
    pushTimers.delete(key);
    void sendPush(key);
  }, PUSH_DEBOUNCE_MS));
}

/** Drops this device's copy — the prompt was sent, so it is no longer a draft. */
export function clearDeviceCopy(draftKey: string): void {
  const key = composerCopyKey(draftKey);
  cancelPush(key);
  const device = self();
  const token = device.tokenFor(key);
  void fetch(`/api/composer-copies?key=${encodeURIComponent(key)}&deviceId=${encodeURIComponent(device.id)}`, {
    method: "DELETE",
    headers: token ? { [TOKEN_HEADER]: token } : undefined,
  }).catch(() => {});
}

async function poll(key: string): Promise<void> {
  const device = self();
  try {
    const response = await fetch(
      `/api/composer-copies?key=${encodeURIComponent(key)}&deviceId=${encodeURIComponent(device.id)}`,
      { cache: "no-store" },
    );
    if (!response.ok) return;
    const data = await response.json().catch(() => null) as { copies?: ComposerDeviceCopy[] } | null;
    const copies = Array.isArray(data?.copies) ? data.copies : [];
    emit(key, copies.slice().sort(compareDeviceCopies));
  } catch {
    // A poll that fails is a poll that says nothing.
  }
}

/** The other devices' copies of this composer, for the rows above it. */
export function watchDeviceCopies(draftKey: string, onCopies: (copies: ComposerDeviceCopy[]) => void): () => void {
  const key = composerCopyKey(draftKey);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onCopies);
  const stop = () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    set!.delete(onCopies);
    if (set!.size === 0) listeners.delete(key);
  };
  const tick = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void poll(key);
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") void poll(key);
  };
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisible);
  void poll(key);
  return stop;
}

/** Test seam: forget queued pushes, watchers and refusals. */
export function resetComposerCopies(): void {
  for (const timer of pushTimers.values()) clearTimeout(timer);
  pendingPushes.clear();
  pushTimers.clear();
  listeners.clear();
  pushRefused.clear();
}
