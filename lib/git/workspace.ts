import { realpath } from "node:fs/promises";
import path from "node:path";
import { isCwdAllowed } from "../file-access";
import { GitExecutor } from "./core/git-executor";
import { GitService } from "./git-service";
import { inspectGitRepo } from "./repo-discovery";
import type { RepoDescriptor, RepoRuntime, RepositoryPaths } from "./repo-registry";

/**
 * Repository resolution for the Git panel.
 *
 * Branchshift discovered repositories from the VS Code workspace folders and kept
 * them in a `RepoRegistry` the extension host owned. pi-desk has no workspace
 * folders: its unit of work is a project cwd, which may be a plain folder, the
 * main checkout, a linked worktree, a subdirectory of a checkout, or a folder
 * holding several repositories.
 *
 * Every repository the panel may act on is therefore discovered *from an
 * authorized cwd*: the checkout the cwd belongs to, every other worktree of that
 * same repository (a worktree is its own checkout with its own index and HEAD, so
 * it is its own repository for Git's purposes), and the repositories nested
 * directly under the cwd. A `repoId` from the browser is only accepted when it is
 * one of those, and its path must sit inside an allowed file root — the panel
 * cannot be pointed at an arbitrary repository.
 */

/** Repositories found under one cwd, in display order. */
export interface WorkspaceRepos {
  cwd: string;
  /** The checkout the cwd belongs to, null when the cwd is not inside one. */
  currentId: string | null;
  repos: (RepoDescriptor & { isWorktree: boolean; branch: string | null })[];
}

interface RegistryEntry {
  runtime: RepoRuntime;
  expiresAt: number;
}

declare global {
  var __piGitRepoRegistry: Map<string, RegistryEntry> | undefined;
  var __piGitWorkspaceCache: Map<string, { value: WorkspaceRepos; expiresAt: number }> | undefined;
}

const REPO_TTL_MS = 5 * 60_000;
const WORKSPACE_TTL_MS = 5_000;
/** A plain folder may hold many repositories; the switcher lists a bounded set. */
const MAX_NESTED_REPOS = 40;
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".next-desktop",
  ".turbo",
  ".cache",
  ".venv",
  ".gradle",
  ".idea",
  ".vscode",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "test-results",
  "vendor",
]);

function repoRegistry(): Map<string, RegistryEntry> {
  if (!globalThis.__piGitRepoRegistry) globalThis.__piGitRepoRegistry = new Map();
  return globalThis.__piGitRepoRegistry;
}

function workspaceCache(): Map<string, { value: WorkspaceRepos; expiresAt: number }> {
  if (!globalThis.__piGitWorkspaceCache) globalThis.__piGitWorkspaceCache = new Map();
  return globalThis.__piGitWorkspaceCache;
}

/** Drop cached repositories (after a worktree is added/removed, or on demand). */
export function invalidateGitWorkspace(cwd?: string): void {
  if (!cwd) {
    repoRegistry().clear();
    workspaceCache().clear();
    return;
  }
  workspaceCache().delete(path.resolve(cwd));
  repoRegistry().clear();
}

function getGitService(paths: RepositoryPaths): RepoRuntime {
  const registry = repoRegistry();
  const id = paths.workTreeRoot;
  const cached = registry.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.runtime;
  const runtime: RepoRuntime = {
    descriptor: { id, name: path.basename(id), rootPath: id },
    paths,
    gitService: new GitService(paths),
  };
  registry.set(id, { runtime, expiresAt: Date.now() + REPO_TTL_MS });
  return runtime;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
  detached: boolean;
}

/** `git worktree list --porcelain` of the repository the cwd belongs to. */
export async function listRepositoryWorktrees(workTreeRoot: string): Promise<WorktreeEntry[]> {
  const executor = new GitExecutor(workTreeRoot);
  const output = await executor.text(["worktree", "list", "--porcelain"]);
  const entries: WorktreeEntry[] = [];
  let current: { path?: string; branch?: string; detached: boolean; bare: boolean } | null = null;
  const flush = () => {
    if (current?.path && !current.bare) {
      entries.push({
        path: current.path,
        branch: current.branch ? current.branch.replace(/^refs\/heads\//, "") : null,
        isMain: entries.length === 0,
        detached: current.detached,
      });
    }
    current = null;
  };
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length), detached: false, bare: false };
    } else if (!current) {
      continue;
    } else if (line === "detached") {
      current.detached = true;
    } else if (line === "bare") {
      current.bare = true;
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    }
  }
  flush();
  return entries;
}

async function findNestedRepoRoots(cwd: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const found: string[] = [];
  let names: string[];
  try {
    names = await readdir(cwd);
  } catch {
    return found;
  }
  for (const name of names.sort()) {
    if (SKIPPED_DIRECTORY_NAMES.has(name) || name.startsWith(".")) continue;
    const candidate = path.join(cwd, name);
    try {
      const probe = new GitExecutor(candidate);
      await probe.text(["rev-parse", "--is-inside-work-tree"]);
    } catch {
      continue;
    }
    found.push(candidate);
    if (found.length >= MAX_NESTED_REPOS) break;
  }
  return found;
}

