// Ported from Branchshift's src/test/git/gitBlame.test.ts: the suites that already
// cover this backend. mocha's global describe/it become node:test imports.
import { describe, it } from "node:test";
import * as assert from "node:assert";
import * as path from "node:path";
import { type BlameResult, parseGitBlame } from "../../git/blame";
import { GitService } from "../../git/git-service";
import type { RepositoryPaths } from "../../git/repo-registry";
import { GitTestRepo } from "./git-test-repo";

const HASH_A = "4afb24f3646f92b34293a67933d9c5e8bfc3a810";
const HASH_B = "7566f527ac15d3d13202e3ceaae32cec4d81ef50";

function porcelainBlock({
  hash,
  origLine,
  finalLine,
  numLines,
  author = "Alice",
  email = "<a@b.c>",
  time = "1700000000",
  summary = "commit message",
  boundary = false,
  content,
}: {
  hash: string;
  origLine: number;
  finalLine: number;
  numLines?: number;
  author?: string;
  email?: string;
  time?: string;
  summary?: string;
  boundary?: boolean;
  content: string;
}): string {
  const header = `${hash} ${origLine} ${finalLine}${numLines ? ` ${numLines}` : ""}`;
  const lines = [
    header,
    `author ${author}`,
    `author-mail ${email}`,
    `author-time ${time}`,
    "author-tz +0700",
    `committer ${author}`,
    `committer-mail ${email}`,
    `committer-time ${time}`,
    "committer-tz +0700",
    `summary ${summary}`,
  ];
  if (boundary) lines.push("boundary");
  lines.push("filename test.txt");
  lines.push(`\t${content}`);
  return lines.join("\n");
}

describe("parseGitBlame", () => {
  it("parses blocks and merges consecutive lines from one commit into a hunk", () => {
    const output = [
      porcelainBlock({
        hash: HASH_A,
        origLine: 1,
        finalLine: 1,
        content: "line one",
        boundary: true,
      }),
      porcelainBlock({
        hash: HASH_A,
        origLine: 2,
        finalLine: 2,
        content: "line two",
        boundary: true,
      }),
      porcelainBlock({
        hash: HASH_B,
        origLine: 3,
        finalLine: 3,
        content: "line three",
        author: "Bob",
        email: "<x@y.z>",
        time: "1700000500",
        summary: "second",
      }),
      porcelainBlock({
        hash: HASH_B,
        origLine: 4,
        finalLine: 4,
        content: "line four",
        author: "Bob",
        email: "<x@y.z>",
        time: "1700000500",
        summary: "second",
      }),
    ].join("\n");

    const result = parseGitBlame(output, "test.txt");

    assert.strictEqual(result.file, "test.txt");
    assert.strictEqual(result.lineCount, 4);
    assert.strictEqual(result.hunks.length, 2);

    const [hunkA, hunkB] = result.hunks;
    assert.deepStrictEqual(
      hunkA.lines.map((l) => l.lineNumber),
      [1, 2],
    );
    assert.deepStrictEqual(
      hunkA.lines.map((l) => l.content),
      ["line one", "line two"],
    );
    assert.strictEqual(hunkA.commitHash, HASH_A);
    assert.strictEqual(hunkA.author, "Alice");
    assert.strictEqual(hunkA.authorEmail, "a@b.c");
    assert.strictEqual(hunkA.authorTime, 1700000000);
    assert.strictEqual(hunkA.summary, "commit message");
    assert.strictEqual(hunkA.boundary, true);

    assert.deepStrictEqual(
      hunkB.lines.map((l) => l.lineNumber),
      [3, 4],
    );
    assert.strictEqual(hunkB.commitHash, HASH_B);
    assert.strictEqual(hunkB.author, "Bob");
    assert.strictEqual(hunkB.boundary, false);
  });

  it("splits hunks when the same commit is interrupted by another commit", () => {
    const output = [
      porcelainBlock({
        hash: HASH_A,
        origLine: 1,
        finalLine: 1,
        content: "a1",
      }),
      porcelainBlock({
        hash: HASH_B,
        origLine: 2,
        finalLine: 2,
        content: "b2",
        summary: "second",
      }),
      porcelainBlock({
        hash: HASH_A,
        origLine: 3,
        finalLine: 3,
        content: "a3",
      }),
    ].join("\n");

    const result = parseGitBlame(output, "test.txt");

    assert.strictEqual(result.hunks.length, 3);
    assert.strictEqual(result.hunks[0].lines.length, 1);
    assert.strictEqual(result.hunks[1].lines.length, 1);
    assert.strictEqual(result.hunks[2].lines.length, 1);
  });

  it("keeps empty-line content and strips a single leading tab", () => {
    const output = porcelainBlock({
      hash: HASH_A,
      origLine: 1,
      finalLine: 1,
      content: "",
    });

    const result = parseGitBlame(output, "test.txt");

    assert.strictEqual(result.hunks[0].lines[0].content, "");
  });

  it("returns an empty result for empty blame output (empty file)", () => {
    const result = parseGitBlame("", "empty.txt");
    assert.deepStrictEqual(result.hunks, []);
    assert.strictEqual(result.lineCount, 0);
  });
});

