// Fork-owned: the naming rule behind the header's worktree glyph.
//
// A linked worktree is a fact about a folder (lib/worktree.ts answers it), and the
// header used to wear that fact as its project glyph: `[checkout glyph] auto-toc  main`.
// The user reads the row as a statement about the *branch* — "this branch has a folder of
// its own" — and the two come apart as soon as a worktree folder is switched to an
// ordinary branch: `auto-toc-worktrees/main-bak3-test-wt` sitting on `main` is, to the
// person typing in it, a plain folder on a plain branch, and the checkout glyph in front
// of the project's name is a claim about a branch they are not on.
//
// So the glyph asks a second question: is this folder the worktree that belongs to the
// branch we are on? The app creates its worktrees as `<repo>-worktrees/<branch>` with the
// branch name sanitized by lib/worktree.ts's `sanitizeBranchForDir`, which is exactly the
// pairing the user made when they pressed "worktree from branch". This module is the client
// half of that rule (lib/worktree.ts is server-only: it imports node:fs), and
// `lib/worktree-folder.test.mjs` keeps the two halves saying the same thing.

/** Replace the characters a folder name cannot carry, exactly as the worktree
 *  creator does. */
export function worktreeDirNameForBranch(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

/** The folder name of a checkout — the last segment of its path, on either separator. */
function folderName(path: string): string {
  const segments = path.split(/[/\\]+/).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

/**
 * True when `worktreePath` is the worktree this app made for `branch`.
 *
 * False for a branch the folder was switched to (an ordinary branch carried into a
 * worktree folder), and for a folder with no branch at all (detached HEAD, a plain
 * directory): in both cases the header shows the project's folder glyph.
 */
export function branchOwnsWorktreeFolder(worktreePath: string | null | undefined, branch: string | null | undefined): boolean {
  if (!worktreePath || !branch) return false;
  const dir = worktreeDirNameForBranch(branch);
  if (!dir) return false;
  return folderName(worktreePath) === dir;
}
