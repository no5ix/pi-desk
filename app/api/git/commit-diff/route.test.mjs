import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// One commit's patch over HTTP, for the right panel's Git view: the same patch the
// file viewer's diff view paints, the same access gate /api/git/status applies, and
// a named answer for the commits that have no patch to paint.

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-commit-diff-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRootsCache = globalThis.__piAllowedRootsCache;
const previousAdditionalRoots = globalThis.__piAdditionalAllowedRoots;
delete globalThis.__piAllowedRootsCache;
delete globalThis.__piAdditionalRoots;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRootsCache;
  globalThis.__piAdditionalAllowedRoots = previousAdditionalRoots;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { NextRequest } = await jiti.import("next/server");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

/** A repository with a modification, a rename, a merge, and one huge commit. */
function fixture() {
  const root = fs.mkdtempSync(path.join(base, "repo-"));
  git(root, "init", "--initial-branch=main", "--quiet");
  git(root, "config", "user.email", "lynx@example.com");
  git(root, "config", "user.name", "Lynx");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/a.ts"), "one\ntwo\n");
  fs.writeFileSync(path.join(root, "src/old.ts"), "keep\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "Base");
  fs.writeFileSync(path.join(root, "src/a.ts"), "one\ntwo\nthree\n");
  git(root, "mv", "src/old.ts", "src/kept.ts");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "Change and rename");
  return root;
}

function head(root) {
  return git(root, "rev-parse", "HEAD").trim();
}

function request(cwd, sha) {
  const url = new URL("http://localhost/api/git/commit-diff");
  url.searchParams.set("cwd", cwd);
  if (sha !== undefined) url.searchParams.set("sha", sha);
  return GET(new NextRequest(url));
}

test("a commit answers with its message, its files and the patch the panel paints", async () => {
  const root = fixture();
  allowFileRoot(root);
  const response = await request(root, head(root));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.isGitRepository, true);
  assert.equal(data.supported, true);
  assert.equal(data.commit.subject, "Change and rename");
  assert.equal(data.repositoryRoot, root);
  const byPath = new Map(data.files.map((file) => [file.path, file]));
  assert.equal(byPath.get("src/a.ts").status, "modified");
  assert.equal(byPath.get("src/a.ts").additions, 1);
  assert.equal(byPath.get("src/kept.ts").oldPath, "src/old.ts", "a rename names both paths, so the row can say so");
  assert.match(data.patch, /^diff --git a\/src\/a\.ts b\/src\/a\.ts/m, "the patch is a unified diff, the file viewer's own input");
  assert.match(data.patch, /^rename from src\/old\.ts$/m);
  assert.ok(data.patchBytes > 0 && data.patchBytes === Buffer.byteLength(data.patch, "utf8"));
});

test("a merge is answered against its first parent, so the panel never shows an empty commit", async () => {
  const root = fixture();
  allowFileRoot(root);
  git(root, "checkout", "-qb", "side", "HEAD~1");
  fs.writeFileSync(path.join(root, "side.txt"), "side\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "Side change");
  git(root, "checkout", "-q", "main");
  git(root, "merge", "--no-ff", "-qm", "Merge the side branch", "side");
  const data = await (await request(root, head(root))).json();
  assert.equal(data.commit.parentCount, 2);
  assert.equal(data.supported, true);
  assert.deepEqual(data.files.map((file) => file.path), ["side.txt"]);
  assert.match(data.patch, /\+side/);
});

test("a commit with no patch of its own is named, not left blank", async () => {
  const root = fixture();
  allowFileRoot(root);
  const first = git(root, "rev-parse", "HEAD~1").trim();
  assert.equal((await (await request(root, first)).json()).supported, true, "a commit with a change has a patch");

  git(root, "commit", "-qm", "A note, no change", "--allow-empty");
  const empty = await (await request(root, head(root))).json();
  assert.equal(empty.supported, false);
  assert.equal(empty.reason, "no-changes", "an empty commit says it changed nothing, the panel does not show a blank box");
  assert.equal(empty.commit.subject, "A note, no change", "and the commit is still named");

  const unknown = await (await request(root, "dead000000000000000000000000000000000000")).json();
  assert.equal(unknown.supported, false);
  assert.equal(unknown.reason, "unknown-commit", "a sha git does not know says so");
});

test("the gate: a sha is a sha, a foreign folder is denied, a plain folder says it is not a repository", async () => {
  const root = fixture();
  allowFileRoot(root);
  assert.equal((await request(root, "main")).status, 400, "a branch name is not a commit");
  assert.equal((await request(root, "abc123")).status, 400, "five characters is not a sha git resolves");
  assert.equal((await request(root)).status, 400, "no sha is no read");
  assert.equal((await request("relative/path", "abc1234")).status, 400);
    const gone = path.join(base, "gone");
  allowFileRoot(gone);
assert.equal((await request(gone, "abc1234")).status, 404);

  const outside = fs.mkdtempSync(path.join(base, "outside-"));
  git(outside, "init", "--quiet");
  assert.equal((await request(outside, "abc1234")).status, 403);

  const plain = fs.mkdtempSync(path.join(base, "plain-"));
  allowFileRoot(plain);
  const notRepo = await (await request(plain, "abc1234")).json();
  assert.equal(notRepo.isGitRepository, false);
  assert.equal(notRepo.supported, false);
  assert.equal(notRepo.reason, "not-a-repository");
});
