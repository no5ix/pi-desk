"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  forgetLocalPins,
  localPinsMigrated,
  markLocalPinsMigrated,
  pinnedIdsOf,
  pinnedProjectRootsOf,
  pinRequestsForLocalPins,
  projectPinKeyOf,
  readLocalPins,
} from "@/lib/sidebar-pins";
import { useSessionUiState } from "./useSessionUiState";

/**
 * The sidebar's pins, from the server (`/api/sessions/ui-state`).
 *
 * A pin is the app's, not the browser's: one server serves Safari, Edge, a
 * phone and the desktop shell, and a pin made in one shows in all of them.
 * Reads come from `useSessionUiState`, writes go through it optimistically,
 * and `noteRevision()` (fed by the running stream) is how a pin made in
 * another window arrives here.
 *
 * `onWriteFailed` runs when the server refuses a pin: the caller turns it into
 * a notice in the user's language (`sidebar.uiStateFailed`).
 */
export function useSidebarPins(onWriteFailed?: (message: string) => void): SidebarPinsApi {
  const uiState = useSessionUiState();
  const { apply, noteRevision, refresh, synced, state } = uiState;

  const pinnedIds = useMemo(() => pinnedIdsOf(state), [state]);
  const pinnedProjectRoots = useMemo(() => pinnedProjectRootsOf(state), [state]);

  // The reason of the write that just failed, from the hook's own ref: `error`
  // is state, and the render that publishes it lands after a write's `.then`.
  const lastErrorRef = uiState.lastErrorRef;
  const writeFailedRef = useRef(onWriteFailed);
  writeFailedRef.current = onWriteFailed;

  // Once per browser: an older build kept pins in this browser's localStorage,
  // so the first window that syncs pushes them onto the server and retires the
  // keys. It runs after `synced` so the push lands on top of the server's real
  // state (pins are a set: what another device pinned stays). A refused write
  // leaves the browser un-migrated, and the next load tries again.
  const migrationStartedRef = useRef(false);
  useEffect(() => {
    if (!synced || migrationStartedRef.current) return;
    migrationStartedRef.current = true;
    if (localPinsMigrated()) {
      forgetLocalPins();
      return;
    }
    const requests = pinRequestsForLocalPins(readLocalPins());
    if (requests.length === 0) {
      markLocalPinsMigrated();
      forgetLocalPins();
      return;
    }
    void (async () => {
      for (const request of requests) {
        if (!(await apply(request))) return;
      }
      markLocalPinsMigrated();
      forgetLocalPins();
    })();
  }, [apply, synced]);

  // The running stream carries the state's revision and a pin made elsewhere
  // arrives with it (the sidebar passes it to `noteRevision`). A window that
  // was in the background while the stream went quiet — a shared stream whose
  // tab lost the leader election, a phone asleep in a pocket — catches up on
  // the way back in.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onfocus = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onfocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onfocus);
    };
  }, [refresh]);

  const toggleSessionPin = useCallback((id: string): Promise<boolean> => {
    return apply({ action: "set", ids: [id], pinned: !pinnedIds.has(id) }).then((ok) => {
      if (!ok) writeFailedRef.current?.(lastErrorRef.current ?? "ui-state");
      return ok;
    });
  }, [apply, lastErrorRef, pinnedIds]);

  const toggleProjectPin = useCallback((root: string): Promise<boolean> => {
    return apply({
      action: "pin-project",
      projectKey: projectPinKeyOf(root),
      root,
      pinned: !pinnedProjectRoots.has(root),
    }).then((ok) => {
      if (!ok) writeFailedRef.current?.(lastErrorRef.current ?? "ui-state");
      return ok;
    });
  }, [apply, lastErrorRef, pinnedProjectRoots]);

  return useMemo(
    () => ({ pinnedIds, pinnedProjectRoots, toggleSessionPin, toggleProjectPin, noteRevision, synced, refresh }),
    [pinnedIds, pinnedProjectRoots, toggleSessionPin, toggleProjectPin, noteRevision, synced, refresh],
  );
}

export interface SidebarPinsApi {
  /** Family root session ids the user pinned, in the Chats list and in a project. */
  pinnedIds: Set<string>;
  /** Project roots pinned above the others. */
  pinnedProjectRoots: Set<string>;
  /** Pin (or unpin) one session family; resolves to whether the server took it. */
  toggleSessionPin(id: string): Promise<boolean>;
  /** Pin (or unpin) one project. */
  toggleProjectPin(root: string): Promise<boolean>;
  /** Pass the `sessionUiStateRevision` of a running frame so a pin made elsewhere arrives. */
  noteRevision(revision: number | null | undefined): void;
  /** True once the server's state was adopted (the first GET or a write response). */
  synced: boolean;
  refresh(): Promise<void>;
}
