import type { RepositoryPaths } from "./repo-registry";

/**
 * Git change notifications.
 *
 * Branchshift watched the repository's own state files with a VS Code
 * FileSystemWatcher and broadcast `gitStateChanged` to every webview. pi-desk
 * keeps the same event, delivered over SSE (app/api/git/events), and adds the
 * server-side signal of an operation the panel itself issued: a mutation
 * publishes through this bus the moment it finishes, so the panel refreshes
 * without waiting for the file watcher's debounce.
 */

export type GitChangeScope = "all" | "branches" | "status" | "mergeState" | "log";

export interface GitStateChangeEvent {
  type: "gitStateChanged";
  repoId: string;
  scope: GitChangeScope;
}

export interface GitReposChangedEvent {
  type: "reposChanged";
  cwd: string;
}

export type GitEvent = GitStateChangeEvent | GitReposChangedEvent;

type Listener = (event: GitEvent) => void;

declare global {
  var __piGitEventListeners: Set<Listener> | undefined;
}

function listeners(): Set<Listener> {
  if (!globalThis.__piGitEventListeners) globalThis.__piGitEventListeners = new Set();
  return globalThis.__piGitEventListeners;
}

export function subscribeGitEvents(listener: Listener): () => void {
  const set = listeners();
  set.add(listener);
  return () => set.delete(listener);
}

export function emitGitStateChanged(repoId: string, scope: GitChangeScope): void {
  emit({ type: "gitStateChanged", repoId, scope });
}

export function emitReposChanged(cwd: string): void {
  emit({ type: "reposChanged", cwd });
}

function emit(event: GitEvent): void {
  for (const listener of listeners()) {
    try {
      listener(event);
    } catch {
      // One closed stream must not stop the others, or the command that
      // published the event.
    }
  }
}

/**
 * The watched paths of one repository, ported from Branchshift's gitWatcher.
 * Worktree-local state (HEAD, index, MERGE_HEAD, rebase state) lives in the
 * checkout's own gitDir; refs live in the shared commonDir, so a worktree
 * observes the branches of the repository it belongs to.
 */
export interface GitWatchSpec {
  basePath: string;
  /** Empty pattern watches the directory itself, recursively. */
  pattern: string;
  recursive: boolean;
  scope: GitChangeScope;
}

export function buildGitWatchSpecs(paths: RepositoryPaths): GitWatchSpec[] {
  const specs: GitWatchSpec[] = [
    { basePath: paths.gitDir, pattern: "HEAD", recursive: false, scope: "all" },
    { basePath: paths.gitDir, pattern: "index", recursive: false, scope: "status" },
    { basePath: paths.gitDir, pattern: "COMMIT_EDITMSG", recursive: false, scope: "log" },
    { basePath: paths.gitDir, pattern: "config.worktree", recursive: false, scope: "all" },
    { basePath: paths.gitDir, pattern: "MERGE_HEAD", recursive: false, scope: "mergeState" },
    { basePath: paths.gitDir, pattern: "CHERRY_PICK_HEAD", recursive: false, scope: "mergeState" },
    { basePath: paths.gitDir, pattern: "rebase-merge", recursive: true, scope: "mergeState" },
    { basePath: paths.gitDir, pattern: "rebase-apply", recursive: true, scope: "mergeState" },
    { basePath: paths.commonDir, pattern: "refs", recursive: true, scope: "branches" },
    { basePath: paths.commonDir, pattern: "packed-refs", recursive: false, scope: "branches" },
    { basePath: paths.commonDir, pattern: "config", recursive: false, scope: "all" },
  ];
  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = `${spec.basePath}\0${spec.pattern}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
