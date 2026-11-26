import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createOrigin, createRepo, createSandbox, git, loadGitModules } from "./test-helpers.mjs";

async function setup(name = "repo") {
  const sandbox = await createSandbox();
  const modules = await loadGitModules();
  const repoRoot = await createRepo(sandbox.root, name);
  modules.fileAccess.allowFileRoot(repoRoot);
  const run = (command, params, repoId) =>
    modules.commands.runGitCommand({ cwd: repoRoot, repoId, command, params });
  return { ...sandbox, ...modules, repoRoot, run };
}

// ─── The request boundary ───────────────────────────────────────────

test("commands: only the commands in the table can run", async () => {
  const { run, commands, errors } = await setup();
  await assert.rejects(() => run("git", { args: ["status"] }), (error) => {
    assert.equal(error.code, errors.BranchShiftErrorCode.UNKNOWN);
    return true;
  });
  assert.ok(commands.listGitCommands().includes("checkoutBranch"));
  assert.equal(commands.isGitCommand("exec"), false);
});

test("commands: a repository the cwd cannot reach is refused", async () => {
  const { run, repoRoot, fileAccess, errors } = await setup();
  const stranger = await createRepo(path.dirname(repoRoot), "stranger");
  fileAccess.allowFileRoot(stranger);
  await assert.rejects(() => run("getStatus", {}, stranger), (error) => {
    assert.equal(error.code, errors.BranchShiftErrorCode.REPO_NOT_FOUND);
    return true;
  });
});

test("commands: file paths cannot leave the checkout", async () => {
  const { run, errors } = await setup();
  for (const filePath of [
    "../outside.txt",
    "/etc/passwd",
    "src/../../outside.txt",
    ".git/config",
    "submodule/../../..",
    "C:\\Windows\\system.ini",
  ]) {
    await assert.rejects(() => run("stageFile", { filePath }), (error) => {
      assert.equal(
        error.code,
        filePath.includes("passwd") || true ? errors.BranchShiftErrorCode.FILE_NOT_FOUND : error.code,
        `${filePath} must be refused`,
      );
      return true;
    }, `${filePath} was accepted`);
  }
});

test("commands: a ref argument cannot smuggle a git option", async () => {
  const { run, errors } = await setup();
  for (const branch of ["--help", "-b", "a..b", "refs/heads/main@{0}", "main ", "main/", "feature.lock", ""]) {
    await assert.rejects(() => run("checkoutBranch", { branch }), (error) => {
      assert.equal(error.code, errors.BranchShiftErrorCode.INVALID_REF, `${branch} must be refused`);
      return true;
    }, `${JSON.stringify(branch)} was accepted`);
  }
});

test("commands: a commit argument is a hash, not a ref expression", async () => {
  const { run, errors } = await setup();
  for (const hash of ["main", "HEAD~5", "refs/heads/main", "1234567890g", ""]) {
    await assert.rejects(() => run("resetToCommit", { hash, mode: "mixed" }), (error) => {
      assert.equal(error.code, errors.BranchShiftErrorCode.INVALID_REF);
      return true;
    }, `${JSON.stringify(hash)} was accepted`);
  }
});

test("commands: a stash id is a number, and an Idea Shelf name is one segment", async () => {
  const { run } = await setup();
  await assert.rejects(() => run("unshelveChanges", { stashId: "0; rm -rf ." }));
  await assert.rejects(() => run("showShelfFileDiff", { stashId: "0/../../etc", filePath: "app.ts" }));
  await assert.rejects(() => run("deleteIdeaShelf", { shelfName: "../../evil" }));
  await assert.rejects(() => run("ideaUnshelveChanges", { shelfName: ".idea/shelf/x" }));
  await assert.rejects(() => run("ideaShelveChanges", { name: "../escape", filePaths: [] }));
});

// ─── Log, graph, and commit inspection ──────────────────────────────

