import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
/**
 * The rule behind the header's project glyph.
 *
 * A linked worktree folder answers `isWorktree: true` (lib/worktree.ts), and the header
 * put the checkout glyph in front of the project's name on that alone. Switch the folder
 * to an ordinary branch and the glyph keeps claiming a branch the session is not on:
 * `auto-toc-worktrees/main-bak3-test-wt` sitting on `main` reads, to the person typing in
 * it, as a folder on a plain branch — and that is the glyph the user asked for.
 *
 * The glyph therefore asks whether the folder is the worktree of the branch we are on,
 * which is the pairing the app itself makes when it creates `<repo>-worktrees/<branch>`.
 * The naming rule lives on the server (lib/worktree.ts, node:fs), so the client copy lives
 * in lib/worktree-folder.ts and this test is the seam between them.
 */
const jiti = createJiti(import.meta.url);
const { sanitizeBranchForDir } = await jiti.import("./worktree.ts");
const { worktreeDirNameForBranch, branchOwnsWorktreeFolder } = await jiti.import("./worktree-folder.ts");

test("the client's folder naming is the creator's naming", () => {
  for (const branch of [
    "main",
    "wt/wt-branch-picker-header-worktrees",
    "fix/wt-test-initial-heading-offset",
    "feat/simplify-toc-handle-and-localai",
    "claude/settings-layout-review-8265af",
    "release/1.0",
    "a:b*c?d\"e<f>g|h i",
    "///",
    "",
  ]) {
    assert.equal(worktreeDirNameForBranch(branch), sanitizeBranchForDir(branch), `naming for ${JSON.stringify(branch)}`);
  }
});

test("a worktree folder is the branch's own only when it carries that branch", () => {
  // The pairing the app made: `git worktree add` for the branch, in its own folder.
  assert.equal(branchOwnsWorktreeFolder("/repo-worktrees/fix-wt-test-initial-heading-offset", "fix/wt-test-initial-heading-offset"), true);
  assert.equal(branchOwnsWorktreeFolder("/repo-worktrees/wt-wt-branch-picker-header-worktrees", "wt/wt-branch-picker-header-worktrees"), true);
  // The case the user screenshotted: a worktree folder switched to an ordinary branch.
  assert.equal(branchOwnsWorktreeFolder("/repo-worktrees/main-bak3-test-wt", "main"), false);
  assert.equal(branchOwnsWorktreeFolder("/repo-worktrees/feature-x", "main"), false);
  // No branch (detached HEAD, a plain folder) says nothing about a worktree.
  assert.equal(branchOwnsWorktreeFolder("/repo-worktrees/feature-x", null), false);
  assert.equal(branchOwnsWorktreeFolder("/repo-worktrees/feature-x", ""), false);
  assert.equal(branchOwnsWorktreeFolder(null, "main"), false);
  // A branch name that sanitizes to nothing cannot own a folder.
  assert.equal(branchOwnsWorktreeFolder("/repo-worktrees/---", "///"), false);
  // The last segment, on either separator.
  assert.equal(branchOwnsWorktreeFolder("C:\\repo-worktrees\\feature-x", "feature/x"), true);
});
