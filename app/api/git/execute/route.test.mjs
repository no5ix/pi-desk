import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-git-execute-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRootsCache = globalThis.__piAllowedRootsCache;
const previousAdditionalRoots = globalThis.__piAdditionalAllowedRoots;
delete globalThis.__piAllowedRootsCache;
delete globalThis.__piAdditionalAllowedRoots;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
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
const { POST } = await jiti.import("./route.ts");
const { GET: getRepos } = await jiti.import("../repos/route.ts");
const { GET: getEvents } = await jiti.import("../events/route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(base, "repo-"));
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.name", "Pi Test");
  git(root, "config", "user.email", "pi-test@example.com");
  fs.writeFileSync(path.join(root, "app.ts"), "export const value = 1;\n");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "initial");
  return { root, outside: null };
}

function post(body, { origin = "http://localhost", contentType = "application/json" } = {}) {
  return POST(new Request("http://localhost/api/git/execute", {
    method: "POST",
    headers: {
      "content-type": contentType,
      origin,
      host: "localhost",
    },
    body: JSON.stringify(body),
  }));
}

async function json(response) {
  return response.json();
}

test("the panel endpoint answers a trusted request with the bridge envelope", async () => {
  const { root } = fixtureRepo();
  allowFileRoot(root);

  const response = await post({ cwd: root, command: "getBranches" });
  assert.equal(response.status, 200);
  const payload = await json(response);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.data.map((branch) => branch.name), ["main"]);
  assert.equal(payload.data[0].isCurrent, true);
});

test("a cross-origin request is refused before anything runs", async () => {
  const { root } = fixtureRepo();
  allowFileRoot(root);

  const response = await post({ cwd: root, command: "getStatus" }, { origin: "https://evil.example" });
  assert.equal(response.status, 403);

  const form = await post({ cwd: root, command: "getStatus" }, { contentType: "text/plain" });
  assert.equal(form.status, 403);
});

test("a command outside the table never reaches git", async () => {
  const { root } = fixtureRepo();
  allowFileRoot(root);

  for (const command of ["exec", "spawn", "shell", "rm", "git", ""]) {
    const response = await post({ cwd: root, command, params: { args: ["status"] } });
    assert.equal(response.status, 400, `${command} must be refused`);
    const payload = await json(response);
    assert.equal(payload.error.code, "UNKNOWN");
  }
});

test("the project folder is validated, and a folder outside the allowed roots yields REPO_NOT_FOUND", async () => {
  const { root } = fixtureRepo();
  const outside = fs.mkdtempSync(path.join(base, "not-allowed-"));
  git(outside, "init", "--quiet", "--initial-branch=main");

  const relative = await post({ cwd: "relative/path", command: "getStatus" });
  assert.equal(relative.status, 400);

  const response = await post({ cwd: outside, command: "getStatus" });
  assert.equal(response.status, 400);
  assert.equal((await json(response)).error.code, "REPO_NOT_FOUND");

  // The same repository is reachable once its folder is an allowed project cwd.
  allowFileRoot(outside);
  const ok = await post({ cwd: outside, command: "getBranches" });
  assert.equal(ok.status, 200);
  // Empty repository: reachable, and it reports no branches.
  assert.deepEqual((await json(ok)).data, []);
  const status = await post({ cwd: outside, command: "getStatus" });
  assert.equal(status.status, 200);
});

test("a file path that leaves the checkout is refused, and the working tree is untouched", async () => {
  const { root } = fixtureRepo();
  allowFileRoot(root);
  const outside = path.join(base, "victim.txt");
  fs.writeFileSync(outside, "keep me\n");

  for (const filePath of ["../victim.txt", outside, ".git/config", "a/../../b"]) {
    const response = await post({ cwd: root, command: "stageFile", params: { filePath } });
    assert.equal(response.status, 400, `${filePath} must be refused`);
    assert.equal((await json(response)).error.code, "FILE_NOT_FOUND");
  }
  assert.equal(fs.readFileSync(outside, "utf8"), "keep me\n");
  assert.deepEqual(git(root, "status", "--porcelain"), "");
});

test("a repository the cwd cannot reach is refused, so repoId cannot aim at any path", async () => {
  const { root } = fixtureRepo();
  const other = fs.mkdtempSync(path.join(base, "other-"));
  git(other, "init", "--quiet", "--initial-branch=main");
  allowFileRoot(root);
  allowFileRoot(other);

  const response = await post({ cwd: root, repoId: other, command: "getStatus" });
  assert.equal(response.status, 400);
  assert.equal((await json(response)).error.code, "REPO_NOT_FOUND");
});

test("a mutation reports a structured failure the panel can show, with git's own words", async () => {
  const { root } = fixtureRepo();
  allowFileRoot(root);
  git(root, "checkout", "-q", "-b", "feature");
  fs.writeFileSync(path.join(root, "app.ts"), "export const value = 2;\n");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "feature");
  git(root, "checkout", "-q", "main");
  fs.writeFileSync(path.join(root, "app.ts"), "export const value = 3;\n");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "main");

  const response = await post({ cwd: root, command: "mergeBranch", params: { branch: "feature" } });
  assert.equal(response.status, 400);
  const payload = await json(response);
  assert.equal(payload.error.code, "GIT_COMMAND_FAILED");
  assert.match(payload.error.message, /CONFLICT|conflict/);
  assert.equal(payload.error.recovery, "Check the repository state and retry.");

  // The merge state is readable, which is what the conflict dashboard needs.
  const state = await json(await post({ cwd: root, command: "getMergeState" }));
  assert.equal(state.data.isMerging, true);
});

test("the repos endpoint lists the workspace for an allowed cwd only", async () => {
  const { root } = fixtureRepo();
  const worktree = path.join(base, "wt");
  git(root, "worktree", "add", worktree, "-b", "topic", "HEAD");
  allowFileRoot(root);

  const url = new URL("http://localhost/api/git/repos");
  url.searchParams.set("cwd", root);
  const response = await getRepos(new Request(url, { headers: { host: "localhost" } }));
  assert.equal(response.status, 200);
  const payload = await json(response);
  assert.equal(payload.activeId, root);
  assert.deepEqual(payload.repos.map((repo) => repo.id).sort(), [root, worktree].sort());
  assert.equal(payload.repos.find((repo) => repo.id === worktree).branch, "topic");

  const denied = new URL("http://localhost/api/git/repos");
  denied.searchParams.set("cwd", base);
  const deniedResponse = await getRepos(new Request(denied, { headers: { host: "localhost" } }));
  assert.equal(deniedResponse.status, 403);
});

test("the events endpoint opens a stream for a repository, and 404s for a folder that is not one", async () => {
  const { root } = fixtureRepo();
  allowFileRoot(root);

  const missing = new URL("http://localhost/api/git/events");
  missing.searchParams.set("cwd", base);
  const notFound = await getEvents(new Request(missing, { headers: { host: "localhost", origin: "http://localhost" } }));
  assert.equal(notFound.status, 404);

  const url = new URL("http://localhost/api/git/events");
  url.searchParams.set("cwd", root);
  const controller = new AbortController();
  const response = await getEvents(new Request(url, {
    headers: { host: "localhost", origin: "http://localhost" },
    signal: controller.signal,
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);

  const reader = response.body.getReader();
  const first = await reader.read();
  const text = new TextDecoder().decode(first.value);
  assert.match(text, /^event: connected/m);
  assert.match(text, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  controller.abort();
  await reader.cancel().catch(() => {});
});