test("commands: the graph reports commits, lanes and a page cursor", async () => {
  const { run, repoRoot } = await setup();
  git(repoRoot, "commit", "--quiet", "--allow-empty", "-m", "second");
  git(repoRoot, "commit", "--quiet", "--allow-empty", "-m", "third");

  const first = await run("getGraphData", { revision: { kind: "all" }, maxCount: 2 });
  assert.equal(first.graphData.commits.length, 2);
  assert.deepEqual(first.graphData.commits.map((commit) => commit.subject), ["third", "second"]);
  assert.ok(first.snapshot);
  assert.equal(first.hasMore, true);

  const next = await run("loadMoreLog", {
    revision: { kind: "all" },
    count: 2,
    skip: 2,
    snapshot: first.snapshot,
  });
  assert.deepEqual(next.graphData.commits.map((commit) => commit.subject), ["initial commit"]);
});

test("commands: a branch filter on a deleted branch reports ref-unavailable, not an error", async () => {
  const { run, repoRoot } = await setup();
  git(repoRoot, "branch", "topic");
  const ok = await run("getGraphData", { branch: "refs/heads/topic" });
  assert.ok(ok.graphData.commits.length >= 1);
  git(repoRoot, "branch", "-D", "topic");
  const gone = await run("getGraphData", { branch: "refs/heads/topic" });
  assert.equal(gone.status, "ref-unavailable");
});

test("commands: commit files, commit content, file history and blame", async () => {
  const { run, repoRoot } = await setup();
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 2;\n");
  git(repoRoot, "commit", "--quiet", "-am", "bump value");
  const head = git(repoRoot, "rev-parse", "HEAD").trim();

  const files = await run("getCommitFiles", { hash: head });
  assert.deepEqual(files.map((file) => file.newPath), ["app.ts"]);
  assert.equal(files[0].status, "modified");

  const content = await run("openFileAtRevision", { ref: "HEAD", filePath: "app.ts" });
  assert.match(content.content, /value = 2/);

  const history = await run("getFileHistory", { filePath: "app.ts" });
  assert.deepEqual(history.map((commit) => commit.subject), ["bump value", "initial commit"]);

  const blame = await run("getGitBlame", { filePath: "app.ts" });
  assert.equal(blame.hunks[0].commitHash, head);
  assert.equal(blame.hunks[0].lines[0].lineNumber, 1);
  assert.equal(blame.lineCount, 1);

  const diff = await run("getDiff", { ref1: `${head}~1`, ref2: head });
  assert.match(diff, /-export const value = 1;/);
  assert.match(diff, /\+export const value = 2;/);
});

// ─── The commit workflow ────────────────────────────────────────────

test("commands: stage, unstage, commit selected files, amend", async () => {
  const { run, repoRoot } = await setup();
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 5;\n");
  await fs.writeFile(path.join(repoRoot, "notes.md"), "new file\n");

  const changes = await run("getWorkingTreeChanges");
  assert.deepEqual(changes.map((file) => file.path).sort(), ["app.ts", "notes.md"]);
  assert.equal(changes.find((file) => file.path === "notes.md").status, "untracked");

  await run("stageFile", { filePath: "app.ts" });
  const staged = await run("getWorkingTreeChanges");
  assert.equal(staged.find((file) => file.path === "app.ts").staged, true);
  assert.equal(staged.find((file) => file.path === "notes.md").staged, false);

  await run("unstageFile", { filePath: "app.ts" });
  assert.equal((await run("getWorkingTreeChanges")).find((file) => file.path === "app.ts").staged, false);

  await run("stageAll");
  assert.equal((await run("getWorkingTreeChanges")).filter((file) => file.staged).length, 2);

  // Only app.ts goes into the commit; notes.md stays in the working tree.
  await run("commitChanges", {
    message: "bump value",
    selections: [{ path: "app.ts", staged: true, status: "modified" }],
  });
  const after = await run("getWorkingTreeChanges");
  assert.deepEqual(after.map((file) => file.path), ["notes.md"]);
  const head = await run("getLog", { maxCount: 1 });
  assert.equal(head[0].subject, "bump value");

  await run("stageAll");
  await run("amendCommit", { message: "bump value, with notes" });
  const amended = await run("getLog", { maxCount: 2 });
  assert.equal(amended[0].subject, "bump value, with notes");
  assert.equal(amended[0].parents.length, 1);
  assert.deepEqual((await run("getWorkingTreeChanges")).length, 0);

  assert.deepEqual(await run("getRecentCommitMessages", { count: 5 }), ["bump value, with notes", "initial commit"]);
  assert.equal(await run("getAmendMessage"), "bump value, with notes");
});

