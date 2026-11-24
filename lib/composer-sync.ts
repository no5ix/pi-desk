"use client";

// Fork-owned: the composer's cross-device mirror.
//
// The laptop and the phone drive the same server, and a composer draft is the
// one piece of state that never reached it: it lived in localStorage
// (lib/draft-store.ts). This module mirrors the live composer to the server
// (PUT /api/composer-draft) on a short debounce, reads it back on a poll, and
// hands the copy to the composer through the callback it registered.
//
// Rules that keep it usable:
// - The writing device stamps `updatedAt`; the newest write wins on the server,
//   and a device applies a remote copy only when it is newer than the last
//   thing it typed itself — typing is never overwritten by an echo.
// - An empty composer is a DELETE, never a write: the empty snapshot a send
//   leaves behind must not land on a composer that has a prompt in it.
// - A draft the mirror cannot carry (413: attachments past the caps) stops being
//   mirrored for the tab's life. The composer keeps the user's attachments; the
//   other device keeps the last copy that fitted.
// - The poll is per sync key and only runs while the tab is visible.
// - Nothing here throws at the composer: a draft that cannot sync is a draft
//   that stays local, which is how it behaved before.

import type { ChatDraftFile, ChatDraftImage } from "./draft-store";
import { composerSyncKey, type ComposerDraftSnapshot } from "./composer-draft-store";

export type { ComposerDraftSnapshot };

const PUSH_DEBOUNCE_MS = 700;
/** Exported for the test that waits out a full poll: a watcher that must go quiet is
 *  only provable over one interval. */
export const POLL_INTERVAL_MS = 4_000;

const pendingPushes = new Map<string, ComposerDraftSnapshot>();
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<(snapshot: ComposerDraftSnapshot) => void>>();
/**
 * Composers the mirror cannot carry: the server answered that the attachments are
 * larger than it may hold (a pasted screenshot is routinely bigger than the image
 * cap). Such a composer stays local for the tab's life — the draft the user is
 * editing beats the copy the other device has. Trimming it and mirroring the trim
 * is what made attachments vanish: the composer polled its own shrunken copy back.
 */
const unmirrored = new Set<string>();
/**
 * The newest stamp this device handed to its own composer, per sync key. The composer's
 * echo guard compares a remote copy against it, so it must never fall behind a copy the
 * server can still hand back. A key that stopped being mirrored used to answer `0`, and
 * every keystroke of the composer that owns it reset the guard to "nothing of mine is on
 * the server"; the poll that was still running then repainted the composer with the last
 * snapshot the store had accepted — the queued text from before the screenshots the user
 * had just uploaded, with their typing and their images thrown away.
 */
const localStamps = new Map<string, number>();
/** A stamp for this device's own write: never behind the last one, never in the past. */
function nextStamp(key: string): number {
  const stamp = Math.max(Date.now(), (localStamps.get(key) ?? 0) + 1);
  localStamps.set(key, stamp);
  return stamp;
}

/** Nothing in the composer. A send clears it, and the mirror clears its copy too. */
function isBlankDraft(snapshot: { value: string; images: unknown[]; files: unknown[] }): boolean {
  return snapshot.value.trim().length === 0 && snapshot.images.length === 0 && snapshot.files.length === 0;
}

function emit(key: string, snapshot: ComposerDraftSnapshot): void {
  for (const listener of listeners.get(key) ?? []) listener(snapshot);
}

async function sendPush(key: string): Promise<void> {
  const snapshot = pendingPushes.get(key);
  if (!snapshot) return;
  try {
    const response = await fetch("/api/composer-draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, ...snapshot }),
    });
    if (response.status === 413) {
      // The draft is too large for the mirror (the text cap, the attachments, the body
      // cap). Stop mirroring this composer: the user keeps their work, and the other
      // device keeps the last copy that fitted. Re-PUTting it every keystroke is
      // traffic that answers the same way.
      unmirrored.add(key);
      pendingPushes.delete(key);
      const timer = pushTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        pushTimers.delete(key);
      }
      return;
    }
    if (response.status === 409) {
      // A newer draft is stored: show it, and stop pushing the old text.
      const data = await response.json().catch(() => null) as { draft?: ComposerDraftSnapshot } | null;
      if (data?.draft && typeof data.draft.updatedAt === "number") emit(key, data.draft);
      return;
    }
    if (!response.ok) {
      // The next edit retries; a draft that cannot sync stays local.
      pendingPushes.set(key, snapshot);
    }
  } catch {
    // Offline, a closed tunnel, a server that is restarting: the same.
  }
}

/** Mirrors the composer. Returns the stamp this write carries, so the caller can
 *  recognise its own echo. */
export function pushComposerDraft(
  draftKey: string,
  snapshot: { value: string; images: ChatDraftImage[]; files: ChatDraftFile[] },
): number {
  const key = composerSyncKey(draftKey);
  if (isBlankDraft(snapshot)) {
    // The composer was sent. Its server copy goes with it, and no empty snapshot takes
    // its place: a poll that hands an empty composer to a device that is typing wipes
    // a prompt and its attachments off the screen.
    clearComposerDraft(draftKey);
    return nextStamp(key);
  }
  if (unmirrored.has(key)) {
    // Not mirrored, and still this device's own text: the stamp moves so the guard keeps
    // refusing the server's older copy, which is the whole point of staying local.
    return nextStamp(key);
  }
  const stamped: ComposerDraftSnapshot = { ...snapshot, updatedAt: nextStamp(key) };
  pendingPushes.set(key, stamped);
  const timer = pushTimers.get(key);
  if (timer) clearTimeout(timer);
  pushTimers.set(key, setTimeout(() => {
    pushTimers.delete(key);
    void sendPush(key);
  }, PUSH_DEBOUNCE_MS));
  return stamped.updatedAt;
}

/** Drops the server's copy — the composer was sent, so the draft is gone. */
export function clearComposerDraft(draftKey: string): void {
  const key = composerSyncKey(draftKey);
  pendingPushes.delete(key);
  const timer = pushTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    pushTimers.delete(key);
  }
  void fetch(`/api/composer-draft?key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(() => {});
}

async function poll(key: string): Promise<void> {
  try {
    const response = await fetch(`/api/composer-draft?key=${encodeURIComponent(key)}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json().catch(() => null) as { draft?: ComposerDraftSnapshot } | null;
    const draft = data?.draft;
    if (draft && typeof draft.updatedAt === "number") emit(key, draft);
  } catch {
    // A poll that fails is a poll that says nothing.
  }
}

/** Receives the other devices' copies of this composer. */
export function watchComposerDraft(draftKey: string, onRemote: (snapshot: ComposerDraftSnapshot) => void): () => void {
  const key = composerSyncKey(draftKey);
  if (unmirrored.has(key)) {
    // Its draft stays on this device: no polls, and so no copies to apply.
    return () => {};
  }
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onRemote);
  // A 413 marks the key mid-session, while this watcher's interval is already running;
  // the registration check above cannot un-register it, so the tick does. A composer
  // that stopped being mirrored must stop polling, or the last snapshot the store
  // accepted comes back and repaints the composer over what the user is typing.
  const stop = () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    set!.delete(onRemote);
  };
  const tick = () => {
    if (unmirrored.has(key)) return stop();
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    void poll(key);
  };
  const onVisible = () => {
    if (unmirrored.has(key)) return stop();
    if (document.visibilityState === "visible") void poll(key);
  };
  const timer = setInterval(tick, POLL_INTERVAL_MS);
  document.addEventListener("visibilitychange", onVisible);
  void poll(key);
  return stop;
}
