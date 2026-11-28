"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectBranch } from "@/lib/project-branches";

/**
 * The branch of the projects a list is about to show.
 *
 * The lists that name a project by path (the picker, and anything that joins
 * them) have no branch, and a machine with several checkouts of one repository —
 * the usual shape of a worktree setup — has lists whose rows differ only by a
 * folder name the user chose. The list asks for the paths it is rendering and
 * paints what the server answers.
 *
 * The answers accumulate: a row that is already answered keeps its branch while
 * another key is fetched, because a branch is not a value that goes blank while
 * it is being re-read. A request whose key is no longer the current one is
 * dropped, and a request that fails changes nothing — a list without branches is
 * a list, and a list that flickers is not.
 */
export type ProjectBranchMap = Readonly<Record<string, ProjectBranch>>;

export interface UseProjectBranches {
  branches: ProjectBranchMap;
  /** Re-read the current paths (a branch switch, a worktree added). */
  refresh: () => Promise<void>;
  /** True while the current key has no answer yet. */
  loading: boolean;
}

export function useProjectBranches(paths: readonly string[], active: boolean): UseProjectBranches {
  const [branches, setBranches] = useState<ProjectBranchMap>({});
  const [loading, setLoading] = useState(false);
  // A monotonic request id: only the newest request may write, so a slow answer
  // for the previous list cannot land on top of the current one.
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  // The list's identity, not the array's: the picker's list is rebuilt on every
  // render, and an array dependency would fetch on every keystroke of the filter.
  const key = active ? paths.join("\n") : "";

  const load = useCallback(async (cacheBust: boolean) => {
    const list = key ? key.split("\n") : [];
    if (list.length === 0) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      for (const cwd of list) params.append("cwd", cwd);
      if (cacheBust) params.set("refresh", "1");
      const response = await fetch(`/api/projects/branches?${params.toString()}`);
      if (!response.ok) return;
      const data = await response.json() as { projects?: ProjectBranch[] };
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const answered = data.projects ?? [];
      if (answered.length === 0) return;
      setBranches((previous) => {
        const next = { ...previous };
        for (const entry of answered) next[entry.cwd] = entry;
        return next;
      });
    } catch {
      // Nothing to say: the rows keep their names and show no branch.
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active || key === "") return;
    void load(false);
  }, [active, key, load]);

  const refresh = useCallback(() => load(true), [load]);

  return { branches, refresh, loading };
}
