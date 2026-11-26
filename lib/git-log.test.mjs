import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  COMMIT_PAGE_SIZE,
  commitLogArgs,
  commitPageLimit,
  commitPageSkip,
  commitFilesArgs,
  commitRefPatterns,
  isSafeGitRef,
  isCommitSha,
  joinCommitFiles,
  numstatNewPath,
  parseCommitRecords,
  parseNameStatus,
  parseNumstat,
  readCommitDetail,
  readCommitPage,
  resolveCommitRef,
} = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./git-log.ts");

/** git's record format, as one commit arrives: wrapped in %x1e, fields in %x1f. */
const record = (fields) => `\x1e${fields.join("\x1f")}\x1e`;

test("a commit record is read whole, and a half record is not read at all", () => {
  const output = [
    record(["9c1f2ab34c5d6e7f8091a2b3c4d5e6f708192a3b", "9c1f2ab", "Fix: the panel’s `+` opens a shell", "Lynx", "2026-03-02T09:12:00+08:00", "1111111"]),
    record(["111111122222223333333444444455555556666666", "1111111", "First commit", "Lynx", "2026-03-01T08:00:00+08:00", ""]),
  ].join("");
  const commits = parseCommitRecords(output);
  assert.equal(commits.length, 2, "the separators between records are not commits");
  assert.deepEqual(commits[0], {
    sha: "9c1f2ab34c5d6e7f8091a2b3c4d5e6f708192a3b",
    shortSha: "9c1f2ab",
    subject: "Fix: the panel’s `+` opens a shell",
    authorName: "Lynx",
    dateMs: Date.parse("2026-03-02T09:12:00+08:00"),
    parentCount: 1,
  });
  assert.equal(commits[1].parentCount, 0, "the root commit has no parents");

  const broken = parseCommitRecords(`${output}\x1e${record(["only", "three", "fields"])}\x1e\x1e`);
  assert.equal(broken.length, 2, "a record missing a field is skipped: a row's sha is what its click opens");
  assert.deepEqual(parseCommitRecords(""), []);
});

test("a subject, author and date git printed in one locale all parse", () => {
  // LC_ALL=C is set on the run, and `%aI` is an ISO 8601 date, so the panel's
  // relative time is computed from a number, never from a locale's words.
  const [commit] = parseCommitRecords(record(["abc", "abc", "Fix: the panel's `+`\tab subject with a tab", "林 小龍", "2026-01-01T00:00:00Z", "p1 p2"]));
  assert.equal(commit.subject, "Fix: the panel's `+`	ab subject with a tab", "a tab is a character of a subject, not a field break");
  assert.equal(commit.authorName, "林 小龍");
  assert.equal(commit.dateMs, Date.parse("2026-01-01T00:00:00Z"));
  assert.equal(commit.parentCount, 2, "a merge is named by its parents");
  const [noDate] = parseCommitRecords(record(["abc", "abc", "s", "a", "not-a-date", ""]));
  assert.equal(noDate.dateMs, 0, "a date git did not answer with is 0, never NaN");
});

test("a ref git may be handed, and one that is an option in disguise", () => {
  for (const ref of ["main", "fix/flat-chat-blocks", "wt/2wt-branch-picker-header-worktrees", "v0.10.0", "origin/fix/x", "a.b_c-d/e"]) {
    assert.equal(isSafeGitRef(ref), true, ref);
  }
  for (const ref of [
    "", "   ", "--upload-pack=curl", "-x", ":file", "/abs", "a b", "a\tb", "a\nb",
    "HEAD~5", "HEAD^", "main..evil", "a//b", "a/", "a.lock", ".hidden", "fix/.hidden",
    "a?b", "a*b", "a[b]", "a\\b", "a@{u}", "x".repeat(201),
  ]) {
    assert.equal(isSafeGitRef(ref), false, JSON.stringify(ref));
  }
  assert.equal(isCommitSha("9c1f2ab"), true);
  assert.equal(isCommitSha("9c1f2ab34c5d6e7f8091a2b3c4d5e6f708192a3b"), true);
  assert.equal(isCommitSha("9c1f2"), false, "five characters is not a commit git will resolve");
  assert.equal(isCommitSha("main"), false);
  assert.equal(isCommitSha("refs/heads/main"), false);
});