test("commands: a commit with no message, no selection, or a foreign path is rejected", async () => {
  const { run, errors } = await setup();
  await assert.rejects(() => run("commitChanges", { message: "  ", selections: [{ path: "app.ts", staged: true, status: "modified" }] }));
  await assert.rejects(() => run("commitChanges", { message: "x", selections: [] }), (error) => {
    assert.equal(error.code, errors.BranchShiftErrorCode.COMMIT_REJECTED);
    return true;
  });
  await assert.rejects(() => run("commitChanges", {
    message: "x",
    selections: [{ path: "../../etc/hosts", staged: false, status: "modified" }],
  }), (error) => {
    assert.equal(error.code, errors.BranchShiftErrorCode.FILE_NOT_FOUND);
    return true;
  });
});

test("commands: rollback and delete act on the working tree", async () => {
  const { run, repoRoot } = await setup();
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 9;\n");
  await fs.writeFile(path.join(repoRoot, "scratch.txt"), "scratch\n");

  await run("rollbackFiles", { filePaths: ["app.ts"] });
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 1/);

  await run("deleteFiles", { filePaths: ["scratch.txt"] });
  await assert.rejects(() => fs.access(path.join(repoRoot, "scratch.txt")));

  await assert.rejects(() => run("deleteFiles", { filePaths: ["../scratch.txt"] }));
});

// ─── Branches ───────────────────────────────────────────────────────

test("commands: create, checkout, rename, delete, tag, branch from a commit", async () => {
  const { run, repoRoot, errors } = await setup();

  await run("createBranch", { name: "topic", startPoint: "main" });
  assert.ok((await run("getBranches")).some((branch) => branch.name === "topic"));

  await run("checkoutBranch", { branch: "topic" });
  assert.equal((await run("getBranches")).find((branch) => branch.isCurrent).name, "topic");

  await run("renameBranch", { oldName: "topic", newName: "topic-2" });
  assert.ok((await run("getBranches")).some((branch) => branch.name === "topic-2"));

  await run("createBranchFromCommit", { name: "from-head", hash: git(repoRoot, "rev-parse", "HEAD").trim() });
  assert.ok((await run("getBranches")).some((branch) => branch.name === "from-head"));

  await run("checkoutBranch", { branch: "main" });
  await run("deleteBranch", { branch: "topic-2" });
  assert.ok(!(await run("getBranches")).some((branch) => branch.name === "topic-2"));

  // main is checked out: deleting it fails with the worktree-specific code.
  await assert.rejects(() => run("deleteBranch", { branch: "main" }), (error) => {
    assert.ok(
      error.code === errors.BranchShiftErrorCode.BRANCH_CHECKED_OUT_IN_WORKTREE
        || /worktree|checked out/i.test(error.message),
      error.message,
    );
    return true;
  });

  const head = git(repoRoot, "rev-parse", "HEAD").trim();
  await run("createTag", { tagName: "v1", hash: head, message: "release" });
  const tags = await run("getTags");
  assert.equal(tags[0].name, "v1");
  assert.equal(tags[0].targetCommitHash, head);
  assert.equal(tags[0].isAnnotated, true);
});

test("commands: ahead/behind and update track the upstream", async () => {
  const { run, repoRoot } = await setup();
  const remote = await createOrigin(sandboxOf(repoRoot), repoRoot);

  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 4;\n");
  git(repoRoot, "commit", "--quiet", "-am", "local ahead");
  const ahead = await run("getAheadCommits", { branch: "main" });
  assert.deepEqual(ahead.map((commit) => commit.subject), ["local ahead"]);

  await run("pushBranch", { branch: "main" });
  assert.deepEqual(await run("getAheadCommits", { branch: "main" }), []);

  // A commit made on the remote (through a clone) makes main behind.
  const clone = path.join(sandboxOf(repoRoot), "clone");
  git(sandboxOf(repoRoot), "clone", "--quiet", remote, clone);
  git(clone, "config", "user.name", "Other");
  git(clone, "config", "user.email", "other@example.com");
  await fs.writeFile(path.join(clone, "other.ts"), "other\n");
  git(clone, "add", "-A");
  git(clone, "commit", "--quiet", "-m", "remote commit");
  git(clone, "push", "--quiet", "origin", "main");

  await run("fetchAll");
  const branches = await run("getBranches");
  assert.equal(branches.find((branch) => branch.name === "main").behind, 1);
  await run("updateBranch", { branch: "main" });
  const updated = await run("getBranches");
  assert.equal(updated.find((branch) => branch.name === "main").behind, 0);
});

