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
 */

const CLIENT_CACHE_TTL_MS = 60_000;

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

export function useProjectBranch(cwd: string | null | undefined): string | null {
  const [branch, setBranch] = useState<string | null>(() => (cwd ? cache.get(cwd)?.branch ?? null : null));

  useEffect(() => {
    if (!cwd) {
      setBranch(null);
      return;
    }
    const fresh = cache.get(cwd);
    if (fresh && Date.now() - fresh.at < CLIENT_CACHE_TTL_MS) {
      setBranch(fresh.branch);
      return;
    }
    let current = true;
    void loadProjectBranch(cwd).then((value) => {
      if (current) setBranch(value);
    });
    return () => {
      current = false;
    };
  }, [cwd]);

  return branch;
}
