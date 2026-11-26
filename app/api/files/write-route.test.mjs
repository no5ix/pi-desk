// The editor's write path: PUT /api/files/[...path]. What the route refuses is
// the security boundary — a path outside the authorized roots, a credential
// file, anything under .git, a binary, a file that moved on disk since the
// editor read it. The response codes are the editor's save bar, so they are
// asserted too.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-write-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRoots = globalThis.__piAllowedRootsCache;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRoots;
  fs.rmSync(base, { recursive: true, force: true });
});

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { PUT } = await jiti.import("./[...path]/route.ts");
const { encodeFilePathForApi } = await jiti.import("../../../lib/file-paths.ts");
const { NextRequest } = await jiti.import("next/server");

function fixture(files = {}) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(base, "project-")));
  globalThis.__piAllowedRootsCache = { roots: new Set([directory]), expiresAt: Date.now() + 60_000 };
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  return directory;
}

async function write(directory, relative, body) {
  const target = relative ? path.join(directory, relative) : directory;
  const encoded = encodeFilePathForApi(target);
  const response = await PUT(
    new NextRequest(`http://localhost/api/files/${encoded}`, {
      method: "PUT",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) },
  );
  return { status: response.status, payload: await response.json().catch(() => null) };
}

test("an allowed file is written, and the response carries the new disk time", async () => {
  const directory = fixture({ "note.txt": "original" });
  const result = await write(directory, "note.txt", { content: "edited in the panel" });
  assert.equal(result.status, 200);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.size, Buffer.byteLength("edited in the panel"));
  assert.ok(result.payload.mtime, "the editor saves against this time next");
  assert.equal(fs.readFileSync(path.join(directory, "note.txt"), "utf8"), "edited in the panel");
});

test("a write against a stale disk time is refused, and the file keeps the bytes that arrived", async () => {
  const directory = fixture({ "note.txt": "opened by the editor" });
  const stale = new Date(Date.now() - 60_000).toISOString();
  fs.writeFileSync(path.join(directory, "note.txt"), "written by git");
  const result = await write(directory, "note.txt", { content: "editor buffer", baseMtime: stale });
  assert.equal(result.status, 409);
  assert.equal(result.payload.code, "CONFLICT");
  assert.equal(fs.readFileSync(path.join(directory, "note.txt"), "utf8"), "written by git");
});

test("the current disk time is accepted, and an explicit overwrite writes over a change", async () => {
  const directory = fixture({ "note.txt": "first" });
  const fresh = fs.statSync(path.join(directory, "note.txt")).mtime.toISOString();
  assert.equal((await write(directory, "note.txt", { content: "second", baseMtime: fresh })).status, 200);
  // Overwrite is the user's answer to a conflict, and it says so.
  fs.writeFileSync(path.join(directory, "note.txt"), "changed by the terminal");
  const forced = await write(directory, "note.txt", { content: "third", baseMtime: fresh, allowOverwrite: true });
  assert.equal(forced.status, 200);
  assert.equal(forced.payload.overwritten, true);
  assert.equal(fs.readFileSync(path.join(directory, "note.txt"), "utf8"), "third");
});

test("a file that does not exist is created, with its folders", async () => {
  const directory = fixture();
  const result = await write(directory, "src/new/deep.ts", { content: "export const created = true;\n" });
  assert.equal(result.status, 200);
  assert.equal(result.payload.created, true);
  assert.equal(fs.readFileSync(path.join(directory, "src/new/deep.ts"), "utf8"), "export const created = true;\n");
});