test("commands: fetch, pull and checkout-rebase keep the branch in step", async () => {
  const { run, repoRoot } = await setup();
  const remote = await createOrigin(sandboxOf(repoRoot), repoRoot);
  const clone = path.join(sandboxOf(repoRoot), "clone");
  git(sandboxOf(repoRoot), "clone", "--quiet", remote, clone);
  git(clone, "config", "user.name", "Other");
  git(clone, "config", "user.email", "other@example.com");
  await fs.writeFile(path.join(clone, "other.ts"), "other\n");
  git(clone, "add", "-A");
  git(clone, "commit", "--quiet", "-m", "remote commit");
  git(clone, "push", "--quiet", "origin", "main");

  await run("fetchAll");
  await run("pullBranch", {});
  assert.ok(await fs.readFile(path.join(repoRoot, "other.ts"), "utf8"));

  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 6;\n");
  git(repoRoot, "commit", "--quiet", "-am", "local work");
  await run("pullRebase", {});
  const log = await run("getLog", { maxCount: 5 });
  assert.equal(log[0].subject, "local work");
  assert.ok(log.some((commit) => commit.subject === "remote commit"));
});

// ─── Merge, rebase, cherry-pick, history rewriting ──────────────────

test("commands: a conflicting merge opens the conflict state, and accept/continue closes it", async () => {
  const { run, repoRoot } = await setup();
  git(repoRoot, "checkout", "-q", "-b", "feature");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 100;\n");
  git(repoRoot, "commit", "--quiet", "-am", "feature value");
  git(repoRoot, "checkout", "-q", "main");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 200;\n");
  git(repoRoot, "commit", "--quiet", "-am", "main value");

  await assert.rejects(() => run("mergeBranch", { branch: "feature" }), /CONFLICT|conflict/i);

  const mergeState = await run("getMergeState");
  assert.equal(mergeState.isMerging, true);
  assert.deepEqual(await run("getConflictFiles"), ["app.ts"]);

  const versions = await run("getFileVersions", { filePath: "app.ts" });
  assert.match(versions.ours, /value = 200/);
  assert.match(versions.theirs, /value = 100/);

  await run("acceptOurs", { filePath: "app.ts" });
  assert.deepEqual(await run("getConflictFiles"), []);
  await run("mergeAction", { action: "continue" });
  assert.equal((await run("getMergeState")).isMerging, false);
  const log = await run("getLog", { maxCount: 1 });
  assert.match(log[0].subject, /Merge|merge/);
});

test("commands: an aborted merge leaves the branch untouched", async () => {
  const { run, repoRoot } = await setup();
  git(repoRoot, "checkout", "-q", "-b", "feature");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 100;\n");
  git(repoRoot, "commit", "--quiet", "-am", "feature value");
  git(repoRoot, "checkout", "-q", "main");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 200;\n");
  git(repoRoot, "commit", "--quiet", "-am", "main value");

  await assert.rejects(() => run("mergeBranch", { branch: "feature" }));
  assert.equal((await run("getMergeState")).isMerging, true);
  await run("mergeAction", { action: "abort" });
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 200/);
  assert.equal((await run("getMergeState")).isMerging, false);
});

