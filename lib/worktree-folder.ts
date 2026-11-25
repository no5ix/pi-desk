// Fork-owned: the naming rule behind the folder a worktree is created in.
//
// The app creates its worktrees as `<repo>-worktrees/<branch>` with the branch name
// sanitized by lib/worktree.ts's `sanitizeBranchForDir`. The new-worktree form has to
// name that folder while the branch name is still being typed, and lib/worktree.ts is
// server-only (it imports node:fs), so this module carries the client half of the rule.
// `lib/worktree-folder.test.mjs` keeps the two halves saying the same thing.
//
// The worktree glyph is NOT asked of this rule. It used to be: a linked folder whose name
// did not match its branch — `auto-toc-worktrees/main-bak3-test-wt` carrying `main-bak`,
// the shape the user screenshotted — wore the plain project folder, on the argument that a
// row is read as a statement about the branch in front of it. The person working in that
// folder read it the other way round: the folder *is* a worktree, and the glyph that says
// so is the one they look for when they decide which folder a prompt will run in. So the
// glyph asks one question, of the folder: `ProjectInfo.isWorktree` /
// `SessionInfo.isWorktree` (lib/worktree.ts, lib/session-reader.ts). A linked worktree
// wears the checkout glyph, whatever branch it carries; the main checkout and a plain
// folder wear the project folder.

/** Replace the characters a folder name cannot carry, exactly as the worktree
 *  creator does. */
export function worktreeDirNameForBranch(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}