test("the git calls are built from argv, with the ref behind --end-of-options", () => {
  const args = commitLogArgs("fix/x", 40, 0);
  assert.ok(args.includes("--end-of-options"), "the ref is a rev, never an option");
  assert.equal(args.indexOf("fix/x") > args.indexOf("--end-of-options"), true);
  assert.equal(args[args.length - 1], "--", "and nothing after it is a pathspec");
  assert.equal(args.filter((arg) => arg === "fix/x").length, 1, "the ref is named once, after the options");
  assert.equal(args[0], "log");
  assert.equal(args[1], "--format=\x1e%H\x1f%h\x1f%s\x1f%an\x1f%aI\x1f%p\x1e", "the record format: a subject with a tab stays one field");
  assert.equal(args[2], `--max-count=${COMMIT_PAGE_SIZE}`);

  // A page reads one commit more than it shows, so `hasMore` needs no second count
  // (readCommitPage asks for limit+1 and cuts the list back).
  assert.equal(commitLogArgs("main", COMMIT_PAGE_SIZE + 1, 0)[2], `--max-count=${COMMIT_PAGE_SIZE + 1}`);
  assert.equal(commitPageLimit(undefined), COMMIT_PAGE_SIZE);
  assert.equal(commitPageLimit(7), 7);
  assert.equal(commitPageLimit(100_000), 200, "the page is capped, whatever the caller asks for");
  assert.equal(commitPageLimit(-3), COMMIT_PAGE_SIZE);
  assert.equal(commitPageSkip(null), 0);
  assert.equal(commitPageSkip(40.9), 40);
  assert.equal(commitPageSkip(-1), 0);

  // A merge is diffed against its first parent: `git show` prints nothing for a merge.
  assert.deepEqual(commitFilesArgs("abc1234", 1).slice(0, 2), ["show", "--format="]);
  assert.deepEqual(commitFilesArgs("abc1234", 2).slice(0, 3), ["diff", "--find-renames", "--name-status"]);
  assert.deepEqual(commitFilesArgs("abc1234", 2).slice(-4), ["--end-of-options", "abc1234^1", "abc1234", "--"]);
});

test("a remote-only branch's row finds the remote's own ref", () => {
  // `partitionBranchList()` strips the remote prefix, so the row says `fix/x` and the
  // server has to find `origin/fix/x` itself.
  assert.deepEqual(commitRefPatterns("fix/x"), ["refs/heads/fix/x", "refs/remotes/fix/x", "refs/remotes/*/fix/x"]);
  assert.deepEqual(commitRefPatterns(" main "), ["refs/heads/main", "refs/remotes/main", "refs/remotes/*/main"]);
});