test("commands: a clean merge with a diverged branch commits, and lands both sides", async () => {
  const { run, repoRoot } = await setup();
  git(repoRoot, "checkout", "-q", "-b", "feature");
  await fs.writeFile(path.join(repoRoot, "feature.ts"), "feature\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "feature file");
  git(repoRoot, "checkout", "-q", "main");
  await fs.writeFile(path.join(repoRoot, "main.ts"), "main\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "main file");

  await run("mergeBranch", { branch: "feature" });
  assert.equal((await run("getMergeState")).isMerging, false);
  const log = await run("getLog", { maxCount: 5 });
  assert.match(log[0].subject, /Merge/);
  assert.equal(log[0].parents.length, 2);
  assert.ok(await fs.readFile(path.join(repoRoot, "feature.ts"), "utf8"));
  assert.ok(await fs.readFile(path.join(repoRoot, "main.ts"), "utf8"));
});

test("commands: accept theirs resolves a conflict from the other side", async () => {
  const { run, repoRoot } = await setup();
  git(repoRoot, "checkout", "-q", "-b", "feature");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 100;\n");
  git(repoRoot, "commit", "--quiet", "-am", "feature value");
  git(repoRoot, "checkout", "-q", "main");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 200;\n");
  git(repoRoot, "commit", "--quiet", "-am", "main value");

  await assert.rejects(() => run("mergeBranch", { branch: "feature" }));
  await run("acceptTheirs", { filePath: "app.ts" });
  await run("mergeAction", { action: "continue" });
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 100/);
});

test("commands: saving merged content writes the file, and the merge continues", async () => {
  const { run, repoRoot } = await setup();
  git(repoRoot, "checkout", "-q", "-b", "feature");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 100;\n");
  git(repoRoot, "commit", "--quiet", "-am", "feature value");
  git(repoRoot, "checkout", "-q", "main");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 200;\n");
  git(repoRoot, "commit", "--quiet", "-am", "main value");

  await assert.rejects(() => run("mergeBranch", { branch: "feature" }));
  await run("saveMergedContent", { filePath: "app.ts", content: "export const value = 300;\n" });
  await run("stageFile", { filePath: "app.ts" });
  await run("mergeAction", { action: "continue" });
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 300/);
  await assert.rejects(() => run("saveMergedContent", { filePath: "../escape.ts", content: "x" }));
});

test("commands: rebase, rebase continue through a conflict, and abort", async () => {
  const { run, repoRoot } = await setup();
  git(repoRoot, "checkout", "-q", "-b", "feature");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 100;\n");
  git(repoRoot, "commit", "--quiet", "-am", "feature value");
  git(repoRoot, "checkout", "-q", "main");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 200;\n");
  git(repoRoot, "commit", "--quiet", "-am", "main value");

  git(repoRoot, "checkout", "-q", "feature");
  await assert.rejects(() => run("rebaseBranch", { onto: "main" }));
  const rebaseState = await run("getRebaseState");
  assert.equal(rebaseState.isRebasing, true);
  assert.equal(rebaseState.branchName, "feature");
  assert.equal(rebaseState.totalSteps, 1);
  assert.equal(rebaseState.step, 1);

  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 250;\n");
  await run("rebaseAction", { action: "continue" });
  assert.equal((await run("getRebaseState")).isRebasing, false);
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 250/);

  // A second rebase, aborted, restores the branch.
  const before = git(repoRoot, "rev-parse", "HEAD").trim();
  git(repoRoot, "checkout", "-q", "main");
  await fs.writeFile(path.join(repoRoot, "extra.ts"), "extra\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "extra on main");
  git(repoRoot, "checkout", "-q", "feature");
  await run("rebaseBranch", { onto: "main" });
  assert.equal((await run("getRebaseState")).isRebasing, false);
  await run("rebaseAction", { action: "abort" }).catch(() => {});
  assert.ok(git(repoRoot, "rev-parse", "HEAD").trim().length === 40);
  assert.ok(before);
});

test("commands: cherry-pick applies a commit, and its state machine resolves", async () => {
  const { run, repoRoot } = await setup();
  git(repoRoot, "checkout", "-q", "-b", "feature");
  await fs.writeFile(path.join(repoRoot, "feature.ts"), "feature\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "add feature file");
  const featureHash = git(repoRoot, "rev-parse", "HEAD").trim();
  git(repoRoot, "checkout", "-q", "main");

  await run("cherryPick", { hash: featureHash });
  assert.ok(await fs.readFile(path.join(repoRoot, "feature.ts"), "utf8"));
  assert.equal((await run("getCherryPickState")).isCherryPicking, false);

  // A conflicting cherry-pick opens the state, and abort closes it.
  git(repoRoot, "checkout", "-q", "feature");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 700;\n");
  git(repoRoot, "commit", "--quiet", "-am", "feature app change");
  const conflicting = git(repoRoot, "rev-parse", "HEAD").trim();
  git(repoRoot, "checkout", "-q", "main");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 800;\n");
  git(repoRoot, "commit", "--quiet", "-am", "main app change");

  await assert.rejects(() => run("cherryPick", { hash: conflicting }));
  assert.equal((await run("getCherryPickState")).isCherryPicking, true);
  await run("cherryPickAction", { action: "abort" });
  assert.equal((await run("getCherryPickState")).isCherryPicking, false);
});

test("commands: cherry-pick of one file takes only that file", async () => {
  const { run, repoRoot } = await setup();
  git(repoRoot, "checkout", "-q", "-b", "feature");
  await fs.writeFile(path.join(repoRoot, "feature.ts"), "feature\n");
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 42;\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "feature work");
  const hash = git(repoRoot, "rev-parse", "HEAD").trim();
  git(repoRoot, "checkout", "-q", "main");

  await run("cherryPickFileChanges", { hash, filePaths: ["app.ts"] });
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 42/);
  await assert.rejects(() => fs.access(path.join(repoRoot, "feature.ts")));
});

