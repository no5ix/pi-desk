import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
/**
 * The naming rule behind the folder a worktree is created in.
 *
 * The app creates worktrees as `<repo>-worktrees/<branch>`, sanitized server-side by
 * lib/worktree.ts's `sanitizeBranchForDir` (node:fs, so the client cannot import it).
 * The new-worktree form shows that folder while the name is being typed, and
 * `lib/worktree-folder.ts` is the client half; this test is the seam between the two.
 *
 * The glyph rule this file used to pin is gone: the worktree glyph is a fact about the
 * folder (`isWorktree`), not about the branch it carries. A linked folder switched to an
 * ordinary branch — `auto-toc-worktrees/main-bak3-test-wt` carrying `main-bak` — is still
 * a worktree to the person typing in it, and the user asked for the glyph that says so
 * (`components/AppShell.worktree-project.test.mjs`,
 * `components/ProjectContextMenu.test.mjs` pin the new rule).
 */
const jiti = createJiti(import.meta.url);
const { sanitizeBranchForDir } = await jiti.import("./worktree.ts");
const { worktreeDirNameForBranch } = await jiti.import("./worktree-folder.ts");

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

test("the naming rule is asked of a branch the form has not finished typing", () => {
  assert.equal(worktreeDirNameForBranch(""), "", "an empty name gives no folder segment yet");
  assert.equal(worktreeDirNameForBranch("wt/wt-test-icon-face"), "wt-wt-test-icon-face");
  assert.equal(worktreeDirNameForBranch("  main-bak  "), "main-bak", "git's own trim, so the hint matches the folder");
});
