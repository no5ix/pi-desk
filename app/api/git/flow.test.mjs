// The Git panel's work, end to end, on a real repository.
//
// These run the command table (`lib/git/commands.ts`) against temporary git
// checkouts — the same entry point the HTTP route uses, minus the transport.
// The point is the sequence a user performs: stage, commit, push, shelve, merge
// a conflict, blame. Branchshift's own suites cover the git services in detail;
// this covers that the table wires them to one repository, that paths and refs
// are the panel's (repo-relative, validated), and that the git environment we
// set makes the interactive parts finish on their own.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-flow-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRoots = globalThis.__piAllowedRootsCache;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRoots;
});
process.on("exit", () => fs.rmSync(base, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { runGitCommand, listGitCommands } = await jiti.import("../../../lib/git/commands.ts");

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Panel Test",
  GIT_AUTHOR_EMAIL: "panel@test.invalid",
  GIT_COMMITTER_NAME: "Panel Test",
  GIT_COMMITTER_EMAIL: "panel@test.invalid",
};

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();
}

/**
 * A checkout with a remote, one commit, and a file the tests can edit. The
 * parent folder is the authorized root, as a project folder is in the app.
 */
function repository(name) {
  fs.mkdirSync(base, { recursive: true });
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(base, `${name}-`)));
  const remote = path.join(directory, "origin.git");
  const repo = path.join(directory, "checkout");
  execFileSync("git", ["init", "--bare", "--initial-branch=main", remote], { env: gitEnv, stdio: "pipe" });
  execFileSync("git", ["init", "--initial-branch=main", repo], { env: gitEnv, stdio: "pipe" });
  git(repo, "config", "user.name", "Panel Test");
  git(repo, "config", "user.email", "panel@test.invalid");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nlast line\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "initial commit");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-u", "origin", "main");
  globalThis.__piAllowedRootsCache = { roots: new Set([directory]), expiresAt: Date.now() + 600_000 };
  return { directory, repo, remote };
}

const run = (cwd, command, params, repoId) => runGitCommand({ cwd, command, params, repoId });

/** The repository's own current branch, read the way the panel's sidebar does. */
async function currentBranch(cwd, repoId) {
  const branches = await run(cwd, "getBranches", {}, repoId);
  return branches.filter((branch) => branch.isCurrent).map((branch) => branch.name);
}

await test("the command table is a closed set, and every entry is reachable by name", () => {
  const names = listGitCommands();
  assert.ok(names.length > 60, `${names.length} commands`);
  for (const name of ["getStatus", "stageFile", "commitChanges", "shelveChanges", "mergeBranch", "getGitBlame"]) {
    assert.ok(names.includes(name), `${name} is listed`);
  }
  assert.ok(names.every((name) => /^[a-z][A-Za-z]*$/.test(name)), "the table is command names, not argv");
});

await test("an unauthorized folder is refused before git runs", async () => {
  const { repo } = repository("untrusted");
  globalThis.__piAllowedRootsCache = { roots: new Set([path.join(base, "somewhere-else")]), expiresAt: Date.now() + 60_000 };
  await assert.rejects(() => run(repo, "getStatus", {}), /not a Git repository|not an allowed project folder/i);
});

await test("an unknown command, a ref that is not a name and a path outside the checkout are refused", async () => {
  const { repo } = repository("refusal");
  await assert.rejects(() => run(repo, "rm_rf", {}), /Unknown Git command/);
  await assert.rejects(() => run(repo, "checkoutBranch", { branch: "main; rm -rf /" }), /ref name/i);
  await assert.rejects(() => run(repo, "checkoutBranch", { branch: "../elsewhere" }), /ref name/i);
  await assert.rejects(() => run(repo, "unshelveChanges", { stashId: "anything" }), /stash reference/i);
  await assert.rejects(() => run(repo, "stageFile", { filePath: "/etc/passwd" }), /outside the repository/i);
  await assert.rejects(() => run(repo, "stageFile", { filePath: "../outside.txt" }), /outside the repository/i);
  await assert.rejects(() => run(repo, "stageFile", { filePath: ".git/COMMIT_EDITMSG" }), /outside the repository/i);
  // The refusals left the repository untouched.
  assert.equal(git(repo, "status", "--porcelain"), "");
  assert.equal(git(repo, "rev-parse", "--abbrev-ref", "HEAD"), "main");
});

