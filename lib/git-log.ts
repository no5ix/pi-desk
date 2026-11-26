// Fork-owned: the commits behind a branch, and one commit's diff.
//
// The app already knew a project's branches (lib/branch-tree.ts, /api/worktrees) and
// one file's working-tree diff (lib/git-changes.ts, /api/git/diff), but nothing in
// between: a user standing on a branch could not see what had happened on it. This
// module is that missing middle — a commit list for a ref and one commit's patch.
//
// It runs git through `runGit()` in lib/git-changes.ts (the app's one bounded git
// runner: argv only, `LC_ALL=C`, a timeout) and keeps the parsing here, pure, so a
// unit test can read the formats without a repository: git's `%x1e`/`%x1f` record
// format (subject, author and e-mail are free text, so no character inside them can
// be a delimiter we chose) and the `--name-status` / `--numstat` pairs a commit
// prints, whose rename forms are the part that used to be hand-parsed everywhere.
//
// The two callers are `app/api/git/commits` and `app/api/git/commit-diff`; the panel
// that paints them is components/GitPanel.tsx, and the patch is rendered by the file
// viewer's own diff view (components/FileViewer.tsx), not a second renderer.

import { findRepositoryRoot, runGit } from "./git-changes";
import type {
  GitCommitDiffResponse,
  GitCommitEntry,
  GitCommitFile,
  GitFileStatusKind,
} from "./git-types";

/** A page of history. 40 is what the panel's list shows; a bigger page is a slower git run. */
export const COMMIT_PAGE_SIZE = 40;
const COMMIT_PAGE_MAX = 200;

/** A patch past this is not painted: the panel is a reading surface, not a pager. */
export const COMMIT_PATCH_MAX_BYTES = 2 * 1024 * 1024;

const RECORD_SEPARATOR = "\x1e";
const FIELD_SEPARATOR = "\x1f";

/** The one `%format` the app reads commits with: sha, short sha, subject, author, date, parents. */
const COMMIT_FORMAT = `${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%h${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%p${RECORD_SEPARATOR}`;

/**
 * A name git may be handed as a rev.
 *
 * Refs reach git as argv, never through a shell, so the danger is an argument git
 * reads as an option (`--upload-pack=…`) or a revision expression that walks the
 * graph somewhere the caller did not ask for (`HEAD~999999`, `main..evil`, a glob).
 * This is the same rule `switchBranch()` in lib/worktree.ts applies to a branch name,
 * written out so a test can enumerate it.
 */
export function isSafeGitRef(value: string): boolean {
  const ref = value.trim();
  if (!ref || ref.length > 200) return false;
  if (ref.startsWith("-") || ref.startsWith(":") || ref.startsWith("/")) return false;
  if (/\s/.test(ref) || /[\u0000-\u001f\u007f]/.test(ref)) return false;
  if (/[~^:?*[\\\]]/.test(ref)) return false;
  if (ref.includes("..") || ref.includes("//") || ref.includes("@{")) return false;
  if (ref.endsWith("/") || ref.endsWith(".") || ref.endsWith(".lock")) return false;
  if (ref.startsWith(".") || ref.split("/").some((segment) => segment.startsWith("."))) return false;
  return true;
}

/** A commit's own name, which is all the diff route ever takes: hex, 7 to 40. */
export function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(value.trim());
}

/** The branch page is 40 commits; anything asked for is clamped into that budget. */
export function commitPageLimit(limit: number | null | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) return COMMIT_PAGE_SIZE;
  return Math.min(Math.floor(limit), COMMIT_PAGE_MAX);
}

export function commitPageSkip(skip: number | null | undefined): number {
  if (typeof skip !== "number" || !Number.isFinite(skip) || skip < 1) return 0;
  return Math.floor(skip);
}

/**
 * A branch name git is asked to read, in the order the panel reads the list: this
 * folder's branch, then the remote's branch of that name.
 *
 * `partitionBranchList()` strips the remote prefix from a remote-only branch (the
 * list says `fix/x`, tagged `remote`), so the panel cannot name the remote. The
 * remote's own ref is found here, in one `for-each-ref` over the three shapes, and
 * the row's commits come off that tip.
 */
export function commitRefPatterns(ref: string): string[] {
  const trimmed = ref.trim();
  return [`refs/heads/${trimmed}`, `refs/remotes/${trimmed}`, `refs/remotes/*/${trimmed}`];
}

export function refResolutionArgs(ref: string): string[] {
  return ["for-each-ref", "--format=%(refname:short)", "--count=1", "--sort=-committerdate", ...commitRefPatterns(ref)];
}

export function commitLogArgs(ref: string, limit: number, skip: number): string[] {
  return [
    "log",
    `--format=${COMMIT_FORMAT}`,
    `--max-count=${commitPageLimit(limit)}`,
    `--skip=${commitPageSkip(skip)}`,
    "--decorate=off",
    "--end-of-options",
    ref.trim(),
    "--",
  ];
}

/** One commit's own record: the diff route reads it before asking for the patch. */
export function commitShowFormatArgs(sha: string): string[] {
  return ["show", "--no-patch", `--format=${COMMIT_FORMAT}`, "--end-of-options", sha.trim()];
}

