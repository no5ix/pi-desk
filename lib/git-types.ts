export type GitFileStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

export interface GitFileStatus {
  filePath: string;
  status: GitFileStatusKind;
  code: "M" | "A" | "D" | "R" | "U" | "C";
  indexStatus: string;
  worktreeStatus: string;
}

export interface GitStatusResponse {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  files: GitFileStatus[];
  additions: number;
  deletions: number;
}

export interface GitFileDiffResponse {
  supported: boolean;
  status?: GitFileStatusKind;
  patch?: string;
}

/** One commit, as the Git panel's commit list reads it (`GET /api/git/commits`). */
export interface GitCommitEntry {
  /** The full sha — the only name a git call takes. */
  sha: string;
  /** The short sha the row shows. */
  shortSha: string;
  subject: string;
  authorName: string;
  /** Author date in milliseconds; 0 when git's date did not parse. */
  dateMs: number;
  /** The commit's parents: more than one is a merge. */
  parentCount: number;
}

/** One file a commit touched (`GET /api/git/commit-diff`); a rename names both paths. */
export interface GitCommitFile {
  /** The path that survives, relative to the repository root. */
  path: string;
  /** A rename's or copy's source, relative to the repository root. */
  oldPath?: string;
  status: GitFileStatusKind;
  /** Line counts; null for a binary file, git's own "-". */
  additions: number | null;
  deletions: number | null;
}

export interface GitCommitListResponse {
  isGitRepository: boolean;
  /** The ref that was read: a branch, its remote tip, or a tag. */
  ref: string;
  /** What `ref` resolved to (`origin/fix/x` for a remote-only branch). */
  resolvedRef: string | null;
  repositoryRoot: string | null;
  commits: GitCommitEntry[];
  /** True when the ref has older commits past the page that was asked for. */
  hasMore: boolean;
}

export interface GitCommitDiffResponse {
  isGitRepository: boolean;
  /** False when there is no patch to paint; `reason` names why. */
  supported: boolean;
  reason?: "not-a-repository" | "unknown-commit" | "too-large" | "no-changes";
  commit?: GitCommitEntry;
  repositoryRoot?: string;
  files?: GitCommitFile[];
  patch?: string;
}

/**
 * One file's changes as a session recorded them (`GET /api/sessions/[id]/file-diff`).
 * Same shape as a git diff, because the file viewer renders both in one view; the
 * extra counts label it.
 */
export interface SessionFileDiffResponse extends GitFileDiffResponse {
  source?: "session";
  additions?: number;
  deletions?: number;
  /** The tool calls that touched the file. */
  changes?: number;
}