/** Every repository the panel can act on, discovered from `cwd`. */
export async function discoverWorkspaceRepos(cwd: string): Promise<WorkspaceRepos> {
  const cacheKey = path.resolve(cwd);
  const cached = workspaceCache().get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const empty: WorkspaceRepos = { cwd: cacheKey, currentId: null, repos: [] };
  if (!(await isCwdAllowed(cacheKey))) return empty;

  const repos: WorkspaceRepos["repos"] = [];
  const seen = new Set<string>();
  const add = async (candidate: string, isWorktree: boolean) => {
    try {
      const paths = await inspectGitRepo(candidate);
      if (seen.has(paths.workTreeRoot)) return;
      seen.add(paths.workTreeRoot);
      const runtime = getGitService(paths);
      let branch: string | null = null;
      try {
        branch = await runtime.gitService.getCurrentBranch();
      } catch {
        branch = null;
      }
      repos.push({ ...runtime.descriptor, isWorktree, branch });
    } catch {
      // Not a checkout: the cwd may be a plain folder.
    }
  };

  let currentId: string | null = null;
  try {
    const paths = await inspectGitRepo(cacheKey);
    currentId = paths.workTreeRoot;
    // The cwd's own checkout first, then its sibling worktrees of the same repo.
    await add(cacheKey, false);
    let worktrees: WorktreeEntry[] = [];
    try {
      worktrees = await listRepositoryWorktrees(paths.workTreeRoot);
    } catch {
      worktrees = [];
    }
    for (const worktree of worktrees) {
      if (worktree.path === paths.workTreeRoot) continue;
      await add(worktree.path, true);
    }
  } catch {
    currentId = null;
  }
  // A folder that only contains repositories: list the ones directly inside it.
  for (const nested of await findNestedRepoRoots(cacheKey)) {
    await add(nested, false);
  }

  const value: WorkspaceRepos = { cwd: cacheKey, currentId, repos };
  workspaceCache().set(cacheKey, { value, expiresAt: Date.now() + WORKSPACE_TTL_MS });
  return value;
}

/** The Git service for one repository of a workspace, or null when it is not part of it. */
export async function resolveRepoRuntime(
  cwd: string,
  repoId?: string | null,
): Promise<RepoRuntime | null> {
  if (!(await isCwdAllowed(cwd))) return null;
  const workspace = await discoverWorkspaceRepos(cwd);
  const wanted = repoId ?? workspace.currentId;
  if (!wanted) return null;
  // A browser-supplied repoId is only honoured when discovery reached it from the
  // authorized cwd: the same repository's worktrees, or a checkout nested in it.
  if (!workspace.repos.some((repo) => repo.id === wanted)) return null;
  let target: string;
  try {
    target = await realpath(path.resolve(wanted));
  } catch {
    return null;
  }
  try {
    const paths = await inspectGitRepo(target);
    if (paths.workTreeRoot !== target) return null;
    return getGitService(paths);
  } catch {
    return null;
  }
}

/** A project the app knows, as the Git panel's switcher reads it. */
export interface ProjectRepoEntry {
  path: string;
  name: string;
  branch: string | null;
  isWorktree: boolean;
  /**
   * False for a folder with no repository in it. The switcher is the app's
   * project list, so such a folder is listed like every other one — the panel
   * simply has nothing to read there, and says so.
   */
  isRepo: boolean;
}

/**
 * The projects of the app's own list — the folders the sessions live in.
 *
 * Branchshift's repo switcher listed the IDE's open projects, and that was the
 * point of it: the Git view switched between the same folders the editor was
 * working in. pi-desk has no IDE: its project list is the session sidebar's, so
 * the panel reads the same list — the same folders, the same display names, and
 * all of them. The list is the project list, not a list of repositories: a
 * project without a repository is answered with `isRepo: false` and is left in,
 * because leaving it out makes the panel's list disagree with the sidebar's.
 * A folder that no longer exists, or that the app is not allowed to read, is
 * the exception: there is nothing to switch to, and nothing to say about it.
 */
export async function listProjectRepos(): Promise<ProjectRepoEntry[]> {
  const { listSessionsIncremental } = await import("../session-list-scanner");
  const sessions = await listSessionsIncremental({ deferDetails: true });
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    const cwd = session.cwd;
    if (typeof cwd !== "string" || !cwd.startsWith("/") || seen.has(cwd)) continue;
    seen.add(cwd);
    roots.push(cwd);
  }

  // The sidebar's names: a bare basename, with parent segments only where two
  // projects share one. The switcher and the sidebar must say the same word for
  // the same folder, so the shared rule is used here too (lib/project-display.ts).
  const { getProjectDisplayNames } = await import("../project-display");
  const displayNames = getProjectDisplayNames(roots);

  const { execFile } = await import("node:child_process");
  const { stat } = await import("node:fs/promises");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  // A read-only probe: never prompt, never page, and the user's own git config
  // stays in force (safe.directory and the like live there).
  const probeEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_PAGER: "cat" };

  const entries = await Promise.all(roots.map(async (root): Promise<ProjectRepoEntry | null> => {
    if (!(await isCwdAllowed(root))) return null;
    try {
      if (!(await stat(root)).isDirectory()) return null;
    } catch {
      return null;
    }
    const name = displayNames.get(root) ?? path.basename(root);
    let paths;
    try {
      paths = await inspectGitRepo(root);
    } catch {
      // No repository here. The project is still a project.
      return { path: root, name, branch: null, isWorktree: false, isRepo: false };
    }
    let branch: string | null = null;
    try {
      const { stdout } = await run("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], {
        env: probeEnv,
        maxBuffer: 1024 * 1024,
      });
      branch = stdout.trim() || null;
      if (branch === "HEAD") branch = null;
    } catch {
      branch = null;
    }
    return {
      path: root,
      name,
      branch,
      isWorktree: paths.gitDir !== paths.commonDir,
      isRepo: true,
    };
  }));

  return entries
    .filter((entry): entry is ProjectRepoEntry => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** Label list for the switcher: disambiguate same-named repos by their parent folder. */
export function repoLabel(
  target: RepoDescriptor,
  all: RepoDescriptor[],
): string {
  const sameName = all.filter((repo) => repo.name === target.name).length;
  if (sameName <= 1) return target.name;
  return `${target.name} (${path.basename(path.dirname(target.rootPath))}/${target.name})`;
}
