"use client";

import { useEffect, useState } from "react";

/**
 * The git branch of the project the header shows.
 *
 * A selected session already carries it (`SessionInfo.branch`, filled by
 * attachSessionProjectInfo in lib/session-reader.ts). A fresh composer has no session
 * yet, so its project branch comes from the worktree endpoint, which computes it with
 * the server's 60-second project cache. This hook keeps a matching client-side cache so
 * switching between projects in one screen does not refetch.
 *
 * Null means "no branch to show": a non-git folder, a detached HEAD, a cwd the file
 * allow-list refuses, or a fetch that failed. The header shows nothing in every case.
 *
 * The label is re-read on a timer, because the branch it names is not ours to
 * keep: a `git switch` in a terminal, an IDE, or another agent moves the
 * checkout under us and a header that keeps saying `main` is simply lying. The
 * cheap `/api/worktrees/branch` read is one short `git rev-parse` with no
 * server cache in front of it, so the poll is cheap on both sides; a hidden tab
 * is skipped, and `setBranch` is called only when the name actually changed, so
 * the tick does not re-render the shell every few seconds.
 */

const CLIENT_CACHE_TTL_MS = 60_000;
/** How often the header re-reads the branch of the folder it is showing. */
const POLL_INTERVAL_MS = 3_000;

interface WorktreesResponse {
  isGit?: boolean;
  branch?: string | null;
}

const cache = new Map<string, { branch: string | null; at: number }>();
const inflight = new Map<string, Promise<string | null>>();

/** Drop one project's cached branch, e.g. after a branch switch. */
export function invalidateProjectBranch(cwd: string): void {
  cache.delete(cwd);
}

function loadProjectBranch(cwd: string): Promise<string | null> {
  const running = inflight.get(cwd);
  if (running) return running;
  const request = fetch(`/api/worktrees?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<WorktreesResponse>) : null))
    .then((data) => {
      if (!data || data.isGit !== true) return null;
      return typeof data.branch === "string" && data.branch ? data.branch : null;
    })
    .catch(() => null)
    .then((branch) => {
      inflight.delete(cwd);
      cache.set(cwd, { branch, at: Date.now() });
      return branch;
    });
  inflight.set(cwd, request);
  return request;
}

/** The uncached read: one short git call server-side, so a branch switched
 *  outside the app shows up within a tick. Failures keep the last known name. */
function refreshProjectBranch(cwd: string): Promise<string | null> {
  return fetch(`/api/worktrees/branch?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" })
    .then((response) => (response.ok ? (response.json() as Promise<WorktreesResponse>) : null))
    .then((data) => {
      if (!data || typeof data.branch !== "string" || !data.branch) return null;
      return data.branch;
    })
    .catch(() => null)
    .then((branch) => {
      // Only a read that answered a name (or an explicit null from a detached
      // HEAD) refreshes the cache; a request that failed leaves the entry alone.
      cache.set(cwd, { branch, at: Date.now() });
      return branch;
    });
}

export function useProjectBranch(cwd: string | null | undefined): string | null {
  // First render matches the server, always. The client-side cache is warm only after a
  // fetch, and the server never ran one, so seeding from it would make a hydration render
  // show a branch the HTML does not contain — React then throws the whole subtree away.
  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    if (!cwd) {
      setBranch(null);
      return;
    }
    let current = true;
    const apply = (value: string | null) => {
      if (current) setBranch((previous) => (previous === value ? previous : value));
    };
    const fresh = cache.get(cwd);
    if (fresh && Date.now() - fresh.at < CLIENT_CACHE_TTL_MS) {
      setBranch(fresh.branch);
    } else {
      void loadProjectBranch(cwd).then(apply);
    }
    const poll = () => {
      // A background tab does not show the label, so it does not need it fresh.
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void refreshProjectBranch(cwd).then(apply);
    };
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    // Coming back to the tab is exactly when the name has usually moved.
    const onVisible = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") poll();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => {
      current = false;
      clearInterval(timer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cwd]);

  return branch;
}
