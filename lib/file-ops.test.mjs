import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { createJiti } from "jiti";

// The module's own chain reaches the route-side helpers (`@/lib/...`, the
// allowed-roots cache), so it is loaded the way the route tests load a route.
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { runFileOperation, validateOperationName } = await jiti.import("./file-ops.ts");

/**
 * The file tree's operations, on a temporary folder authorized as a root.
 *
 * A delete is deliberately not exercised on a real file: a delete goes to the
 * system Trash, and a test has no business putting the developer's Trash under
 * its feet. What is asserted about delete is the rule that costs nothing — a
 * project root is never the tree's to remove.
 */

let root;
let roots;

before(async () => {
  const made = await fs.mkdtemp(path.join(os.tmpdir(), "pi-file-ops-"));
  root = await fs.realpath(made); // macOS: /var is a link, and the roots are compared real.
  roots = new Set([root]);
});

after(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const at = (...parts) => path.join(root, ...parts);

async function seed() {
  await fs.writeFile(at("notes.txt"), "one\n");
  await fs.writeFile(at("other.txt"), "other\n");
  await fs.mkdir(at("folder"), { recursive: true });
  await fs.writeFile(at("folder", "inside.txt"), "inside\n");
}

async function reset() {
  for (const entry of await fs.readdir(root)) {
    await fs.rm(at(entry), { recursive: true, force: true });
  }
  await seed();
}

describe("validateOperationName", () => {
  it("takes one plain folder name", () => {
    assert.equal(validateOperationName("notes.md"), "notes.md");
    assert.equal(validateOperationName("a b.cat"), "a b.cat");
  });

  it("refuses the names that hide a path, a parent, or a hidden file on Windows", () => {
    for (const name of ["", ".", "..", "a/b", "a\\b", ".git", ".gitignore", "x.", "x ", "a\u0000b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a|b", "/abs", "../out"]) {
      assert.equal(validateOperationName(name), null, `${JSON.stringify(name)} must be refused`);
    }
  });
});

describe("runFileOperation", () => {
  before(seed);

  it("creates a file and a folder in the row's folder", async () => {
    const file = await runFileOperation(at("folder"), { op: "create", name: "new.txt" }, { roots });
    assert.equal(file.ok, true, JSON.stringify(file));
    assert.equal(file.kind, "file");
    assert.equal((await fs.stat(at("folder", "new.txt"))).size, 0);

    const folder = await runFileOperation(at("."), { op: "mkdir", name: "sub" }, { roots });
    // A folder row is the folder the new one goes into, so the root is a folder too.
    assert.equal(folder.ok, true, JSON.stringify(folder));
    assert.ok((await fs.stat(at("sub"))).isDirectory());

    const twice = await runFileOperation(at("folder"), { op: "create", name: "new.txt" }, { roots });
    assert.equal(twice.ok, false);
    assert.equal(twice.code, "EXISTS");
  });

  it("renames and keeps the content, and refuses a taken name", async () => {
    await reset();
    const renamed = await runFileOperation(at("notes.txt"), { op: "rename", name: "notes-v2.txt" }, { roots });
    assert.equal(renamed.ok, true, JSON.stringify(renamed));
    assert.equal(await fs.readFile(at("notes-v2.txt"), "utf8"), "one\n");
    await assert.rejects(() => fs.stat(at("notes.txt")), { code: "ENOENT" });

    const clash = await runFileOperation(at("notes-v2.txt"), { op: "rename", name: "other.txt" }, { roots });
    assert.equal(clash.ok, false);
    assert.equal(clash.code, "EXISTS");
    assert.equal(await fs.readFile(at("other.txt"), "utf8"), "other\n");
  });

  it("copies and moves a path into a pasted folder", async () => {
    await reset();
    const copied = await runFileOperation(at("notes.txt"), { op: "copy", targetDirectory: at("folder") }, { roots });
    assert.equal(copied.ok, true, JSON.stringify(copied));
    assert.equal(await fs.readFile(at("folder", "notes.txt"), "utf8"), "one\n");
    assert.equal(await fs.readFile(at("notes.txt"), "utf8"), "one\n");

    const moved = await runFileOperation(at("notes.txt"), { op: "move", targetDirectory: at("folder") }, { roots });
    assert.equal(moved.ok, false, "the copy sits in that folder already");
    assert.equal(moved.code, "EXISTS");

    const movedFresh = await runFileOperation(at("notes.txt"), { op: "move", targetDirectory: at("folder"), overwrite: true }, { roots });
    assert.equal(movedFresh.ok, true, JSON.stringify(movedFresh));
    await assert.rejects(() => fs.stat(at("notes.txt")), { code: "ENOENT" });

    const self = await runFileOperation(at("folder"), { op: "move", targetDirectory: at("folder") }, { roots });
    assert.equal(self.ok, false);
    assert.equal(self.code, "DENIED");
  });

  it("copies a whole folder", async () => {
    await reset();
    await fs.mkdir(at("elsewhere"), { recursive: true });
    const copied = await runFileOperation(at("folder"), { op: "copy", targetDirectory: at("elsewhere") }, { roots });
    assert.equal(copied.ok, true, JSON.stringify(copied));
    assert.equal(await fs.readFile(at("elsewhere", "folder", "inside.txt"), "utf8"), "inside\n");
    assert.equal(await fs.readFile(at("folder", "inside.txt"), "utf8"), "inside\n");

    const intoItself = await runFileOperation(at("folder"), { op: "copy", targetDirectory: at("folder") }, { roots });
    assert.equal(intoItself.ok, false);
    assert.equal(intoItself.code, "DENIED");
  });

  it("keeps every end of an operation inside the roots, links included", async () => {
    await reset();
    const outside = await runFileOperation("/etc/hosts", { op: "rename", name: "hosts" }, { roots });
    assert.equal(outside.ok, false);
    assert.equal(outside.code, "NOT_FOUND");

    const escape = at("link-out");
    await fs.symlink(os.tmpdir(), escape, "dir");
    const throughLink = await runFileOperation(escape, { op: "rename", name: "gone" }, { roots });
    assert.equal(throughLink.ok, false, "a link out of the root is not a path in it");
    assert.equal(throughLink.code, "NOT_FOUND");
    await fs.rm(escape, { recursive: true, force: true });

    const pasteOutside = await runFileOperation(at("notes.txt"), { op: "copy", targetDirectory: os.tmpdir() }, { roots });
    assert.equal(pasteOutside.ok, false);
    assert.equal(pasteOutside.code, "DENIED");
  });

  it("never touches a protected path", async () => {
    await reset();
    await fs.mkdir(at(".git"), { recursive: true });
    await fs.writeFile(at(".git", "config"), "[core]\n");
    const result = await runFileOperation(at(".git", "config"), { op: "rename", name: "config2" }, { roots });
    assert.equal(result.ok, false);
    assert.equal(result.code, "DENIED");
    assert.equal(await fs.readFile(at(".git", "config"), "utf8"), "[core]\n");
    await fs.rm(at(".git"), { recursive: true, force: true });
  });

  it("refuses to delete a project folder", async () => {
    const result = await runFileOperation(root, { op: "delete" }, { roots });
    assert.equal(result.ok, false);
    assert.equal(result.code, "DENIED");
    assert.ok((await fs.stat(root)).isDirectory());
  });

  it("asks for a name where a name is what the operation needs", async () => {
    const noName = await runFileOperation(at("folder"), { op: "create" }, { roots });
    assert.equal(noName.ok, false);
    assert.equal(noName.code, "BAD_REQUEST");

    const badName = await runFileOperation(at("folder"), { op: "create", name: "a/b" }, { roots });
    assert.equal(badName.ok, false);
    assert.equal(badName.code, "INVALID_NAME");
  });
});