/**
 * The files a commit changed, and the patch.
 *
 * A commit with two parents has no diff of its own — `git show` prints nothing for
 * it, which a panel would read as an empty commit. The first parent is the base the
 * merge was made against, so that is what the panel paints, the way a hosting site
 * does. `--find-renames` keeps a rename one row, matching the name-status pair.
 */
export function commitFilesArgs(sha: string, parentCount: number): string[] {
  const trimmed = sha.trim();
  return parentCount > 1
    ? ["diff", "--find-renames", "--name-status", "--end-of-options", `${trimmed}^1`, trimmed, "--"]
    : ["show", "--format=", "--name-status", "--find-renames", "--end-of-options", trimmed];
}

export function commitNumstatArgs(sha: string, parentCount: number): string[] {
  const trimmed = sha.trim();
  return parentCount > 1
    ? ["diff", "--find-renames", "--numstat", "--end-of-options", `${trimmed}^1`, trimmed, "--"]
    : ["show", "--format=", "--numstat", "--find-renames", "--end-of-options", trimmed];
}

export function commitPatchArgs(sha: string, parentCount: number): string[] {
  const trimmed = sha.trim();
  return parentCount > 1
    ? [
      "diff", "--no-color", "--no-ext-diff", "--find-renames", "--unified=3",
      "--end-of-options", `${trimmed}^1`, trimmed, "--",
    ]
    : ["show", "--no-color", "--no-ext-diff", "--find-renames", "--unified=3", "--format=", "--end-of-options", trimmed];
}

/**
 * git's record format, read back.
 *
 * Every record is wrapped in `%x1e`, so the output starts, ends and separates with
 * one: splitting on it yields empty slots, which are not commits. A record missing a
 * field is skipped for the same reason — the list is never allowed to paint a half
 * commit, because a row's sha is what its click opens.
 */
export function parseCommitRecords(output: string): GitCommitEntry[] {
  const commits: GitCommitEntry[] = [];
  for (const record of output.split(RECORD_SEPARATOR)) {
    if (!record.trim()) continue;
    const fields = record.split(FIELD_SEPARATOR);
    if (fields.length < 6) continue;
    const [sha, shortSha, subject, authorName, date, parents] = fields;
    if (!sha) continue;
    const dateMs = Date.parse(date);
    commits.push({
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      subject,
      authorName,
      dateMs: Number.isNaN(dateMs) ? 0 : dateMs,
      parentCount: parents ? parents.trim().split(/\s+/).filter(Boolean).length : 0,
    });
  }
  return commits;
}

const NAME_STATUS_KINDS: Record<string, GitFileStatusKind> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  // A copy is listed as a rename: the row's job is to name the file that appeared and
  // the one it came from, and `GitFileStatusKind` (lib/git-types.ts) is the file
  // viewer's vocabulary, which has no word for a copy.
  C: "renamed",
  T: "modified",
  U: "conflict",
};

/**
 * `git … --name-status` lines: `M\tpath`, and `R100\told\tnew` for a rename.
 *
 * The status letter carries the score on a rename (`R100`), so the letter is the
 * first character and the rest of that field is git's own number.
 */
export function parseNameStatus(output: string): GitCommitFile[] {
  const files: GitCommitFile[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const fields = trimmed.split("\t");
    const letter = fields[0]?.[0];
    if (!letter) continue;
    const status = NAME_STATUS_KINDS[letter];
    if (!status) continue;
    if (status === "renamed") {
      const oldPath = fields[1];
      const path = fields[2];
      if (!path) continue;
      files.push({ path, oldPath, status, additions: null, deletions: null });
      continue;
    }
    const path = fields[1];
    if (!path) continue;
    files.push({ path, status, additions: null, deletions: null });
  }
  return files;
}

/**
 * The path `--numstat` names a changed file by.
 *
 * A rename is not printed as a path: `a.txt => b.txt` in one folder, and
 * `deep/{same.txt => renamed.txt}` when the folders match. The name that survives is
 * the one the panel lists, because it is the one the file tree can open.
 */
export function numstatNewPath(raw: string): string {
  const value = raw.trim();
  const brace = /^(.*)\{([^{}]*)\}(.*)$/.exec(value);
  const pair = brace?.[2] ?? "";
  if (brace && pair.includes(" => ")) {
    const [oldPart, newPart] = pair.split(" => ");
    const before = brace[1] ?? "";
    const after = brace[3] ?? "";
    // `dir/{a => }b` is a rename that swallowed the separator; `dir/{ => sub}/a`
    // a move into a subfolder. Joining and tidying the slashes is what git means.
    const moved = `${before}${newPart}${after}`.replace(/\/{2,}/g, "/");
    if (newPart) return moved;
    return `${before}${oldPart}${after}`.replace(/\/{2,}/g, "/") || moved;
  }
  const arrow = value.lastIndexOf(" => ");
  if (arrow > 0) return value.slice(arrow + 4).trim();
  return value;
}

