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
// - The poll is per sync key and only runs while the tab is visible.
// - Nothing here throws at the composer: a draft that cannot sync is a draft
//   that stays local, which is how it behaved before.

import type { ChatDraftFile, ChatDraftImage } from "./draft-store";
import { composerSyncKey, type ComposerDraftSnapshot } from "./composer-draft-store";

export type { ComposerDraftSnapshot };

const PUSH_DEBOUNCE_MS = 700;
const POLL_INTERVAL_MS = 4_000;

const pendingPushes = new Map<string, ComposerDraftSnapshot>();
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<(snapshot: ComposerDraftSnapshot) => void>>();

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
  const stamped: ComposerDraftSnapshot = { ...snapshot, updatedAt: Date.now() };
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
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onRemote);
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
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    set!.delete(onRemote);
  };
}
