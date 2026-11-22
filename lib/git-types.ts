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
