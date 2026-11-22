import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { linkDirectory } from "../scripts/test-platform.mjs";

async function loadSubject() {
  return import("./directory-browser.ts");
}

test("lists directories and directory symlinks without returning files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-browse-"));
  try {
    await mkdir(path.join(root, "project"));
    await writeFile(path.join(root, "notes.txt"), "test", "utf8");
    await linkDirectory(path.join(root, "project"), path.join(root, "linked-project"));

    const { listDirectories } = await loadSubject();
    const directories = await listDirectories(root);

    assert.deepEqual(directories.map((entry) => entry.name), ["linked-project", "project"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expands home-relative paths and rejects missing directories", async () => {
  const {
    getBrowseStartDirectory,
    normalizeDirectory,
    resolveDirectory,
    shouldShowWindowsDrivePicker,
  } = await loadSubject();
  assert.equal(getBrowseStartDirectory(), homedir());
  assert.equal(getBrowseStartDirectory("/project"), "/project");
  assert.equal(shouldShowWindowsDrivePicker(undefined, "win32"), true);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "darwin"), false);
  assert.equal(shouldShowWindowsDrivePicker(undefined, "linux"), false);
  assert.equal(shouldShowWindowsDrivePicker("C:\\Projects", "win32"), false);
  assert.equal(normalizeDirectory("~/project"), path.join(homedir(), "project"));
  await assert.rejects(resolveDirectory(path.join(tmpdir(), `pi-web-missing-${Date.now()}`)));
});

test("builds every Windows drive-letter candidate", async () => {
  const { getWindowsDriveCandidates } = await loadSubject();
  const drives = getWindowsDriveCandidates();

  assert.equal(drives.length, 26);
  assert.deepEqual(drives[0], { name: "A:", path: "A:\\" });
  assert.deepEqual(drives.at(-1), { name: "Z:", path: "Z:\\" });
});

test("finds parent directories across POSIX and Windows paths", async () => {
  const { getParentDirectory } = await loadSubject();

  assert.equal(getParentDirectory("/Users/alex/project"), "/Users/alex");
  assert.equal(getParentDirectory("/"), null);
  assert.equal(getParentDirectory("C:\\Users\\Alex\\project"), "C:\\Users\\Alex");
  assert.equal(getParentDirectory("C:\\"), null);
});
test("classifies permission errors (EACCES/EPERM) distinctly from other fs errors", async () => {
  const { isPermissionError } = await loadSubject();

  const eacces = Object.assign(new Error("EACCES: permission denied, scandir '/x'"), { code: "EACCES" });
  const eperm = Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
  const enoent = Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });

  assert.equal(isPermissionError(eacces), true);
  assert.equal(isPermissionError(eperm), true);
  assert.equal(isPermissionError(enoent), false);
  assert.equal(isPermissionError(new Error("boom")), false);
  assert.equal(isPermissionError("EACCES"), false);
  assert.equal(isPermissionError(null), false);
});

test("permission message names the directory and points at Privacy & Security", async () => {
  const { directoryPermissionMessage } = await loadSubject();
  const message = directoryPermissionMessage("/Users/alex/Desktop");

  assert.ok(message.includes("/Users/alex/Desktop"));
  assert.match(message, /Privacy & Security|隐私与安全性/);
});


test("creates one direct child directory and returns its resolved path", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-create-directory-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const { createDirectory, resolveDirectory } = await loadSubject();
  const createdPath = await createDirectory(root, "new-project");

  assert.equal(createdPath, await resolveDirectory(path.join(root, "new-project")));
  await assert.rejects(createDirectory(root, "new-project"), { code: "EEXIST" });
});

test("new directory names cannot escape the current directory", async () => {
  const { isValidDirectoryName } = await loadSubject();

  assert.equal(isValidDirectoryName("project"), true);
  assert.equal(isValidDirectoryName("project name"), true);
  assert.equal(isValidDirectoryName(""), false);
  assert.equal(isValidDirectoryName("."), false);
  assert.equal(isValidDirectoryName(".."), false);
  assert.equal(isValidDirectoryName("../outside"), false);
  assert.equal(isValidDirectoryName("nested/directory"), false);
  assert.equal(isValidDirectoryName("nested\\directory"), false);
  assert.equal(isValidDirectoryName("bad\0name"), false);
});

test("every folder carries the time it last changed, so the list can be ordered by date", async () => {
  const { listDirectories } = await loadSubject();
  const root = await mkdtemp(path.join(tmpdir(), "pi-web-browse-"));
  try {
    const older = path.join(root, "older");
    const newer = path.join(root, "newer");
    await mkdir(older);
    await writeFile(path.join(older, "note"), "old");
    await mkdir(newer);
    await mkdir(path.join(newer, "inside"));
    await linkDirectory(newer, path.join(root, "linked"));

    const opened = Date.now();
    const entries = await listDirectories(root);
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    assert.ok(byName.get("older").mtime, "a plain folder reports its time");
    assert.equal(typeof byName.get("older").mtime, "number");
    assert.ok(byName.get("older").mtime <= opened + 1000, "the time is the folder's, not a clock ahead");
    assert.ok(byName.get("newer").mtime > byName.get("older").mtime,
      "the folder touched last sorts first when the panel orders by date");
    assert.ok(byName.get("linked").mtime, "a folder reached through a link reports the time it points at");

    const ordered = [...entries].sort((left, right) => (right.mtime ?? 0) - (left.mtime ?? 0));
    assert.equal(ordered[0].name, "linked", "the newest of the three comes first");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
