import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  buildBranchRows,
  buildBranchTree,
  flattenBranchTree,
  worktreePathForBranch,
} = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./branch-tree.ts");

const MAIN = { path: "/repo", branch: "main", isMain: true };
const WT = { path: "/repo-worktrees/wt-test", branch: "wt-test", isMain: false };

/** The user's `auto-toc` case: a plain checkout on `main`, one linked worktree on `wt-test`. */
const AUTO_TOC = {
  branches: ["main", "wt-test", "fix/first-click-delayed-scroll", "fix/wt-test-first-click-delayed-scroll", "wt/wt-test-icon-face", "probe"],
  remoteBranches: ["main-bak"],
  worktrees: [MAIN, WT],
  checkoutPath: MAIN.path,
};

test("the current branch is first, the worktree branches follow, the rest keep git's order", () => {
  const rows = buildBranchRows(AUTO_TOC).map((row) => [row.name, row.kind]);
  assert.deepEqual(rows, [
    ["main", "current"],
    ["wt-test", "worktree"],
    ["fix/first-click-delayed-scroll", "branch"],
    ["fix/wt-test-first-click-delayed-scroll", "branch"],
    ["wt/wt-test-icon-face", "branch"],
    ["probe", "branch"],
    ["main-bak", "branch"],
  ]);
});

test("the current branch is this folder's branch, and it is listed once", () => {
  // The same repository read from the linked folder: `wt-test` is the branch on
  // top, and `main` — held by the main checkout — is the project's branch.
  const rows = buildBranchRows({ ...AUTO_TOC, checkoutPath: WT.path });
  assert.deepEqual(rows.map((row) => [row.name, row.kind]), [
    ["wt-test", "current"],
    ["main", "project"],
    ["fix/first-click-delayed-scroll", "branch"],
    ["fix/wt-test-first-click-delayed-scroll", "branch"],
    ["wt/wt-test-icon-face", "branch"],
    ["probe", "branch"],
    ["main-bak", "branch"],
  ]);
  assert.equal(rows.find((row) => row.name === "main").holderPath, MAIN.path);
  assert.equal(rows.find((row) => row.name === "main").holderIsMain, true);
  // A folder that is not a git repository answers with no worktrees at all.
  assert.deepEqual(buildBranchRows({ branches: [], remoteBranches: [], worktrees: [], checkoutPath: null }), []);
});

test("a branch a worktree holds is never asked of git twice", () => {
  const rows = buildBranchRows(AUTO_TOC);
  const held = rows.find((row) => row.name === "wt-test");
  assert.equal(held.holderPath, WT.path, "the row knows the folder that holds it");
  assert.equal(held.holderIsMain, false);
  assert.equal(rows.find((row) => row.name === "main").holderPath, MAIN.path,
    "the current branch is held by this folder: no worktree from it, and no removal of the folder you are standing in");
});

test("the rest of the list is a tree of the path its names already carry", () => {
  const rows = buildBranchRows(AUTO_TOC).filter((row) => row.kind === "branch");
  const tree = buildBranchTree(rows);
  assert.deepEqual(tree.leaves.map((row) => row.name), ["main-bak", "probe"],
    "a name with no `/` is a name, not a folder");
  assert.deepEqual(tree.groups.map((group) => [group.label, group.prefix, group.count, group.depth]), [
    ["fix", "fix", 2, 0],
    ["wt", "wt", 1, 0],
  ]);
  assert.deepEqual(tree.groups[0].leaves.map((row) => row.name),
    ["fix/first-click-delayed-scroll", "fix/wt-test-first-click-delayed-scroll"], "the group holds its own branches");
  assert.deepEqual(tree.groups[0].children, [], "a group whose branches are one segment deep has no subgroups");
});

test("a nested prefix nests: wt/a/b sits under wt then a", () => {
  const tree = buildBranchTree(buildBranchRows({
    branches: ["wt/a/b", "wt/a/c", "wt/d", "top"],
    remoteBranches: [],
    worktrees: [MAIN],
    checkoutPath: MAIN.path,
  }).filter((row) => row.kind === "branch"));
  assert.deepEqual(tree.groups.map((group) => group.label), ["wt"]);
  assert.deepEqual(tree.groups[0].leaves.map((row) => row.name), ["wt/d"]);
  assert.deepEqual(tree.groups[0].children.map((group) => [group.label, group.depth, group.count]), [["a", 1, 2]]);
  assert.deepEqual(tree.groups[0].children[0].leaves.map((row) => row.name), ["wt/a/b", "wt/a/c"]);
  assert.deepEqual(tree.leaves.map((row) => row.name), ["top"]);
});

test("the flattened list is the rows the panel paints, with the collapse honoured", () => {
  const items = flattenBranchTree(buildBranchTree(buildBranchRows(AUTO_TOC).filter((row) => row.kind === "branch")));
  assert.deepEqual(items.map((item) => [item.type, item.depth, item.label]), [
    ["leaf", 0, "main-bak"],
    ["leaf", 0, "probe"],
    ["group", 0, "fix"],
    ["leaf", 1, "first-click-delayed-scroll"],
    ["leaf", 1, "wt-test-first-click-delayed-scroll"],
    ["group", 0, "wt"],
    ["leaf", 1, "wt-test-icon-face"],
  ], "a leaf under a group is named by what the group prefix does not already say");

  const folded = flattenBranchTree(buildBranchTree(buildBranchRows(AUTO_TOC).filter((row) => row.kind === "branch")), new Set(["fix"]));
  assert.deepEqual(folded.map((item) => [item.type, item.label, item.collapsed ?? null, item.count ?? null]), [
    ["leaf", "main-bak", null, null],
    ["leaf", "probe", null, null],
    ["group", "fix", true, 2],
    ["group", "wt", false, 1],
    ["leaf", "wt-test-icon-face", null, null],
  ], "a folded group paints its own row and nothing under it, and says how many are hiding");

  // A filter box is the narrowing the collapse stands in for: a search that answers
  // from inside a folded folder is a dead end.
  const searching = flattenBranchTree(buildBranchTree(buildBranchRows(AUTO_TOC).filter((row) => row.kind === "branch")), new Set(["fix"]), { expandAll: true });
  assert.ok(searching.filter((item) => item.type === "leaf").length === 5, "the search shows every match, folded groups and all");
});

test("the form's folder is the folder the server will create", () => {
  // `lib/worktree.ts`'s addWorktree(): `<repo>-worktrees/<sanitizeBranchForDir(branch)>`.
  const dirName = (branch) => branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
  assert.equal(
    worktreePathForBranch("/Users/lynx/Documents/github/auto-toc", "wt/wt-test-icon-face", dirName),
    "/Users/lynx/Documents/github/auto-toc-worktrees/wt-wt-test-icon-face",
  );
  assert.equal(worktreePathForBranch("/repo/", "feature/x", dirName), "/repo-worktrees/feature-x");
  assert.equal(worktreePathForBranch("/repo", "   ", dirName), "/repo-worktrees/…",
    "an empty name still shows where it will land, with the name left to type");
});
