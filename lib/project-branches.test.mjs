import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * The branch of a project folder, answered once, cached briefly, and never used
 * to confirm that a path exists.
 *
 * The project lists name folders; the branch is what distinguishes the folders
 * of a worktree setup. The lists ask for the paths they render, so this module is
 * on the open path of a dropdown: it must deduplicate, must not outlive a branch
 * switch by more than a few seconds, and must answer a folder it may not read
 * exactly like a folder that is not a repository.
 */

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-project-branches-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRootsCache = globalThis.__piAllowedRootsCache;
const previousAdditionalRoots = globalThis.__piAdditionalAllowedRoots;
delete globalThis.__piAllowedRootsCache;
delete globalThis.__piAdditionalAllowedRoots;
// An agent dir of its own: the allowed roots come from the session catalogue, and
// a test that inherited the real one would inherit the machine's real projects.
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false,
});
const { readProjectBranch, readProjectBranches, invalidateProjectBranch, PROJECT_BRANCH_MAX_PATHS } =
  await jiti.import("./project-branches.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRootsCache;
  globalThis.__piAdditionalAllowedRoots = previousAdditionalRoots;
  fs.rmSync(base, { recursive: true, force: true });
});

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
}

function checkout(name = "main") {
  const root = fs.mkdtempSync(path.join(base, "repo-"));
  git(root, "init", "--quiet", "--initial-branch", name);
  git(root, "config", "user.email", "probe@example.com");
  git(root, "config", "user.name", "Probe");
  fs.writeFileSync(path.join(root, "tracked.txt"), "one\n");
  git(root, "add", "tracked.txt");
  git(root, "commit", "--quiet", "-m", "first");
  allowFileRoot(root);
  return root;
}

test("a checkout answers with the branch it is on", async () => {
  const root = checkout("feature/x");
  assert.deepEqual(await readProjectBranch(root), { cwd: root, branch: "feature/x", isWorktree: false, isRepo: true });
});

test("a linked worktree says it is one, with its own branch", async () => {
  const root = checkout("main");
  const linkParent = fs.mkdtempSync(path.join(base, "worktrees-"));
  const linked = path.join(linkParent, "wt-one");
  allowFileRoot(linkParent);
  git(root, "worktree", "add", "--quiet", "-b", "wt/one", linked, "HEAD");
  const answer = await readProjectBranch(linked);
  assert.equal(answer.branch, "wt/one", "a worktree answers with its own HEAD, not the main checkout's");
  assert.equal(answer.isWorktree, true, "the row that offers a worktree says so");
  assert.equal(answer.isRepo, true);
});

test("a detached checkout answers with no branch, and a plain folder with nothing", async () => {
  const root = checkout("main");
  git(root, "checkout", "--quiet", "--detach", "HEAD");
  assert.deepEqual(await readProjectBranch(root), { cwd: root, branch: null, isRepo: true, isWorktree: false },
    "a detached HEAD is not a branch called HEAD");

  const plain = fs.mkdtempSync(path.join(base, "plain-"));
  allowFileRoot(plain);
  assert.deepEqual(await readProjectBranch(plain), { cwd: plain, branch: null, isRepo: false, isWorktree: false });
});

test("a folder the app may not read is answered exactly like a folder that is not a repository", async () => {
  const sibling = fs.mkdtempSync(path.join(base, "sibling-"));
  const outside = fs.mkdtempSync(path.join(sibling, "denied-"));
  // A real repository, outside every allowed root.
  git(outside, "init", "--quiet", "--initial-branch", "secret-branch");
  const answer = await readProjectBranch(outside);
  assert.deepEqual(answer, { cwd: outside, branch: null, isRepo: false, isWorktree: false },
    "the answer carries no branch and no name, so it cannot confirm that the folder exists");
});

test("the answer is cached briefly, and a branch switch is visible as soon as it is invalidated", async () => {
  const root = checkout("main");
  const first = await readProjectBranch(root);
  const second = await readProjectBranch(root);
  assert.equal(first, second, "one probe per cache window, so opening a dropdown twice spawns git once");

  git(root, "checkout", "--quiet", "-b", "next");
  const cached = await readProjectBranch(root);
  assert.equal(cached.branch, "main", "the window is real: a fresh answer is not re-probed on every keystroke");
  invalidateProjectBranch(root);
  const fresh = await readProjectBranch(root);
  assert.equal(fresh.branch, "next", "and it ends when the app says the branch moved");
});

test("concurrent reads of one project are one probe", async () => {
  const root = checkout("concurrent");
  const [a, b, c] = await Promise.all([readProjectBranch(root), readProjectBranch(root), readProjectBranch(root)]);
  assert.equal(a, b);
  assert.equal(b, c);
});

test("a batch deduplicates, keeps the order it was given, and answers each path once", async () => {
  const first = checkout("branch-one");
  const second = checkout("branch-two");
  const answers = await readProjectBranches([first, second, first, "relative/not/allowed", "", first]);
  assert.deepEqual(answers.map((entry) => entry.cwd), [first, second],
    "duplicates and a relative path are dropped, not answered with a fabricated entry");
  assert.deepEqual(answers.map((entry) => entry.branch), ["branch-one", "branch-two"]);
});

test("a batch is capped, so one request cannot ask for the whole disk", async () => {
  const root = checkout("cap");
  const many = Array.from({ length: PROJECT_BRANCH_MAX_PATHS + 40 }, (_, i) => path.join(root, `p${i}`));
  const answers = await readProjectBranches(many);
  assert.equal(answers.length, PROJECT_BRANCH_MAX_PATHS);
});
