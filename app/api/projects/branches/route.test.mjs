import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * The project branch endpoint, at its edge.
 *
 * The project lists ask for the paths they are about to render, so the route is
 * on the open path of a dropdown: it answers many paths in one request, it
 * answers a path it may not read with nothing, and `refresh=1` makes the next
 * answer a fresh one, because a branch is something the user moves by hand.
 */

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-project-branches-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRootsCache = globalThis.__piAllowedRootsCache;
const previousAdditionalRoots = globalThis.__piAdditionalAllowedRoots;
delete globalThis.__piAllowedRootsCache;
delete globalThis.__piAdditionalAllowedRoots;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");
const { NextRequest } = await jiti.import("next/server");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { invalidateProjectBranch } = await jiti.import("../../../../lib/project-branches.ts");

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

function checkout(name) {
  const root = fs.mkdtempSync(path.join(base, "repo-"));
  git(root, "init", "--quiet", "--initial-branch", name);
  git(root, "config", "user.email", "probe@example.com");
  git(root, "config", "user.name", "Probe");
  fs.writeFileSync(path.join(root, "tracked.txt"), "one\n");
  git(root, "add", "tracked.txt");
  git(root, "commit", "--quiet", "-m", "first");
  allowFileRoot(root);
  invalidateProjectBranch(root);
  return root;
}

function get(cwds, extra = {}) {
  const url = new URL("http://127.0.0.1:30141/api/projects/branches");
  for (const cwd of cwds) url.searchParams.append("cwd", cwd);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  // A real request carries the Host it arrived on; the route's host check reads
  // that header, and a NextRequest built in-process has none of its own.
  return GET(new NextRequest(url, { headers: { host: "127.0.0.1:30141" } }));
}

test("answers every path the list asked for, in one request", async () => {
  const repo = checkout("list-branch");
  const plain = fs.mkdtempSync(path.join(base, "plain-"));
  allowFileRoot(plain);
  const response = await get([repo, plain]);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.projects, [
    { cwd: repo, branch: "list-branch", isWorktree: false, isRepo: true },
    { cwd: plain, branch: null, isWorktree: false, isRepo: false },
  ]);
});

test("a path outside the app's roots is answered with nothing, in the same shape as a non-repository", async () => {
  const sibling = fs.mkdtempSync(path.join(base, "sibling-"));
  const denied = fs.mkdtempSync(path.join(sibling, "denied-"));
  git(denied, "init", "--quiet", "--initial-branch", "hidden-branch");
  const response = await get([denied]);
  assert.equal(response.status, 200, "the request is not refused: a list of projects keeps working when one is off-limits");
  const body = await response.json();
  assert.deepEqual(body.projects, [{ cwd: denied, branch: null, isWorktree: false, isRepo: false }]);
  const text = JSON.stringify(body);
  assert.ok(!text.includes("hidden-branch"), "no branch leaks for a folder the app may not read");
});

test("asks for at least one path", async () => {
  const response = await get([]);
  assert.equal(response.status, 400);
});

test("a request from a foreign origin is refused before git is asked anything", async () => {
  const repo = checkout("origin-branch");
  const url = new URL("http://127.0.0.1:30141/api/projects/branches");
  url.searchParams.append("cwd", repo);
  const response = await GET(new NextRequest(url, { headers: { host: "127.0.0.1:30141", origin: "http://elsewhere.example" } }));
  assert.equal(response.status, 403);
});

test("refresh=1 answers the branch the user moved to, without waiting out the cache", async () => {
  const repo = checkout("before");
  assert.equal((await (await get([repo])).json()).projects[0].branch, "before");
  git(repo, "checkout", "--quiet", "-b", "after");
  assert.equal((await (await get([repo])).json()).projects[0].branch, "before", "the cache window is real");
  assert.equal((await (await get([repo], { refresh: "1" })).json()).projects[0].branch, "after");
});
