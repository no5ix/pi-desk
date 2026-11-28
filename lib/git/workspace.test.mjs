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

/** One session file per project, in the sandbox's sessions directory. */
async function seedSessions(agentDir, cwds) {
  const dir = path.join(agentDir, "sessions", "projects");
  await fs.mkdir(dir, { recursive: true });
  await Promise.all(cwds.map((cwd, index) => fs.writeFile(
    path.join(dir, `session-${index}.jsonl`),
    `${JSON.stringify({
      type: "session",
      version: 3,
      id: `project-list-${index}`,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd,
    })}\n`,
  )));
}

test("workspace: the project list is the app's project list, all of it", async () => {
  const { root, agentDir } = await createSandbox();
  const { workspace, projectDisplay } = await loadGitModules();
  const repoRoot = await createRepo(root, "repo");
  const plain = path.join(root, "plain");
  const gone = path.join(root, "gone");
  await fs.mkdir(plain, { recursive: true });
  await seedSessions(agentDir, [repoRoot, plain, gone]);
  await fileAccessAllow([repoRoot, plain, gone]);

  const listed = await workspace.listProjectRepos();
  const byPath = new Map(listed.map((entry) => [entry.path, entry]));

  assert.equal(byPath.get(repoRoot).isRepo, true, "the checkout is a repository, with its branch");
  assert.equal(byPath.get(repoRoot).branch, "main");
  assert.equal(byPath.get(repoRoot).isWorktree, false);

  // A project with no repository stays in the list. The switcher is the project
  // list, and dropping the folder the sidebar shows makes the two lists disagree;
  // the panel answers "no repository here" when it is opened on one.
  assert.equal(byPath.get(plain).isRepo, false, "a plain folder is listed and marked for what it is");
  assert.equal(byPath.get(plain).name, "plain");
  assert.equal(byPath.get(plain).branch, null);

  assert.ok(!byPath.has(gone), "a project whose folder is gone has nothing to switch to");

  // The names are the sidebar's: a bare basename, parent segments only where two
  // projects share one.
  assert.equal(
    byPath.get(plain).name,
    projectDisplay.getProjectDisplayName(plain, [repoRoot, plain]),
  );
});

test("workspace: the project list says a linked worktree is one, and names same-named folders apart", async () => {
  const { root, agentDir } = await createSandbox();
  const { workspace } = await loadGitModules();
  const repoRoot = await createRepo(root, "app");
  const worktreePath = path.join(root, "wt", "app");
  await addWorktree(repoRoot, worktreePath, "feature");
  await seedSessions(agentDir, [repoRoot, worktreePath]);
  await fileAccessAllow([repoRoot, worktreePath]);

  const listed = await workspace.listProjectRepos();
  const byPath = new Map(listed.map((entry) => [entry.path, entry]));

  assert.equal(byPath.get(worktreePath).isRepo, true);
  assert.equal(byPath.get(worktreePath).isWorktree, true, "a linked worktree is its own checkout");
  assert.equal(byPath.get(worktreePath).branch, "feature");
  assert.notEqual(byPath.get(repoRoot).name, byPath.get(worktreePath).name,
    "two checkouts named `app` are not listed under one word");
});

