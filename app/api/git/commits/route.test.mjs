import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The panel's middle level over HTTP: the branch's commits, the access gate, and the
// answers a list needs (empty, not-a-repository, the next page).

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-git-commits-route-")));
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

/** A repository with a known history, allowed through the file gate. */
function fixture(commits = 3) {
  const root = fs.mkdtempSync(path.join(base, "repo-"));
  git(root, "init", "--initial-branch=main", "--quiet");
  git(root, "config", "user.email", "lynx@example.com");
  git(root, "config", "user.name", "Lynx");
  for (let i = 1; i <= commits; i += 1) {
    fs.writeFileSync(path.join(root, `note-${i}.md`), `commit ${i}\n`);
    git(root, "add", "-A");
    git(root, "commit", "-qm", `Commit ${i}`);
  }
  allowFileRoot(root);
  return root;
}

function request(query) {
  const url = new URL("http://localhost/api/git/commits");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return GET(new NextRequest(url));
}

test("a branch's commits come back newest first, with the sha the panel's row needs", async () => {
  const root = fixture();
  const response = await request({ cwd: root, ref: "main" });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.isGitRepository, true);
  assert.equal(data.resolvedRef, "main");
  assert.equal(data.repositoryRoot, root);
  assert.deepEqual(data.commits.map((commit) => commit.subject), ["Commit 3", "Commit 2", "Commit 1"]);
  assert.equal(data.commits[0].shortSha.length, 7);
  assert.ok(data.commits[0].dateMs > 0, "the row's relative time is a number, not git's words");
  assert.equal(data.hasMore, false);
});

test("the page answers with the next one, and never with more than it is capped to", async () => {
  const root = fixture(5);
  const page = await (await request({ cwd: root, ref: "main", limit: 2 })).json();
  assert.deepEqual(page.commits.map((commit) => commit.subject), ["Commit 5", "Commit 4"]);
  assert.equal(page.hasMore, true);
  const next = await (await request({ cwd: root, ref: "main", limit: 2, skip: 2 })).json();
  assert.deepEqual(next.commits.map((commit) => commit.subject), ["Commit 3", "Commit 2"]);
  const greedy = await (await request({ cwd: root, ref: "main", limit: 100_000 })).json();
  assert.ok(greedy.commits.length <= 200, "a huge page is capped, so one panel cannot ask for a repository's whole history");
});

test("a branch with no commits of its own and a folder that is not a repository are both answers", async () => {
  const root = fixture();
  const missing = await (await request({ cwd: root, ref: "fix/not-here" })).json();
  assert.equal(missing.isGitRepository, true);
  assert.deepEqual(missing.commits, [], "an unknown ref is an empty list, and the panel names it");
  assert.equal(missing.resolvedRef, null);

  const plain = fs.mkdtempSync(path.join(base, "plain-"));
  allowFileRoot(plain);
  const notRepo = await (await request({ cwd: plain, ref: "main" })).json();
  assert.equal(notRepo.isGitRepository, false);
  assert.deepEqual(notRepo.commits, []);
});

test("the gate: a ref in an option's clothes, a foreign folder, a missing one", async () => {
  const root = fixture();
  assert.equal((await request({ cwd: root, ref: "--upload-pack=curl" })).status, 400);
  assert.equal((await request({ cwd: root, ref: "HEAD~100" })).status, 400);
  assert.equal((await request({ cwd: root })).status, 400, "no ref is no read");
  assert.equal((await request({ cwd: "relative/path", ref: "main" })).status, 400);
    const gone = path.join(base, "gone");
  allowFileRoot(gone);
assert.equal((await request({ cwd: gone, ref: "main" })).status, 404);

  const outside = fs.mkdtempSync(path.join(base, "outside-"));
  git(outside, "init", "--quiet");
  const denied = await request({ cwd: outside, ref: "main" });
  assert.equal(denied.status, 403, "a folder nobody opened is not readable through this route");
});
