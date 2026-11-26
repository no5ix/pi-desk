import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { addWorktree, createOrigin, createRepo, createSandbox, git, loadGitModules } from "./test-helpers.mjs";

/** Repository discovery and the repository boundary every Git request checks. */
test("workspace: the cwd's checkout is the active repository", async () => {
  const { root } = await createSandbox();
  const { workspace, fileAccess } = await loadGitModules();
  const repoRoot = await createRepo(root);
  fileAccess.allowFileRoot(repoRoot);

  const found = await workspace.discoverWorkspaceRepos(repoRoot);
  assert.equal(found.currentId, repoRoot);
  assert.deepEqual(found.repos.map((repo) => repo.id), [repoRoot]);
  assert.equal(found.repos[0].branch, "main");
  assert.equal(found.repos[0].isWorktree, false);
});

test("workspace: a subdirectory reports the checkout that owns it", async () => {
  const { root } = await createSandbox();
  const { workspace, fileAccess } = await loadGitModules();
  const repoRoot = await createRepo(root);
  const nested = path.join(repoRoot, "nested");
  await fs.mkdir(nested, { recursive: true });
  fileAccess.allowFileRoot(nested);

  const found = await workspace.discoverWorkspaceRepos(nested);
  assert.equal(found.currentId, repoRoot);
});

test("workspace: every worktree is its own repository, and resolves to its own paths", async () => {
  const { root } = await createSandbox();
  const { workspace } = await loadGitModules();
  const repoRoot = await createRepo(root);
  const worktreePath = path.join(root, "wt-feature");
  await addWorktree(repoRoot, worktreePath, "feature");
  // Both checkouts must be authorized for the panel to reach them.
  await fileAccessAllow([repoRoot, worktreePath]);

  const found = await workspace.discoverWorkspaceRepos(repoRoot);
  assert.equal(found.currentId, repoRoot);
  const ids = found.repos.map((repo) => repo.id).sort();
  assert.deepEqual(ids, [repoRoot, worktreePath].sort());
  const worktree = found.repos.find((repo) => repo.id === worktreePath);
  assert.equal(worktree.isWorktree, true);
  assert.equal(worktree.branch, "feature");

  const main = await workspace.resolveRepoRuntime(repoRoot, repoRoot);
  const linked = await workspace.resolveRepoRuntime(repoRoot, worktreePath);
  assert.notEqual(main.paths.workTreeRoot, linked.paths.workTreeRoot);
  assert.notEqual(main.paths.gitDir, linked.paths.gitDir);
  // ...while both share the repository's object store and refs.
  assert.equal(main.paths.commonDir, linked.paths.commonDir);
});

test("workspace: an operation runs against the selected worktree, not the main checkout", async () => {
  const { root } = await createSandbox();
  const { workspace, commands } = await loadGitModules();
  const repoRoot = await createRepo(root);
  const worktreePath = path.join(root, "wt-feature");
  await addWorktree(repoRoot, worktreePath, "feature");
  await fileAccessAllow([repoRoot, worktreePath]);

  // Write an uncommitted change inside the worktree only.
  await fs.writeFile(path.join(worktreePath, "app.ts"), "export const value = 2;\n");

  const inWorktree = await commands.runGitCommand({ cwd: worktreePath, command: "getWorkingTreeChanges" });
  assert.deepEqual(inWorktree.map((file) => file.path), ["app.ts"]);

  const inMain = await commands.runGitCommand({ cwd: repoRoot, command: "getWorkingTreeChanges" });
  assert.deepEqual(inMain, []);

  const branchInWorktree = await commands.runGitCommand({ cwd: worktreePath, command: "getBranches" });
  const current = branchInWorktree.filter((branch) => branch.isCurrent).map((branch) => branch.name);
  assert.deepEqual(current, ["feature"]);
});

test("workspace: a folder holding repositories lists the ones inside it", async () => {
  const { root } = await createSandbox();
  const { workspace, fileAccess } = await loadGitModules();
  const plain = path.join(root, "workspace-folder");
  await fs.mkdir(plain, { recursive: true });
  const first = await createRepo(root, "first");
  const second = await createRepo(root, "second");
  await fs.rename(first, path.join(plain, "first"));
  await fs.rename(second, path.join(plain, "second"));
  fileAccess.allowFileRoot(plain);

  const found = await workspace.discoverWorkspaceRepos(plain);
  assert.equal(found.currentId, null);
  assert.deepEqual(found.repos.map((repo) => repo.name).sort(), ["first", "second"]);
});

