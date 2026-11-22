import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The route reads a session's recorded write/edit/apply_patch calls, so the
// fixture is a real session file in a temporary agent dir: no provider, no run.
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-diff-route-")));
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
const { GET } = await jiti.import("./route.ts");
const { NextRequest } = await jiti.import("next/server");

const SESSION_ID = "01a20192-bf6c-7718-b7a0-1604e0cb2c06";

function makeRepo() {
  return fs.realpathSync(fs.mkdtempSync(path.join(base, "repo-")));
}

function writeSession(cwd, messageLines) {
  const dir = path.join(process.env.PI_CODING_AGENT_DIR, "sessions", cwd.replaceAll("/", "-"));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `2026-11-22T04-17-18-449Z_${SESSION_ID}.jsonl`);
  fs.writeFileSync(file, sessionLines(cwd, messageLines).map((line) => JSON.stringify(line)).join("\n") + "\n");
  return file;
}

function sessionLines(cwd, messageLines) {
  return [
    { type: "session", version: 3, id: SESSION_ID, timestamp: "2026-11-22T04:17:18.449Z", cwd },
    { type: "message", id: "m1", parentId: null, message: { role: "user", content: "write it" } },
    ...messageLines,
  ];
}

function assistant(id, blocks, parentId = "m1") {
  return { type: "message", id, parentId, message: { role: "assistant", content: blocks } };
}

function result(id, toolCallId, details, parentId = "m2") {
  return {
    type: "message", id, parentId,
    message: { role: "toolResult", toolCallId, toolName: "write", content: [{ type: "text", text: "ok" }], ...(details ? { details } : {}) },
  };
}

function get(url, id = SESSION_ID) {
  return GET(new NextRequest(url), { params: Promise.resolve({ id }) });
}

test("answers with the diff the session recorded for the file", async () => {
  const repo = makeRepo();
  writeSession(repo, [
    assistant("m2", [{ type: "toolCall", toolCallId: "t1", toolName: "write", input: { path: "a.txt", content: "one\ntwo\n" } }]),
    result("m3", "t1"),
  ]);

  const response = await get(`http://localhost/api/sessions/${SESSION_ID}/file-diff?path=${encodeURIComponent(path.join(repo, "a.txt"))}`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.supported, true);
  assert.equal(body.source, "session");
  assert.equal(body.status, "added");
  assert.equal(body.changes, 1);
  assert.ok(body.patch.includes("+one"));
  assert.ok(body.patch.includes("+two"));
  assert.deepEqual({ additions: body.additions, deletions: body.deletions }, { additions: 2, deletions: 0 });
});

test("a session that never wrote the file says so without an error", async () => {
  const repo = makeRepo();
  writeSession(repo, [
    assistant("m2", [{ type: "toolCall", toolCallId: "t1", toolName: "read", input: { path: "a.txt" } }]),
    result("m3", "t1"),
  ]);

  const response = await get(`http://localhost/api/sessions/${SESSION_ID}/file-diff?path=${encodeURIComponent(path.join(repo, "a.txt"))}`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, { supported: false, source: "session" });
});

test("the path must be absolute, and the session must exist", async () => {
  const repo = makeRepo();
  writeSession(repo, []);
  const relative = await get(`http://localhost/api/sessions/${SESSION_ID}/file-diff?path=a.txt`);
  assert.equal(relative.status, 400);
  const noPath = await get(`http://localhost/api/sessions/${SESSION_ID}/file-diff`);
  assert.equal(noPath.status, 400);
  const missing = await get(`http://localhost/api/sessions/nosuchsession/file-diff?path=${encodeURIComponent(path.join(repo, "a.txt"))}`, "nosuchsession");
  assert.equal(missing.status, 404);
});
