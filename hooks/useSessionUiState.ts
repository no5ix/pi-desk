"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applySessionUiStateRequest,
  emptySessionUiState,
  normalizeSessionUiState,
  snapshotSessionUiFlags,
  type SessionUiFlagsSnapshot,
  type SessionUiState,
  type SessionUiStateRequest,
} from "@/lib/session-ui-state-shared";
import { errorMessage } from "@/lib/errors";

const SESSION_UI_STATE_URL = "/api/sessions/ui-state";

export interface SessionUiStateApi {
  state: SessionUiState;
  /** True after the first GET settled (success or failure). */
  loaded: boolean;
  /**
   * True once server state has been adopted (a GET or a write response); never
   * false again. A failed first GET leaves the local state empty: what is
   * saved on its own (the project order's new keys) waits for this.
   */
  synced: boolean;
  /** Last request error (cleared on the next success). */
  error: string | null;
  /**
   * The same message in a ref, so a write's `.then` reads the reason it failed:
   * `error` is state, and the render that publishes it happens after the
   * caller has already been answered.
   */
  lastErrorRef: { current: string | null };
  /** GET /api/sessions/ui-state; a response older than a later read or write is ignored. */
  refresh(): Promise<void>;
  /** Revision from /api/agent/running: refreshes when it differs and no write is in flight. */
  noteRevision(revision: number | null | undefined): void;
  /** Optimistic: applied locally at once, then POSTed; resolves to whether the server accepted it. */
  apply(request: SessionUiStateRequest): Promise<boolean>;
  /** Flags of `ids` in the current local state, for undo. */
  snapshot(ids: readonly string[]): SessionUiFlagsSnapshot[];
}

interface PendingWrite {
  request: SessionUiStateRequest;
  /** The time the user acted, so a replay keeps the same pinnedAt/archivedAt. */
  now: number;
}

async function responseError(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
      return (data as { error: string }).error;
    }
  } catch {
    // Not JSON: fall back to the status.
  }
  return `HTTP ${response.status}`;
}

async function readState(response: Response): Promise<SessionUiState> {
  if (!response.ok) throw new Error(await responseError(response));
  const data: unknown = await response.json();
  const state = data && typeof data === "object" ? normalizeSessionUiState((data as { state?: unknown }).state) : null;
  if (!state) throw new Error("Invalid session UI state response");
  return state;
}

/**
 * Pin, archive and project order state of the sidebar (`/api/sessions/ui-state`).
 *
 * The local state is always the last server state with every queued write
 * replayed on top, so a GET or a write response that lands while other writes
 * are queued never drops their optimistic effect. Writes run one at a time in
 * call order (archive, then undo, stays ordered on the server).
 */
export function useSessionUiState(): SessionUiStateApi {
  const [state, setState] = useState<SessionUiState>(emptySessionUiState);
  const [loaded, setLoaded] = useState(false);
  const [synced, setSynced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastErrorRef = useRef<string | null>(null);

  const reportError = useCallback((message: string) => {
    lastErrorRef.current = message;
    setError(message);
  }, []);
  const clearError = useCallback(() => {
    lastErrorRef.current = null;
    setError(null);
  }, []);

  const serverStateRef = useRef<SessionUiState>(state);
  const localStateRef = useRef<SessionUiState>(state);
  const pendingRef = useRef<PendingWrite[]>([]);
  const writeChainRef = useRef<Promise<unknown>>(Promise.resolve());
  // Bumped by every GET and every adopted write response: older GETs are stale.
  const loadIdRef = useRef(0);
  const refreshInFlightRef = useRef<number | null>(null);
  /**
   * The revision a running frame said the server has, while the read that could
   * show it was already on its way. Kept until an adopted state reaches it.
   */
  const wantedRevisionRef = useRef<number | null>(null);

  const publish = useCallback(() => {
    let next = serverStateRef.current;
    for (const { request, now } of pendingRef.current) {
      next = applySessionUiStateRequest(next, request, now).state;
    }
    localStateRef.current = next;
    setState(next);
  }, []);

  /** Adopt one server state: it is the newest read, and it may settle the news. */
  const adopt = useCallback((next: SessionUiState) => {
    serverStateRef.current = next;
    const wanted = wantedRevisionRef.current;
    if (wanted !== null && wanted <= next.revision) wantedRevisionRef.current = null;
    publish();
  }, [publish]);

  // keepError: the rollback after a failed write must not hide that failure.
  const load = useCallback(async (keepError: boolean) => {
    const loadId = ++loadIdRef.current;
    refreshInFlightRef.current = loadId;
    try {
      const response = await fetch(SESSION_UI_STATE_URL, { cache: "no-store" });
      const next = await readState(response);
      if (loadId !== loadIdRef.current) return;
      adopt(next);
      if (!keepError) clearError();
      setLoaded(true);
      setSynced(true);
      // A frame that named a revision this read predates is news still: the GET
      // answered with the state from before the other window's write, so read
      // again. Without this, a pin made elsewhere can sit behind a slow read
      // until the next write happens to push a frame.
      const wanted = wantedRevisionRef.current;
      if (wanted !== null && wanted > next.revision) void load(keepError);
    } catch (err) {
      if (loadId !== loadIdRef.current) return;
      reportError(errorMessage(err));
      setLoaded(true);
    } finally {
      if (refreshInFlightRef.current === loadId) refreshInFlightRef.current = null;
    }
  }, [adopt, clearError, reportError]);

  const refresh = useCallback(() => load(false), [load]);

  const noteRevision = useCallback((revision: number | null | undefined) => {
    if (typeof revision !== "number" || !Number.isFinite(revision)) return;
    if (revision <= serverStateRef.current.revision) return;
    wantedRevisionRef.current = revision;
    if (pendingRef.current.length > 0) return;
    // A current GET is already on its way; a stale one does not count. The
    // wanted revision above is what makes a read that lands too old chase.
    if (refreshInFlightRef.current !== null && refreshInFlightRef.current === loadIdRef.current) return;
    void refresh();
  }, [refresh]);

  const apply = useCallback((request: SessionUiStateRequest): Promise<boolean> => {
    const pending: PendingWrite = { request, now: Date.now() };
    pendingRef.current = [...pendingRef.current, pending];
    publish();

    const run = async (): Promise<boolean> => {
      let ok = false;
      try {
        const response = await fetch(SESSION_UI_STATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
          cache: "no-store",
        });
        const next = await readState(response);
        // Any GET started before this response may predate the write.
        loadIdRef.current++;
        adopt(next);
        clearError();
        setLoaded(true);
        setSynced(true);
        ok = true;
      } catch (err) {
        reportError(errorMessage(err));
      }
      pendingRef.current = pendingRef.current.filter((item) => item !== pending);
      publish();
      // Roll back to what the server really holds (the request may or may not have landed).
      if (!ok) await load(true);
      return ok;
    };

    const result = writeChainRef.current.then(run, run);
    writeChainRef.current = result;
    return result;
  }, [adopt, clearError, load, publish, reportError]);

  const snapshot = useCallback(
    (ids: readonly string[]) => snapshotSessionUiFlags(localStateRef.current, ids),
    [],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return useMemo(
    () => ({ state, loaded, synced, error, lastErrorRef, refresh, noteRevision, apply, snapshot }),
    [state, loaded, synced, error, refresh, noteRevision, apply, snapshot],
  );
}