await test("stage, commit and push: the panel's normal first sequence", async () => {
  const { repo, remote } = repository("commit");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nchanged line\n");
  fs.writeFileSync(path.join(repo, "new.txt"), "created\n");

  const changes = await run(repo, "getWorkingTreeChanges", {});
  assert.deepEqual(
    changes.map((entry) => `${entry.path}:${entry.status}:${entry.staged ? "staged" : "unstaged"}`).sort(),
    ["new.txt:untracked:unstaged", "notes.md:modified:unstaged"],
    "the panel lists the edit and the new file",
  );

  await run(repo, "stageFile", { filePath: "notes.md" });
  const status = await run(repo, "getStatus", {});
  assert.deepEqual(
    status.map((entry) => `${entry.path} ${entry.indexStatus}${entry.workTreeStatus}`).sort(),
    ["new.txt ??", "notes.md M "],
    "notes.md is staged, new.txt is not",
  );

  // The commit is the panel's selection, not "everything in the tree": the
  // staged file is listed, the untracked one is not, and the second commit
  // proves the untracked file stayed out.
  await assert.rejects(
    () => run(repo, "commitChanges", { message: "nothing selected" }),
    /At least one change must be selected/i,
    "an empty selection is refused rather than committing the whole index",
  );
  await run(repo, "commitChanges", {
    message: "edit the notes",
    selections: [{ path: "notes.md", staged: true, status: "modified" }],
  });
  const log = await run(repo, "getLog", { maxCount: 10 });
  assert.deepEqual(log.map((commit) => commit.subject), ["edit the notes", "initial commit"]);
  const afterCommit = await run(repo, "getWorkingTreeChanges", {});
  assert.deepEqual(afterCommit.map((entry) => entry.path), ["new.txt"], "the file that was not selected is still pending");

  await run(repo, "executePush", { branch: "main" });
  assert.match(git(remote, "log", "--oneline"), /edit the notes/);
  assert.equal(git(repo, "rev-list", "--count", "main..origin/main"), "0", "the push is real: nothing is ahead of the remote");
});

await test("shelve takes the changes away and unshelve brings them back", async () => {
  const { repo } = repository("shelf");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nshelved line\n");
  await run(repo, "shelveChanges", { message: "work in progress" });
  assert.equal(git(repo, "status", "--porcelain"), "", "the working tree is clean while the work is shelved");
  const onDisk = fs.readFileSync(path.join(repo, "notes.md"), "utf8");
  assert.match(onDisk, /first line/);
  assert.doesNotMatch(onDisk, /shelved line/, "the edit is off the disk");

  const shelves = await run(repo, "getShelves", {});
  assert.equal(shelves.length, 1);
  assert.match(shelves[0].message, /work in progress/);

  await run(repo, "unshelveChanges", { stashId: shelves[0].id, drop: true });
  assert.match(fs.readFileSync(path.join(repo, "notes.md"), "utf8"), /shelved line/, "the change is back");
  assert.equal((await run(repo, "getShelves", {})).length, 0, "and the shelf is gone");
});