/** `--numstat` lines: additions, deletions and the file they belong to. */
export function parseNumstat(output: string): Map<string, { additions: number | null; deletions: number | null }> {
  const counts = new Map<string, { additions: number | null; deletions: number | null }>();
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split("\t");
    if (fields.length < 3) continue;
    const [added, deleted] = fields;
    const path = numstatNewPath(fields.slice(2).join("\t"));
    if (!path) continue;
    counts.set(path, {
      additions: added === "-" ? null : Number.parseInt(added, 10) || 0,
      deletions: deleted === "-" ? null : Number.parseInt(deleted, 10) || 0,
    });
  }
  return counts;
}

/** The files of a commit, with the line counts joined on. */
export function joinCommitFiles(nameStatusOutput: string, numstatOutput: string): GitCommitFile[] {
  const counts = parseNumstat(numstatOutput);
  return parseNameStatus(nameStatusOutput).map((file) => {
    const own = counts.get(file.path) ?? counts.get(file.oldPath ?? "") ?? null;
    return {
      ...file,
      additions: own?.additions ?? null,
      deletions: own?.deletions ?? null,
    };
  });
}

/** The ref a panel's branch row means: this folder's branch, else the remote's. */
export async function resolveCommitRef(repositoryRoot: string, ref: string): Promise<string | null> {
  if (!isSafeGitRef(ref)) return null;
  try {
    const out = await runGit(repositoryRoot, refResolutionArgs(ref));
    const matched = out.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (matched) return matched;
  } catch {
    // No ref of any of the three shapes; a sha or a tag is tried next.
  }
  if (!isCommitSha(ref) && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) return null;
  try {
    const out = await runGit(repositoryRoot, [
      "rev-parse", "--verify", "--quiet", "--end-of-options", `${ref.trim()}^{commit}`,
    ]);
    return out.trim() ? ref.trim() : null;
  } catch {
    return null;
  }
}

export interface CommitPage {
  commits: GitCommitEntry[];
  resolvedRef: string | null;
  hasMore: boolean;
}

/** One page of a ref's history, newest first. */
export async function readCommitPage(
  repositoryRoot: string,
  ref: string,
  options: { limit?: number; skip?: number } = {},
): Promise<CommitPage> {
  const limit = commitPageLimit(options.limit);
  const skip = commitPageSkip(options.skip);
  const resolvedRef = await resolveCommitRef(repositoryRoot, ref);
  if (!resolvedRef) return { commits: [], resolvedRef: null, hasMore: false };
  // One commit past the page: `hasMore` is answered without a second count.
  const out = await runGit(repositoryRoot, commitLogArgs(resolvedRef, limit + 1, skip));
  const records = parseCommitRecords(out);
  const hasMore = records.length > limit;
  return { commits: records.slice(0, limit), resolvedRef, hasMore };
}

export interface CommitDetail extends Omit<GitCommitDiffResponse, "isGitRepository"> {
  /** The patch's byte length, so the panel can say what it refused to paint. */
  patchBytes: number;
}

/** A commit, its files and its patch — the panel's third level. */
export async function readCommitDetail(repositoryRoot: string, sha: string): Promise<CommitDetail> {
  if (!isCommitSha(sha)) return { supported: false, reason: "unknown-commit", patchBytes: 0 };
  let commit: GitCommitEntry | undefined;
  try {
    [commit] = parseCommitRecords(await runGit(repositoryRoot, commitShowFormatArgs(sha)));
  } catch {
    return { supported: false, reason: "unknown-commit", patchBytes: 0 };
  }
  if (!commit) return { supported: false, reason: "unknown-commit", patchBytes: 0 };

  const parents = commit.parentCount;
  const [nameStatus, numstat] = await Promise.all([
    runGit(repositoryRoot, commitFilesArgs(sha, parents)).catch(() => ""),
    runGit(repositoryRoot, commitNumstatArgs(sha, parents)).catch(() => ""),
  ]);
  const files = joinCommitFiles(nameStatus, numstat);

  let patch = "";
  let tooLarge = false;
  try {
    patch = await runGit(repositoryRoot, commitPatchArgs(sha, parents), COMMIT_PATCH_MAX_BYTES);
  } catch (error) {
    tooLarge = isBufferOverflow(error);
  }
  const patchBytes = Buffer.byteLength(patch, "utf8");
  if (tooLarge) {
    return { supported: false, reason: "too-large", commit, repositoryRoot, files, patchBytes };
  }
  if (!patch.trim() || files.length === 0) {
    return { supported: false, reason: "no-changes", commit, repositoryRoot, files, patch, patchBytes };
  }
  return { supported: true, commit, repositoryRoot, files, patch, patchBytes };
}

/** `execFile`'s maxBuffer failure, which is the only way a patch is refused. */
function isBufferOverflow(error: unknown): boolean {
  const candidate = error as { code?: string; maxBuffer?: number; message?: string } | undefined;
  return candidate?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    || /maxBuffer/i.test(candidate?.message ?? "");
}

/** The repository the panel reads, or null for a folder git does not know. */
export { findRepositoryRoot };
