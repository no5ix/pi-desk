"use client";

// Fork-owned: state and actions behind the branch and worktree pages of
// components/ProjectContextMenu.tsx — fetch remote branches, check a branch out
// in a checkout, create and remove worktrees. The composer's branch chip
// (components/ComposerBranchMenu.tsx) is the app's branching surface; it supplies
// what happens to the app afterwards through the callbacks here.

import { useCallback, useState } from "react";
import {
  createProjectWorktree,
  fetchRemoteBranches,
  removeProjectWorktree,
  type ProjectBranchMenuState,
  type WorktreeRemoval,
} from "@/components/ProjectContextMenu";
import { invalidateProjectBranch } from "@/hooks/useProjectBranch";
import { errorMessage } from "@/lib/errors";

interface ProjectWorktreeCallbacks {
  /** A fetch landed; merge the fresh branch lists into the menu. */
  onBranchesFetched: (projectRoot: string, lists: { branches: string[]; remoteBranches: string[] }) => void;
  /** A worktree was created at `path`; select it and refresh. */
  onWorktreeCreated: (projectRoot: string, path: string, branch: string) => void;
  /** A worktree checkout was removed; leave it if it was selected and refresh. */
  onWorktreeRemoved: (projectRoot: string, path: string) => void;
  /** A branch was checked out in `cwd`. */
  onBranchSwitched?: (cwd: string, branch: string) => void;
  /**
   * A branch the user picked is checked out in *another* worktree, so it cannot be
   * checked out here. The row's tip promises that worktree, so the caller takes the
   * session there (`path`) - the project stays the same, the folder changes.
   */
  onBranchInWorktree?: (cwd: string, branch: string, path: string) => void;
}

const message = (error: unknown) => errorMessage(error);

export function useProjectWorktreeActions({
  onBranchesFetched, onWorktreeCreated, onWorktreeRemoved, onBranchSwitched, onBranchInWorktree,
}: ProjectWorktreeCallbacks) {
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<WorktreeRemoval | null>(null);
  const [newBranch, setNewBranchValue] = useState("");

  /** Clears everything a closed or re-opened menu must not carry over. */
  const reset = useCallback(() => {
    setError(null);
    setConfirmRemove(null);
    setNewBranchValue("");
    setSwitchingBranch(null);
  }, []);

  const setNewBranch = useCallback((value: string) => {
    setNewBranchValue(value);
    setError(null);
  }, []);

  const requestRemove = useCallback((path: string) => {
    setError(null);
    setConfirmRemove({ path, force: false });
  }, []);

  const cancelRemove = useCallback(() => setConfirmRemove(null), []);

  const fetchBranches = useCallback(async (projectRoot: string) => {
    if (fetching) return;
    setFetching(true);
    setError(null);
    try {
      onBranchesFetched(projectRoot, await fetchRemoteBranches(projectRoot));
    } catch (e) {
      setError(message(e));
    } finally {
      setFetching(false);
    }
  }, [fetching, onBranchesFetched]);

  const create = useCallback(async (projectRoot: string, baseBranch?: string) => {
    const branch = newBranch.trim();
    if (!branch || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createProjectWorktree(projectRoot, branch, baseBranch);
      invalidateProjectBranch(created.path);
      setNewBranchValue("");
      onWorktreeCreated(projectRoot, created.path, created.branch);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, [busy, newBranch, onWorktreeCreated]);

  const remove = useCallback(async (projectRoot: string, removal: WorktreeRemoval) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await removeProjectWorktree(projectRoot, removal.path, removal.force);
      if (result === "needs-force") {
        // Dirty or has submodules: ask again, this time for a forced removal.
        setConfirmRemove({ path: removal.path, force: true });
        return;
      }
      setConfirmRemove(null);
      invalidateProjectBranch(removal.path);
      onWorktreeRemoved(projectRoot, removal.path);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }, [busy, onWorktreeRemoved]);

  /**
   * Checks `branch` out in `cwd`'s checkout. A branch that belongs to another
   * worktree cannot be checked out here, so the caller is told to take that
   * worktree instead (the row's tip promises exactly that) and git is never asked.
   * The caller passes the branch lists it is showing.
   */
  const switchBranch = useCallback(async (
    cwd: string,
    branch: string,
    loaded?: ProjectBranchMenuState,
    checkoutOf?: string,
  ): Promise<{ branch: string | null; worktreePath: string | null }> => {
    if (switchingBranch) return { branch: null, worktreePath: null };
    setSwitchingBranch(branch);
    setError(null);
    let failure: string | null = null;
    let checkedOut: string | null = null;
    let worktreePath: string | null = null;
    try {
      const holder = loaded?.worktrees.find((w) => w.branch === branch && w.path !== (checkoutOf ?? cwd));
      if (holder) {
        worktreePath = holder.path;
      } else {
        const res = await fetch("/api/worktrees", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, branch }),
        });
        const data = await res.json().catch(() => ({})) as { branch?: string; error?: string };
        if (!res.ok || data.error || !data.branch) failure = data.error ?? `HTTP ${res.status}`;
        else {
          checkedOut = data.branch;
          invalidateProjectBranch(cwd);
        }
      }
    } catch (e) {
      failure = message(e);
    } finally {
      setSwitchingBranch(null);
    }
    if (failure) {
      setError(failure);
      return { branch: null, worktreePath: null };
    }
    setError(null);
    if (worktreePath) {
      onBranchInWorktree?.(cwd, branch, worktreePath);
      return { branch: null, worktreePath };
    }
    if (checkedOut) onBranchSwitched?.(cwd, checkedOut);
    return { branch: checkedOut, worktreePath: null };
  }, [onBranchSwitched, onBranchInWorktree, switchingBranch]);

  return {
    busy,
    fetching,
    error,
    setError,
    switchingBranch,
    confirmRemove,
    newBranch,
    setNewBranch,
    reset,
    requestRemove,
    cancelRemove,
    fetchBranches,
    create,
    remove,
    switchBranch,
  };
}