await test("a merge conflict is listed, resolved by side, and continued", async () => {
  const { repo } = repository("conflict");
  git(repo, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nthe feature's line\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "feature takes the line");
  git(repo, "checkout", "main");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nmain's line\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "main takes the line");

  // The same line moved both ways, so git stops: the command reports it, and the
  // panel reads the state it left behind.
  await assert.rejects(() => run(repo, "mergeBranch", { branch: "feature" }));
  assert.equal((await run(repo, "getMergeState", {})).isMerging, true, "the panel says a merge is running");
  const conflicts = await run(repo, "getConflictFiles", {});
  assert.deepEqual(conflicts, ["notes.md"], "the conflict list names the file the panel must resolve");

  // The three sides the panel offers for that file.
  const versions = await run(repo, "getFileVersions", { filePath: "notes.md" });
  for (const side of ["base", "ours", "theirs"]) {
    assert.ok(typeof versions[side] === "string" && versions[side].length > 0, `${side} comes back as text`);
  }
  assert.match(versions.ours, /main's line/);
  assert.match(versions.theirs, /the feature's line/);

  // Take the incoming side, then continue. Git must not open an editor.
  await run(repo, "acceptTheirs", { filePath: "notes.md" });
  await run(repo, "mergeAction", { action: "continue" });
  assert.equal((await run(repo, "getMergeState", {})).isMerging, false, "the merge finished");
  assert.match(fs.readFileSync(path.join(repo, "notes.md"), "utf8"), /the feature's line/);
  const log = await run(repo, "getLog", { maxCount: 10 });
  assert.ok(log.some((commit) => /Merge branch 'feature'/.test(commit.subject)), "--no-edit gave the merge commit its default message");
});

await test("accepting the current side keeps the current line", async () => {
  const { repo } = repository("ours");
  git(repo, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nfeature\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "feature");
  git(repo, "checkout", "main");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nmain\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "main");

  await assert.rejects(() => run(repo, "mergeBranch", { branch: "feature" }));
  await run(repo, "acceptOurs", { filePath: "notes.md" });
  await run(repo, "mergeAction", { action: "continue" });
  const text = fs.readFileSync(path.join(repo, "notes.md"), "utf8");
  assert.match(text, /main's line|main/);
  assert.doesNotMatch(text, /feature/);
});

await test("aborting a merge leaves the branch where it was", async () => {
  const { repo } = repository("abort");
  git(repo, "checkout", "-b", "feature");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nfeature\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "feature");
  git(repo, "checkout", "main");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nmain\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "main");
  const headBefore = git(repo, "rev-parse", "HEAD");

  await assert.rejects(() => run(repo, "mergeBranch", { branch: "feature" }));
  await run(repo, "mergeAction", { action: "abort" });
  assert.equal((await run(repo, "getMergeState", {})).isMerging, false);
  assert.equal(git(repo, "rev-parse", "HEAD"), headBefore, "HEAD did not move");
  assert.match(fs.readFileSync(path.join(repo, "notes.md"), "utf8"), /main/);
  assert.equal(git(repo, "status", "--porcelain"), "", "no conflict markers left behind");
});

await test("the log, the graph, the file history, a commit's files and blame describe the same commits", async () => {
  const { repo } = repository("read");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nsecond commit line\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "second commit");

  const graph = await run(repo, "getGraphData", {});
  const commits = graph.graphData.commits;
  assert.equal(commits.length, 2);
  assert.equal(commits[0].subject, "second commit");
  assert.ok(commits[0].hash.length >= 40, "the graph rows carry the full hash the panel asks for");

  const files = await run(repo, "getCommitFiles", { hash: commits[0].hash });
  assert.deepEqual(files.map((entry) => [entry.newPath, entry.status]), [["notes.md", "modified"]], "the commit names the file it changed");

  const history = await run(repo, "getFileHistory", { filePath: "notes.md" });
  assert.deepEqual(history.map((commit) => commit.subject), ["second commit", "initial commit"]);

  const blame = await run(repo, "getGitBlame", { filePath: "notes.md" });
  assert.equal(blame.lineCount, 4, "blame counts the file's lines");
  assert.ok(blame.hunks.length >= 1, "blame comes back as hunks, each with its lines");
  assert.deepEqual(blame.hunks.flatMap((hunk) => hunk.lines.map((line) => line.lineNumber)), [1, 2, 3, 4], "every line of the file is attributed");
  const fourth = blame.hunks.find((hunk) => hunk.lines.some((line) => line.lineNumber === 4));
  assert.equal(fourth.lines.find((line) => line.lineNumber === 4).content, "second commit line");
  assert.equal(fourth.summary, "second commit", "and the line's commit is the one that wrote it");
  assert.equal(blame.file, "notes.md");
});

await test("a linked worktree is its own repository, and the panel switches to it", async () => {
  const { directory, repo } = repository("worktree");
  const linked = path.join(directory, "linked-worktree");
  git(repo, "worktree", "add", "-b", "side", linked);

  const { repos } = await run(repo, "getRepos", {});
  const byPath = new Map(repos.map((entry) => [entry.rootPath, entry]));
  assert.ok(byPath.has(repo), "the checkout is listed");
  assert.ok(byPath.has(linked), "its linked worktree is listed as its own repository");
  assert.equal(byPath.get(linked).isWorktree, true, "and it is marked as one");

  // The worktree has its own HEAD: the panel reading it sees `side`, not `main`.
  assert.deepEqual(await currentBranch(linked), ["side"]);
  assert.deepEqual(await currentBranch(repo), ["main"]);

  // A repoId discovery returned is honoured; the branch it selects is that
  // repository's own.
  assert.deepEqual(await currentBranch(repo, byPath.get(linked).id), ["side"], "the panel reading that repository sees its branch");
});

await test("the remote branches are answered per remote, the shape the panel maps", async () => {
  // `repository()` wires `origin` and pushes `main`; a second name with a slash
  // is pushed straight to the bare remote, so the answer has both shapes.
  const { repo } = repository("remotes");
  git(repo, "push", "origin", "HEAD:refs/heads/feat/remote-only");

  const groups = await run(repo, "getRemoteBranches", {});
  assert.ok(Array.isArray(groups), "an array of groups");
  assert.ok(groups.length >= 1, "the remote that was just pushed to is listed");
  for (const group of groups) {
    assert.equal(typeof group.remote, "string", "a group names its remote");
    assert.ok(Array.isArray(group.branches), "and lists branch names under it");
    assert.ok(group.branches.every((branch) => typeof branch === "string"));
    assert.equal(group.name, undefined, "the group has no name: a client that reads one gets undefined, and the branch tree splits it");
  }
  const origin = groups.find((group) => group.remote === "origin");
  assert.ok(origin.branches.includes("main"), "the pushed branch is there");
  assert.ok(origin.branches.includes("feat/remote-only"), "and a name with a slash is one entry, not two");
});

await test("picking a branch is git log <branch>: its commits only, and its tip first", async () => {
  // The panel's branch row names the branch the way git takes it — `bak/4pi-desk-main`,
  // a name with a slash in it. Deriving the filter's identity from a `refs/…` prefix
  // alone threw `Invalid Git branch ref: bak/4pi-desk-main`, and the panel answered
  // "No commit matches this filter." for a branch with hundreds of commits.
  const { repo } = repository("branch-filter");
  git(repo, "checkout", "-b", "bak/4pi-desk-main");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nbak line\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fix: a division on the panel");
  const tip = git(repo, "rev-parse", "bak/4pi-desk-main");
  const reachable = new Set(git(repo, "rev-list", "bak/4pi-desk-main").split("\n"));

  const picked = await run(repo, "getGraphData", {
    maxCount: 200,
    currentRef: { type: "local", name: "bak/4pi-desk-main", fullRef: "refs/heads/bak/4pi-desk-main" },
    branch: "bak/4pi-desk-main",
  });
  assert.equal(picked.status, "ok", "the branch answers, and does not throw");
  const rows = picked.graphData.commits;
  assert.ok(rows.length >= 2, `the branch's commits are listed (${rows.length})`);
  assert.equal(rows[0].hash, tip, "the newest commit of that branch is the first row");
  for (const row of rows) {
    assert.ok(reachable.has(row.hash), `the row ${row.shortHash} is on that branch`);
  }

  // And the filter is not the whole repository: a commit made on `main` after the
  // branch left it is not in the list.
  git(repo, "checkout", "main");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nlast line\nmain line\n");
  git(repo, "add", ".");
  const mainCommit = git(repo, "rev-parse", "HEAD");
  const mainOnly = new Set(git(repo, "rev-list", "main").split("\n"));
  const ofMain = await run(repo, "getGraphData", {
    maxCount: 200,
    currentRef: { type: "local", name: "main", fullRef: "refs/heads/main" },
    branch: "main",
  });
  assert.ok(ofMain.graphData.commits.length >= 1, "main answers its own list");
  assert.ok(ofMain.graphData.commits.every((row) => mainOnly.has(row.hash)), "every row is on main");
  assert.ok(!ofMain.graphData.commits.some((row) => row.hash === tip), "and the other branch's commit is not there");
  assert.equal(ofMain.graphData.commits[0].hash, mainCommit, "with main's own tip on top");
});

await test("the search box finds a message, whatever the case, and a hex word finds a hash", async () => {
  const { repo } = repository("log-search");
  fs.writeFileSync(path.join(repo, "notes.md"), "# Notes\n\nfirst line\nMemory line\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "fix: keep the Memory sampler inside the session budget");
  const tip = git(repo, "rev-parse", "HEAD");

  const byWord = await run(repo, "getGraphData", { maxCount: 200, search: "memory" });
  assert.ok(byWord.graphData.commits.length >= 1, "the word finds the commit");
  assert.ok(
    byWord.graphData.commits.every((row) => /memory/i.test(`${row.subject} ${row.body}`)),
    "and only that commit's rows",
  );

  // A search box is not a shell: the same word in another case is the same search.
  const byCase = await run(repo, "getGraphData", { maxCount: 200, search: "MEMORY" });
  assert.deepEqual(
    byCase.graphData.commits.map((row) => row.hash),
    byWord.graphData.commits.map((row) => row.hash),
    "upper case finds what lower case found",
  );

  // The hash the reader just read in the row is a search word too. git's --grep
  // matches the message, so this is the panel's own reading of the page.
  const byHash = await run(repo, "getGraphData", { maxCount: 200, search: tip.slice(0, 8) });
  assert.ok(
    byHash.graphData.commits.some((row) => row.hash === tip),
    `the short hash finds its commit (${byHash.graphData.commits.map((row) => row.shortHash).join(",")})`,
  );
  const byFullHash = await run(repo, "getGraphData", { maxCount: 200, search: tip });
  assert.deepEqual(byFullHash.graphData.commits.map((row) => row.hash), [tip], "the full hash finds it alone");
});
