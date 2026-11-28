import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Loaded through jiti so the module's own extensionless imports resolve the way
// the app resolves them (tsconfig moduleResolution: "bundler"); a bare
// `import("./git-diff-access.ts")` stops at its first extensionless import.
const { createJiti } = await import("jiti");
const { readDiffPathDenial } = await createJiti(import.meta.url).import("./git-diff-access.ts");

/**
 * Which file path a git diff request may read.
 *
 * The panel asks for a file's diff with the path **git printed**, and git prints
 * the checkout's path with symlinks resolved: `git rev-parse --show-toplevel`
 * answers the symlink-free path. The project the user picked is the path they
 * picked, and that is what the allowed roots record — through a link, when the
 * folder lives under one (a linked worktree under a linked parent, a home under
 * a link, `/tmp` on macOS, a case-differing volume). The two spellings name the
 * same file. A gate that only reads the spelling rejects the diff of a file the
 * panel has just listed and read, and a bare "Access denied" for a file in the
 * user's own working tree is what they see.
 *
 * So the answer is the resolved containment, and the rejection carries the
 * reason: the panel can then say which of the four situations it is in.
 */

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function scaffold() {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "diff-access-"));
  const repo = path.join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "probe@example.invalid");
  git(repo, "config", "user.name", "probe");
  writeFileSync(path.join(repo, "plain.txt"), "one\n");
  mkdirSync(path.join(repo, "sub"), { recursive: true });
  writeFileSync(path.join(repo, "sub", "inside.txt"), "x\n");
  writeFileSync(path.join(repo, "café.txt"), "unicode\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  writeFileSync(path.join(repo, "plain.txt"), "one\nchanged\n");
  writeFileSync(path.join(repo, "untracked.txt"), "new\n");
  rmSync(path.join(repo, "sub", "inside.txt"));

  // A linked worktree, reached through a link: what a branch of the same repo
  // looks like when the user opens it from the folder they picked.
  const wtBase = path.join(root, "worktrees");
  mkdirSync(wtBase, { recursive: true });
  git(repo, "worktree", "add", "-q", "-b", "feat", path.join(wtBase, "feat"), "main");
  const linkRoot = path.join(root, "link");
  symlinkSync(wtBase, linkRoot, "dir");
  const worktreeThroughLink = path.join(linkRoot, "feat");
  writeFileSync(path.join(wtBase, "feat", "feature.txt"), "work\n");

  // A directory inside the repository that leaves it.
  const outside = path.join(root, "outside");
  mkdirSync(outside, { recursive: true });
  writeFileSync(path.join(outside, "secret.txt"), "outside\n");
  symlinkSync(outside, path.join(repo, "escape"), "dir");

  return { root, repo, worktreeThroughLink, worktreeReal: path.join(wtBase, "feat"), outside, linkRoot };
}

const world = scaffold();
const cleanup = () => rmSync(world.root, { recursive: true, force: true });
test.after(cleanup);
const { repo, worktreeThroughLink, worktreeReal, outside, root } = world;
const roots = (dir) => new Set([dir]);

test("a changed file of the project answers, in the spelling the panel sent", () => {
  assert.equal(readDiffPathDenial(path.join(repo, "plain.txt"), roots(repo)), null);
});

test("a git worktree reached through a link answers for the path git printed", () => {
  // The root is the folder the user picked, recorded with the link in it.
  assert.equal(readDiffPathDenial(path.join(worktreeThroughLink, "feature.txt"), roots(worktreeThroughLink)), null);
  // git prints the checkout resolved, so the panel's diff request carries that
  // spelling while the root keeps the one the user picked. Same file.
  assert.equal(readDiffPathDenial(path.join(worktreeReal, "feature.txt"), roots(worktreeThroughLink)), null,
    "the resolved path of a file under a linked root is the user's own file, not an escape");
});

test("the deleted file of a commit answers, and so does a path under a deleted folder", () => {
  assert.equal(readDiffPathDenial(path.join(repo, "sub", "inside.txt"), roots(repo)), null);
  assert.equal(readDiffPathDenial(path.join(repo, "sub", "gone", "deep.txt"), roots(repo)), null);
});

test("a name git quotes (a non-ASCII file) answers", () => {
  assert.equal(readDiffPathDenial(path.join(repo, "café.txt"), roots(repo)), null);
});

test("a file reached through a link that leaves the project is refused, and says why", () => {
  assert.equal(readDiffPathDenial(path.join(repo, "escape", "secret.txt"), roots(repo)), "link-escapes-root");
  assert.equal(readDiffPathDenial(path.join(outside, "secret.txt"), roots(repo)), "outside-root");
});

test("a path outside every root is refused, and so is a '..' segment", () => {
  assert.equal(readDiffPathDenial("/etc/hosts", roots(repo)), "outside-root");
  // Joined, not concatenated: the `..` has to survive into the string, because
  // the rule is about the segment the request carries (Node's realpath collapses
  // it before it follows links, the filesystem applies it after).
  assert.equal(readDiffPathDenial(`${repo}/../outside/secret.txt`, roots(repo)), "parent-segment");
});

test("a path whose own name carries no parent segment but whose link dangles is refused, named", () => {
  const dangling = path.join(repo, "dangling-link");
  symlinkSync(path.join(root, "no-such-dir"), dangling, "dir");
  assert.equal(readDiffPathDenial(path.join(dangling, "file.txt"), roots(repo)), "unresolvable");
  rmSync(dangling, { recursive: true, force: true });
});

test("the worktree's root is not a way into the main repository beside it", () => {
  // The panel opened the worktree: the repository's other checkout is not the
  // project the user picked, and the worktree's path is not its parent.
  const wtRoot = path.join(root, "worktrees", "feat");
  assert.equal(readDiffPathDenial(path.join(repo, "plain.txt"), roots(wtRoot)), "outside-root");
});