test("a rename's paths are read out of --name-status and --numstat", () => {
  assert.deepEqual(parseNameStatus("M\tlib/a.ts\nD\tsite/old.md\nR100\tsub2/c.txt\tother/d.txt\nC75\tone.ts\ttwo.ts\nT\tmode.txt\n"), [
    { path: "lib/a.ts", status: "modified", additions: null, deletions: null },
    { path: "site/old.md", status: "deleted", additions: null, deletions: null },
    { path: "other/d.txt", oldPath: "sub2/c.txt", status: "renamed", additions: null, deletions: null },
    { path: "two.ts", oldPath: "one.ts", status: "renamed", additions: null, deletions: null },
    { path: "mode.txt", status: "modified", additions: null, deletions: null },
  ]);
  assert.deepEqual(parseNameStatus("X\tweird\n\n").map((file) => file.path), [], "an unknown status letter names no file");

  assert.equal(numstatNewPath("lib/a.ts"), "lib/a.ts");
  assert.equal(numstatNewPath("sub2/c.txt => other/d.txt"), "other/d.txt");
  assert.equal(numstatNewPath("deep/inner/{same.txt => renamed.txt}"), "deep/inner/renamed.txt");
  assert.equal(numstatNewPath("{lib => lib2}/a.ts"), "lib2/a.ts");
  assert.equal(numstatNewPath("{ => sub}/a.ts"), "sub/a.ts", "a move into a new subfolder keeps the file");

  const counts = parseNumstat("12\t3\tlib/a.ts\n-\t-\tbin/blob\n0\t0\tdeep/inner/{same.txt => renamed.txt}\n");
  assert.deepEqual(counts.get("lib/a.ts"), { additions: 12, deletions: 3 });
  assert.deepEqual(counts.get("bin/blob"), { additions: null, deletions: null }, "a binary file's counts are git's dash, not 0");
  assert.deepEqual(counts.get("deep/inner/renamed.txt"), { additions: 0, deletions: 0 });

  const files = joinCommitFiles("M\tlib/a.ts\nR100\tsub2/c.txt\tother/d.txt\nA\tdeep/inner/same.txt\n", "12\t3\tlib/a.ts\n1\t0\tother/d.txt\n4\t0\tdeep/inner/{same.txt => renamed.txt}\n");
  assert.deepEqual(files, [
    { path: "lib/a.ts", status: "modified", additions: 12, deletions: 3 },
    { path: "other/d.txt", oldPath: "sub2/c.txt", status: "renamed", additions: 1, deletions: 0 },
    { path: "deep/inner/same.txt", status: "added", additions: null, deletions: null },
  ], "a file with no count row is listed without counts, never dropped");
});

