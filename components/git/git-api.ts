"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The panel's transport: Branchshift's webview posted `{command, params,
 * repoId}` to the extension host, and this posts the same envelope to
 * `POST /api/git/execute`. One function, so every call in the panel goes
 * through the same envelope, the same error shape, and the same repository.
 */

export interface GitCommandFailureBody {
  message: string;
  code: string;
  recovery?: string;
}

export interface GitEnvelope<T> {
  ok: true;
  data: T;
}

export class GitRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recovery?: string,
    readonly status: number = 0,
  ) {
    super(message);
    this.name = "GitRequestError";
  }
}

export interface GitTarget {
  cwd: string;
  /** A repository discovered from `cwd` (its checkout, a sibling worktree). */
  repoId?: string | null;
}

export async function gitCommand<T>(
  target: GitTarget,
  command: string,
  params: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/git/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cwd: target.cwd,
      ...(target.repoId ? { repoId: target.repoId } : {}),
      command,
      params,
    }),
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; data?: T; error?: GitCommandFailureBody }
    | null;
  if (response.ok && payload?.ok) return payload.data as T;
  const error = payload?.error;
  throw new GitRequestError(
    error?.code ?? (response.status === 403 ? "FORBIDDEN" : "UNKNOWN"),
    error?.message ?? `Git did not answer (HTTP ${response.status}).`,
    error?.recovery,
    response.status,
  );
}

export type GitScope = "all" | "branches" | "status" | "mergeState" | "log";

export interface GitEvent {
  scope: GitScope;
  at: number;
  reason?: string;
}

/**
 * The refresh signal. Branchshift watched the repository with the VS Code file
 * watcher and told the webview; here the server watches `gitDir`/`commonDir`
 * and streams the same scopes. A scope event means "read it again", never "the
 * answer is this" — the panel always re-reads through the command table.
 */
export function useGitEvents(
  target: GitTarget | null,
  onEvent: (event: GitEvent) => void,
  options: { batchMs?: number } = {},
) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  const key = target ? `${target.cwd}\u0000${target.repoId ?? ""}` : null;
  const batchMs = options.batchMs ?? 220;
  useEffect(() => {
    if (!key) return;
    const source = new EventSource(`/api/git/events?cwd=${encodeURIComponent(target!.cwd)}${target!.repoId ? `&repoId=${encodeURIComponent(target!.repoId)}` : ""}`);
    // A `git commit` touches a dozen files, and the watcher reports each of
    // them. One read per burst: the panel never polls, and it never re-reads
    // the repository a dozen times for one operation.
    let pending: GitEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const burst = pending;
      pending = [];
      for (const event of burst) handlerRef.current(event);
    };
    source.addEventListener("git", (raw) => {
      const event = raw as MessageEvent<string>;
      try {
        pending.push(JSON.parse(event.data) as GitEvent);
      } catch {
        // A malformed frame is a missed refresh at worst; the panel re-reads on
        // any interaction, so there is nothing to recover.
      }
      if (timer) return;
      timer = setTimeout(flush, batchMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      source.close();
    };
    // `target` is rebuilt per render; `key` is the identity that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/**
 * A read, with the panel's rules: one request in flight per key, a stale answer
 * dropped, no timers (the app's rule for this panel — the refresh comes from
 * the event stream and from an explicit reload).
 */
export function useGitQuery<T>(
  target: GitTarget | null,
  command: string,
  params: Record<string, unknown> = {},
  options: { enabled?: boolean; deps?: readonly unknown[] } = {},
): {
  data: T | null;
  error: GitRequestError | null;
  loading: boolean;
  reload: () => void;
  setData: (value: T) => void;
} {
  const [state, setState] = useState<{ data: T | null; error: GitRequestError | null; loading: boolean }>({
    data: null,
    error: null,
    loading: Boolean(options.enabled !== false && target),
  });
  const requestRef = useRef(0);
  const [tick, setTick] = useState(0);
  const paramsKey = JSON.stringify(params);
  const enabled = options.enabled !== false && Boolean(target);
  const deps = options.deps ?? [];

  useEffect(() => {
    if (!target || !enabled) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const request = ++requestRef.current;
    setState((current) => ({ ...current, loading: true }));
    void gitCommand<T>(target, command, JSON.parse(paramsKey) as Record<string, unknown>)
      .then((data) => {
        if (request !== requestRef.current) return;
        setState({ data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (request !== requestRef.current) return;
        setState({
          data: null,
          error: error instanceof GitRequestError ? error : new GitRequestError("UNKNOWN", String(error)),
          loading: false,
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.cwd, target?.repoId, command, paramsKey, enabled, tick, ...deps]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  const setData = useCallback((value: T) => setState((current) => ({ ...current, data: value, error: null, loading: false })), []);
  return { ...state, reload, setData };
}

/** A mutation: busy flag, git's own words on failure, and a reload hook. */
export function useGitMutation(target: GitTarget | null) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<GitRequestError | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const run = useCallback(
    async <T,>(command: string, params: Record<string, unknown> = {}): Promise<T | null> => {
      if (!target) return null;
      setBusy(command);
      setError(null);
      try {
        const data = await gitCommand<T>(target, command, params);
        if (mountedRef.current) setBusy(null);
        return data;
      } catch (runError) {
        if (mountedRef.current) {
          setError(runError instanceof GitRequestError ? runError : new GitRequestError("UNKNOWN", String(runError)));
          setBusy(null);
        }
        return null;
      }
    },
    [target],
  );
  const clearError = useCallback(() => setError(null), []);
  return { busy, error, run, clearError, setError };
}

/** The repo list, for the panel's switcher. */
export interface GitRepoDescriptor {
  id: string;
  label: string;
  rootPath: string;
  branch: string | null;
  isWorktree: boolean;
  isMainWorktree: boolean;
  current: boolean;
}

export interface GitRepoList {
  repos: GitRepoDescriptor[];
  activeId: string;
}

export async function fetchGitRepos(cwd: string, refresh = false): Promise<GitRepoList> {
  const response = await fetch(`/api/git/repos?cwd=${encodeURIComponent(cwd)}${refresh ? "&refresh=1" : ""}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new GitRequestError("REPO_NOT_FOUND", (payload as { error?: string })?.error ?? "The repositories did not answer.", undefined, response.status);
  }
  return payload as GitRepoList;
}
