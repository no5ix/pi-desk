import path from "node:path";
import { isCwdAllowed } from "./file-access";
import { inspectGitRepo } from "./git/repo-discovery";

/**
 * The branch of every project folder the app lists.
 *
 * The project lists (the picker, and anything else that names projects) spoke
 * about projects by path alone, while the sidebar's rows and the Git panel's
 * switcher already carried the branch. A user with eight checkouts of the same
 * repository, differing only by branch, could not tell them apart in the list —
 * the one place that decides which folder the next session works in.
 *
 * This module answers that in one round: a bounded set of paths, probed in
 * parallel, answered from a short cache. A folder that is not a checkout is
 * answered with `isRepo: false` and nothing else — the list is free to say
 * nothing about it, and a path outside the app's authorized roots is answered
 * the same way, so the endpoint never confirms that a folder exists.
 */

export interface ProjectBranch {
  cwd: string;
  branch: string | null;
  isWorktree: boolean;
  isRepo: boolean;
}

/** A branch is user-visible state the user changes by hand; 5 s is long enough to cover one dropdown. */
export const PROJECT_BRANCH_TTL_MS = 5000;

/** The most paths one request answers. The picker lists 7 rows and filters over the rest. */
export const PROJECT_BRANCH_MAX_PATHS = 50;

interface CacheEntry {
  value: ProjectBranch;
  expiresAt: number;
}

// `globalThis` survives the dev server's module reload, like the session registry.
const branchCache = (): Map<string, CacheEntry> => {
  const store = globalThis as typeof globalThis & { __piProjectBranches?: Map<string, CacheEntry> };
  return (store.__piProjectBranches ??= new Map<string, CacheEntry>());
};

const inflightCache = (): Map<string, Promise<ProjectBranch>> => {
  const store = globalThis as typeof globalThis & { __piProjectBranchInflight?: Map<string, Promise<ProjectBranch>> };
  return (store.__piProjectBranchInflight ??= new Map<string, Promise<ProjectBranch>>());
};

/** Forget one project's branch (a branch switch, a worktree added), or all of them. */
export function invalidateProjectBranch(cwd?: string): void {
  const cache = branchCache();
  if (!cwd) {
    cache.clear();
    return;
  }
  cache.delete(path.resolve(cwd));
}

async function probeProjectBranch(resolved: string): Promise<ProjectBranch> {
  if (!(await isCwdAllowed(resolved))) return { cwd: resolved, branch: null, isWorktree: false, isRepo: false };
  let paths;
  try {
    paths = await inspectGitRepo(resolved);
  } catch {
    // Not a checkout, gone, unreadable: the list says nothing, and it is not an error.
    return { cwd: resolved, branch: null, isWorktree: false, isRepo: false };
  }
  let branch: string | null = null;
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)(
      "git",
      ["-C", resolved, "rev-parse", "--abbrev-ref", "HEAD"],
      { env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" } },
    );
    const name = stdout.trim();
    // A detached HEAD answers "HEAD"; the list shows it as detached, not as a branch called HEAD.
    branch = name && name !== "HEAD" ? name : null;
  } catch {
    branch = null;
  }
  return { cwd: resolved, branch, isWorktree: paths.gitDir !== paths.commonDir, isRepo: true };
}

/** One project's branch, from the cache when it is fresh, and once per path when several callers ask at once. */
export function readProjectBranch(cwd: string): Promise<ProjectBranch> {
  const resolved = path.resolve(cwd);
  const cache = branchCache();
  const cached = cache.get(resolved);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
  const inflight = inflightCache();
  const running = inflight.get(resolved);
  if (running) return running;
  const run = probeProjectBranch(resolved).then((value) => {
    cache.set(resolved, { value, expiresAt: Date.now() + PROJECT_BRANCH_TTL_MS });
    // A bounded memory: the app's project list is small, and a machine that
    // answers thousands of paths should not keep them for a session's lifetime.
    if (cache.size > 400) {
      for (const oldest of cache.keys()) {
        if (cache.size <= 300) break;
        cache.delete(oldest);
      }
    }
    inflight.delete(resolved);
    return value;
  }, (error: unknown) => {
    inflight.delete(resolved);
    throw error;
  });
  inflight.set(resolved, run);
  return run;
}

/**
 * Many projects at once, deduplicated, capped, in parallel. Duplicates and a
 * non-absolute path are dropped rather than answered: a caller that passes a
 * relative path has a bug, and answering it with a fabricated entry would hide it.
 */
export async function readProjectBranches(cwds: readonly string[]): Promise<ProjectBranch[]> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const cwd of cwds) {
    if (typeof cwd !== "string" || !cwd.startsWith("/")) continue;
    const resolved = path.resolve(cwd);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    unique.push(resolved);
    if (unique.length >= PROJECT_BRANCH_MAX_PATHS) break;
  }
  return Promise.all(unique.map((cwd) => readProjectBranch(cwd)));
}