// The reads, against a real repository: the formats above are git's, and the only
// honest check is git answering them.
const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-log-"));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function fixtureRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(base, "repo-")));
  git(root, "init", "--initial-branch=main", "--quiet");
  git(root, "config", "user.email", "lynx@example.com");
  git(root, "config", "user.name", "Lynx");
  fs.mkdirSync(path.join(root, "deep/inner"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib.txt"), "one\ntwo\n");
  fs.writeFileSync(path.join(root, "deep/inner/same.txt"), "keep\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "First: two files");
  fs.writeFileSync(path.join(root, "lib.txt"), "one\ntwo\nthree\n");
  git(root, "add", "-A");
  git(root, "mv", "deep/inner/same.txt", "deep/inner/renamed.txt");
  git(root, "commit", "-qm", "Second: change and rename");
  git(root, "checkout", "-qb", "feat/history");
  return root;
}

test("a branch's commits come back newest first, with the sha a row's click needs", async () => {
  const root = fixtureRepo();
  const page = await readCommitPage(root, "feat/history", { limit: 10 });
  assert.equal(page.resolvedRef, "feat/history");
  assert.deepEqual(page.commits.map((commit) => commit.subject), ["Second: change and rename", "First: two files"]);
  assert.equal(page.hasMore, false, "a ref with fewer commits than the page says so");
  assert.equal(page.commits[0].shortSha.length, 7);
  assert.equal(page.commits[0].authorName, "Lynx");
  assert.ok(page.commits[0].dateMs > 0);

  const second = await readCommitPage(root, "feat/history", { limit: 1, skip: 0 });
  assert.deepEqual(second.commits.map((commit) => commit.subject), ["Second: change and rename"]);
  assert.equal(second.hasMore, true, "the page reads one commit past what it shows");
  const tail = await readCommitPage(root, "feat/history", { limit: 1, skip: 1 });
  assert.deepEqual(tail.commits.map((commit) => commit.subject), ["First: two files"]);

  assert.deepEqual((await readCommitPage(root, "feat/nope", {})).commits, [], "a branch that is not there is an empty list, not a thrown git error");
  assert.equal((await readCommitPage(root, "HEAD~5", {})).resolvedRef, null, "a revision expression never reaches git");
});

test("the remote's branch is read for a remote-only row, in one for-each-ref", async () => {
  const root = fixtureRepo();
  const remote = fs.realpathSync(fs.mkdtempSync(path.join(base, "remote-")));
  git(remote, "init", "--bare", "--quiet");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "origin", "feat/history");
  git(root, "checkout", "-q", "main");
  git(root, "branch", "-D", "feat/history");
  // The row is the stripped name: `partitionBranchList()` gives the list no remote.
  const page = await readCommitPage(root, "feat/history", { limit: 10 });
  assert.equal(page.resolvedRef, "origin/feat/history");
  assert.deepEqual(page.commits.map((commit) => commit.subject), ["Second: change and rename", "First: two files"]);
});

test("a commit's files, counts and patch come back together, and a merge is read against its first parent", async () => {
  const root = fixtureRepo();
  const sha = git(root, "rev-parse", "HEAD").trim();
  const detail = await readCommitDetail(root, sha);
  assert.equal(detail.supported, true);
  assert.equal(detail.commit?.subject, "Second: change and rename");
  assert.deepEqual(detail.files.map((file) => [file.path, file.status]).sort(), [
    ["deep/inner/renamed.txt", "renamed"],
    ["lib.txt", "modified"],
  ].sort(), "a rename and a modification, in git's own order");
  const byPath = new Map(detail.files.map((file) => [file.path, file]));
  assert.equal(byPath.get("lib.txt").additions, 1, "the counts come from --numstat, joined by path");
  assert.equal(byPath.get("lib.txt").deletions, 0);
  assert.equal(byPath.get("deep/inner/renamed.txt").oldPath, "deep/inner/same.txt", "a rename names both paths");
  assert.ok(detail.patch.startsWith("diff --git"));
  assert.ok(detail.patchBytes > 0);
  const { patchForFile } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./patch.ts");
  assert.ok(patchForFile(detail.patch, "deep/inner/renamed.txt").includes("rename from deep/inner/same.txt"), "the panel cuts one file's section out of the commit's patch with the app's own patch reader");

  // A merge: `git show` prints no patch at all, so the diff is against the first parent.
  git(root, "checkout", "-qb", "merge-target", "HEAD~1");
  fs.writeFileSync(path.join(root, "other.txt"), "side\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "Side change");
  git(root, "checkout", "-q", "feat/history");
  git(root, "merge", "--no-ff", "-qm", "Merge the side branch", "merge-target");
  const mergeSha = git(root, "rev-parse", "HEAD").trim();
  const merge = await readCommitDetail(root, mergeSha);
  assert.equal(merge.commit?.parentCount, 2);
  assert.equal(merge.supported, true, "a merge is not an empty commit");
  assert.deepEqual(merge.files.map((file) => file.path), ["other.txt"]);

  assert.equal((await readCommitDetail(root, "dead000000000000000000000000000000000000")).reason, "unknown-commit");
  assert.equal((await readCommitDetail(root, "not-a-sha")).reason, "unknown-commit");
});

test("the ref a branch row means is resolved once, and a folder git does not know is answered, not thrown", async () => {
  const root = fixtureRepo();
  assert.equal(await resolveCommitRef(root, "main"), "main");
  assert.equal(await resolveCommitRef(root, "feat/nope"), null);
  assert.equal(await resolveCommitRef(root, "--upload-pack=curl"), null, "a ref in an option's clothes never reaches git");
  const plain = fs.realpathSync(fs.mkdtempSync(path.join(base, "plain-")));
  const { findRepositoryRoot } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./git-log.ts");
  assert.equal(await findRepositoryRoot(plain), null, "a plain folder is no repository");
});