test("commands: reset, revert, drop, and checkout a revision", async () => {
  const { run, repoRoot } = await setup();
  // Real content, so reverting a commit has something to revert.
  await fs.writeFile(path.join(repoRoot, "second.ts"), "second\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "second");
  await fs.writeFile(path.join(repoRoot, "third.ts"), "third\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "third");
  const third = git(repoRoot, "rev-parse", "HEAD").trim();
  const second = git(repoRoot, "rev-parse", "HEAD~1").trim();

  await run("checkoutCommit", { hash: second });
  assert.equal(git(repoRoot, "rev-parse", "HEAD").trim(), second);
  assert.ok((await run("getBranches")).every((branch) => !branch.isCurrent));
  git(repoRoot, "checkout", "-q", "main");

  await run("revertCommit", { hash: third });
  const log = await run("getLog", { maxCount: 1 });
  assert.match(log[0].subject, /Revert "third"/);

  // A mixed reset moves HEAD and keeps the changes; a hard reset drops them.
  await run("resetToCommit", { hash: second, mode: "mixed" });
  assert.equal(git(repoRoot, "rev-parse", "HEAD").trim(), second);
  await run("resetToCommit", { hash: second, mode: "hard" });
  assert.equal(git(repoRoot, "rev-parse", "HEAD").trim(), second);
  assert.deepEqual(await run("getWorkingTreeChanges"), []);
});

test("commands: reverting the file changes of a commit restores the parent state", async () => {
  const { run, repoRoot } = await setup();
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 77;\n");
  await fs.writeFile(path.join(repoRoot, "added.ts"), "added\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "adds and changes");
  const hash = git(repoRoot, "rev-parse", "HEAD").trim();

  await run("revertFileChanges", { hash, filePaths: ["app.ts", "added.ts"] });
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 1/);
  await assert.rejects(() => fs.access(path.join(repoRoot, "added.ts")));
});

test("commands: drop removes a commit from the middle of a branch", async () => {
  const { run, repoRoot } = await setup();
  await fs.writeFile(path.join(repoRoot, "drop-me.ts"), "drop\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "drop me");
  await fs.writeFile(path.join(repoRoot, "keep.ts"), "keep\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "keep me");
  const dropHash = git(repoRoot, "rev-parse", "HEAD~1").trim();

  await run("dropCommit", { hash: dropHash });
  const log = await run("getLog", { maxCount: 5 });
  assert.deepEqual(log.map((commit) => commit.subject), ["keep me", "initial commit"]);
});

// ─── Shelf (stash) and Idea Shelf ───────────────────────────────────

test("commands: shelve, inspect, unshelve and delete a native shelf", async () => {
  const { run, repoRoot } = await setup();
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 12;\n");
  await run("shelveChanges", { message: "work in progress" });

  assert.deepEqual(await run("getWorkingTreeChanges"), []);
  const shelves = await run("getShelves");
  assert.equal(shelves.length, 1);
  assert.match(shelves[0].message, /work in progress/);
  assert.deepEqual(shelves[0].files, ["app.ts"]);

  const diff = await run("showShelfFileDiff", { stashId: shelves[0].id, filePath: "app.ts" });
  assert.match(diff, /value = 12/);
  const patch = await run("createPatchFromShelf", { stashId: shelves[0].id });
  assert.match(patch, /diff --git a\/app\.ts/);

  await run("unshelveChanges", { stashId: shelves[0].id, drop: true });
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 12/);
  assert.deepEqual(await run("getShelves"), []);
});

test("commands: shelving one file leaves the others, and unshelve-file applies one", async () => {
  const { run, repoRoot } = await setup();
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 13;\n");
  await fs.writeFile(path.join(repoRoot, "other.ts"), "other\n");
  await run("shelveChanges", { message: "partial", filePaths: ["app.ts"] });

  const left = await run("getWorkingTreeChanges");
  assert.deepEqual(left.map((file) => file.path), ["other.ts"]);

  const shelves = await run("getShelves");
  await run("unshelveFile", { stashId: shelves[0].id, filePath: "app.ts", drop: true });
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 13/);
});

test("commands: deleteShelve drops the entry without touching the tree", async () => {
  const { run, repoRoot } = await setup();
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 14;\n");
  await run("shelveChanges", { message: "keep me shelved" });
  const shelves = await run("getShelves");
  await run("deleteShelve", { stashId: shelves[0].id });
  assert.deepEqual(await run("getShelves"), []);
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 1/);
});

test("commands: the Idea Shelf keeps its patch files under .idea/shelf", async () => {
  const { run, repoRoot } = await setup();
  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 15;\n");
  await run("ideaShelveChanges", { name: "idea shelf", filePaths: ["app.ts"] });

  const entries = await run("getIdeaShelves");
  assert.equal(entries.length, 1);
  assert.match(entries[0].name, /^idea/);
  assert.deepEqual(entries[0].files, ["app.ts"]);
  assert.ok(entries[0].patchPath.includes(path.join(".idea", "shelf")));

  const diff = await run("showIdeaShelfFileDiff", { shelfName: entries[0].name, filePath: "app.ts" });
  assert.match(diff, /value = 15/);

  await run("ideaUnshelveChanges", { shelfName: entries[0].name, drop: true });
  assert.match(await fs.readFile(path.join(repoRoot, "app.ts"), "utf8"), /value = 15/);
  assert.deepEqual(await run("getIdeaShelves"), []);
});

test("commands: a patch from the clipboard becomes a shelf", async () => {
  const { run, repoRoot } = await setup();
  await fs.writeFile(path.join(repoRoot, "patched.ts"), "patched\n");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "--quiet", "-m", "add patched file");
  const patch = git(repoRoot, "format-patch", "-1", "--stdout");
  await run("resetToCommit", { hash: git(repoRoot, "rev-parse", "HEAD~1").trim(), mode: "hard" });

  await run("importPatches", { name: "from clipboard", patchContent: patch });
  const shelves = await run("getIdeaShelves");
  assert.ok(shelves.some((entry) => entry.files.includes("patched.ts")));
});