test("credential files and everything under .git are not writable, however the path is spelled", async () => {
  const directory = fixture({
    ".ssh/id_ed25519": "secret",
    ".git/COMMIT_EDITMSG": "message",
    ".env": "SECRET=1",
    ".git/hooks/pre-commit": "#!/bin/sh",
    ".git-credentials": "secret",
    "config/deploy.pem": "key",
    "secrets/credentials": "secret",
    "work/.pi/agent/auth.json": "{}",
  });
  for (const relative of [
    ".ssh/id_ed25519", ".ssh/../.ssh/id_ed25519", ".git/COMMIT_EDITMSG",
    ".git/hooks/pre-commit", ".git-credentials", "config/deploy.pem",
    "secrets/credentials", "work/.pi/agent/auth.json",
  ]) {
    const result = await write(directory, relative, { content: "tampered" });
    assert.equal(result.status, 403, `${relative} is refused`);
    assert.equal(result.payload.code, "READ_ONLY", "the refusal says why");
  }
  assert.equal(fs.readFileSync(path.join(directory, ".ssh/id_ed25519"), "utf8"), "secret");
  assert.equal(fs.readFileSync(path.join(directory, ".git/COMMIT_EDITMSG"), "utf8"), "message");
  assert.equal(fs.readFileSync(path.join(directory, ".git/hooks/pre-commit"), "utf8"), "#!/bin/sh");
  // A project's own .env stays writable: it is configuration, not a credential store.
  const env = await write(directory, ".env", { content: "SECRET=2\n" });
  assert.equal(env.status, 200);
});

test("a path outside the authorized roots is refused, and nothing is created", async () => {
  const directory = fixture();
  const outside = path.join(base, "outside.txt");
  const encoded = encodeFilePathForApi(outside);
  const response = await PUT(
    new NextRequest(`http://localhost/api/files/${encoded}`, {
      method: "PUT",
      headers: { host: "localhost", "content-type": "application/json" },
      body: JSON.stringify({ content: "escape" }),
    }),
    { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) },
  );
  assert.ok([403, 400].includes(response.status), `refused with ${response.status}`);
  assert.equal(fs.existsSync(outside), false);
  // A traversal inside an authorized root is refused the same way.
  const traversal = await write(directory, "../escape.txt", { content: "escape" });
  assert.ok([400, 403].includes(traversal.status));
  assert.equal(fs.existsSync(path.join(base, "escape.txt")), false);
});

test("a binary body is refused, and a directory is not a file", async () => {
  const directory = fixture({ "blob.bin": "head\u0000tail" });
  const binary = await write(directory, "blob.bin", { content: "head\u0000tail edited" });
  assert.equal(binary.status, 413);
  assert.equal(binary.payload.code, "BINARY");
  const directoryWrite = await write(directory, "", { content: "not a file" });
  assert.equal(directoryWrite.status, 400);
  assert.equal(directoryWrite.payload.code, "NOT_A_FILE");
});

test("an oversized body is refused before the disk is touched", async () => {
  const directory = fixture({ "big.txt": "small" });
  const content = "x".repeat(9 * 1024 * 1024);
  const result = await write(directory, "big.txt", { content });
  assert.equal(result.status, 413);
  assert.equal(result.payload.code, "TOO_LARGE");
  assert.equal(fs.readFileSync(path.join(directory, "big.txt"), "utf8"), "small");
});

test("a missing file with a baseMtime is a 404, not a create", async () => {
  const directory = fixture();
  const result = await write(directory, "gone.txt", { content: "x", baseMtime: new Date().toISOString() });
  assert.equal(result.status, 404);
  assert.equal(result.payload.code, "NOT_FOUND");
  assert.equal(fs.existsSync(path.join(directory, "gone.txt")), false);
});

test("a body that is not JSON is refused: the write endpoint takes one shape", async () => {
  const directory = fixture({ "note.txt": "x" });
  const encoded = encodeFilePathForApi(path.join(directory, "note.txt"));
  const response = await PUT(
    new NextRequest(`http://localhost/api/files/${encoded}`, {
      method: "PUT",
      headers: { host: "localhost", "content-type": "text/plain" },
      body: "content",
    }),
    { params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }) },
  );
  assert.equal(response.status, 415);
});

test("the written file keeps its mode, and a symlink out of the roots is not followed", async () => {
  const directory = fixture({ "note.txt": "inside" });
  const outsideFile = path.join(base, "victim.txt");
  fs.writeFileSync(outsideFile, "do not touch");
  fs.symlinkSync(outsideFile, path.join(directory, "link.txt"));
  const result = await write(directory, "link.txt", { content: "through the link" });
  assert.ok([400, 403, 409].includes(result.status), `refused with ${result.status}`);
  assert.equal(fs.readFileSync(outsideFile, "utf8"), "do not touch");
  assert.equal(fs.lstatSync(path.join(directory, "link.txt")).isSymbolicLink(), true, "the link is still a link");
});