test("workspace: a plain folder is not a repository", async () => {
  const { root } = await createSandbox();
  const { workspace, fileAccess } = await loadGitModules();
  const plain = path.join(root, "plain");
  await fs.mkdir(plain, { recursive: true });
  fileAccess.allowFileRoot(plain);

  const found = await workspace.discoverWorkspaceRepos(plain);
  assert.equal(found.currentId, null);
  assert.deepEqual(found.repos, []);
  assert.equal(await workspace.resolveRepoRuntime(plain, null), null);
});

test("workspace: a cwd outside the allowed roots yields nothing", async () => {
  const { root } = await createSandbox();
  const { workspace } = await loadGitModules();
  const repoRoot = await createRepo(root);

  const found = await workspace.discoverWorkspaceRepos(repoRoot);
  assert.deepEqual(found.repos, []);
  assert.equal(await workspace.resolveRepoRuntime(repoRoot, repoRoot), null);
});

test("workspace: a repoId the cwd cannot reach is refused", async () => {
  const { root } = await createSandbox();
  const { workspace, fileAccess } = await loadGitModules();
  const repoRoot = await createRepo(root);
  const stranger = await createRepo(root, "stranger");
  await fileAccessAllow([repoRoot, stranger]);

  // The path exists, is a repository, and is an allowed root — but discovery
  // from `repoRoot` never reaches it, so the panel may not act on it.
  assert.equal(await workspace.resolveRepoRuntime(repoRoot, stranger), null);
  assert.ok((await workspace.discoverWorkspaceRepos(stranger)).repos.some((repo) => repo.id === stranger));
});

test("workspace: the repo list labels same-named checkouts apart", async () => {
  const { root } = await createSandbox();
  const { workspace, fileAccess } = await loadGitModules();
  const groupA = path.join(root, "group-a");
  const groupB = path.join(root, "group-b");
  await fs.mkdir(groupA, { recursive: true });
  await fs.mkdir(groupB, { recursive: true });
  for (const group of [groupA, groupB]) {
    const created = await createRepo(root, "app");
    await fs.rename(created, path.join(group, "app"));
  }
  await fileAccessAllow([groupA, groupB]);

  const a = await workspace.discoverWorkspaceRepos(groupA);
  const b = await workspace.discoverWorkspaceRepos(groupB);
  const labelA = workspace.repoLabel(a.repos[0], [...a.repos, ...b.repos]);
  const labelB = workspace.repoLabel(b.repos[0], [...a.repos, ...b.repos]);
  assert.notEqual(labelA, labelB);
  assert.match(labelA, /app/);
});

test("workspace: push/fetch/update round-trips through the origin remote", async () => {
  const { root } = await createSandbox();
  const { workspace, commands } = await loadGitModules();
  const repoRoot = await createRepo(root);
  await createOrigin(root, repoRoot);
  await fileAccessAllow([repoRoot]);

  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 3;\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "second commit");

  const pushOutput = await commands.runGitCommand({
    cwd: repoRoot,
    command: "pushBranch",
    params: { branch: "main" },
  });
  // `git push` reports to stderr; the contract is "no throw", checked by the ahead count.

  const ahead = await commands.runGitCommand({
    cwd: repoRoot,
    command: "getAheadCommits",
    params: { branch: "main" },
  });
  assert.deepEqual(ahead, []);

  await commands.runGitCommand({ cwd: repoRoot, command: "fetchAll" });
  const branches = await commands.runGitCommand({ cwd: repoRoot, command: "getBranches" });
  const main = branches.find((branch) => branch.name === "main");
  assert.equal(main.upstream, "origin/main");
  assert.equal(main.ahead, 0);
  assert.equal(main.behind, 0);
});

async function fileAccessAllow(roots) {
  const { fileAccess } = await loadGitModules();
  for (const root of roots) fileAccess.allowFileRoot(root);
}