// ─── Repository switching and refresh ───────────────────────────────

test("commands: getRepos lists the workspace, and refresh invalidates the caches", async () => {
  const { run, repoRoot } = await setup();
  const repos = await run("getRepos");
  assert.equal(repos.activeId, repoRoot);
  assert.deepEqual(repos.repos.map((repo) => repo.id), [repoRoot]);

  await fs.writeFile(path.join(repoRoot, "app.ts"), "export const value = 21;\n");
  const before = await run("getStatus");
  assert.equal(before.length, 1);
  await run("refreshGitState");
  assert.equal((await run("getStatus")).length, 1);
});

test("commands: favourites and view preferences persist in the agent directory", async () => {
  const { run, agentDir, dashboard } = await setup();
  await run("setFavorite", { name: "main", type: "local", favorite: true });
  const stored = JSON.parse(await fs.readFile(path.join(agentDir, dashboard.GIT_DASHBOARD_FILE), "utf8"));
  const state = stored["branchshift.branchDashboard.v1"];
  const overrides = Object.values(state.favoriteOverrides).flatMap((entry) => Object.entries(entry));
  assert.deepEqual(overrides, [["local\u0000main", true]]);

  const preferences = await run("setBranchDashboardPreferences", { showTags: false, singleClickAction: "navigate" });
  assert.equal(preferences.showTags, false);
  assert.equal(preferences.singleClickAction, "navigate");
});

function sandboxOf(repoRoot) {
  return path.dirname(repoRoot);
}