describe("GitService.getGitBlame", () => {
  async function commit(
    repo: GitTestRepo,
    relFile: string,
    lines: string[],
    message: string,
  ): Promise<string> {
    await repo.writeFile(relFile, `${lines.join("\n")}\n`);
    await repo.git("add", "--", relFile);
    await repo.git("commit", "-q", "-m", message);
    return (await repo.git("rev-parse", "HEAD")).trim();
  }

  function serviceFor(root: string): GitService {
    const paths: RepositoryPaths = {
      workTreeRoot: root,
      gitDir: path.join(root, ".git"),
      commonDir: path.join(root, ".git"),
    };
    return new GitService(paths);
  }

  it("returns grouped blame hunks for a file with multiple commits", async () => {
    const repo = await GitTestRepo.create();
    const relFile = "file.txt";
    const first = await commit(
      repo,
      relFile,
      ["line one", "line two", "line three"],
      "first commit",
    );
    const second = await commit(
      repo,
      relFile,
      ["line one", "line two changed", "line three"],
      "second commit",
    );

    const service = serviceFor(repo.rootPath);
    const result: BlameResult = await service.getGitBlame(relFile);

    assert.strictEqual(result.file, relFile);
    assert.strictEqual(result.lineCount, 3);
    assert.strictEqual(result.hunks.length, 3);

    const [aliceFirst, bobHunk, aliceRest] = result.hunks;
    assert.deepStrictEqual(
      aliceFirst.lines.map((l) => l.lineNumber),
      [1],
    );
    assert.strictEqual(aliceFirst.commitHash, first);
    assert.strictEqual(aliceFirst.summary, "first commit");
    assert.strictEqual(aliceFirst.author, "BranchShift Test");
    assert.deepStrictEqual(
      bobHunk.lines.map((l) => l.lineNumber),
      [2],
    );
    assert.strictEqual(bobHunk.commitHash, second);
    assert.strictEqual(bobHunk.summary, "second commit");
    assert.deepStrictEqual(
      aliceRest.lines.map((l) => l.lineNumber),
      [3],
    );
    assert.strictEqual(aliceRest.commitHash, first);
  });

  it("rejects invalid paths (absolute, traversal, option-like)", async () => {
    const repo = await GitTestRepo.create();
    await commit(repo, "file.txt", ["content"], "base");
    const service = serviceFor(repo.rootPath);

    await assert.rejects(
      () => service.getGitBlame("/etc/passwd"),
      /Invalid file path/,
    );
    await assert.rejects(
      () => service.getGitBlame("../escape.txt"),
      /Invalid file path/,
    );
    await assert.rejects(
      () => service.getGitBlame("--help"),
      /Invalid file path/,
    );
  });
});
