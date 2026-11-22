import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { isReadableDirectory, listStandardPlaces, reportDirectories, REPORTED_PATHS_MAX, STANDARD_PLACE_DIRS } from "./directory-places.ts";
import { userHome } from "./user-home.ts";

/**
 * The folder window's left rail is read off the server's own disk
 * (lib/directory-places.ts, answered by GET /api/cwd/places). What matters is that a
 * place says what it is — home, Documents, Desktop, Downloads — and that a folder the
 * process cannot open (macOS TCC, POSIX modes) is reported as such, so the window
 * never offers a row that opens on a refusal.
 */

test("the four places, under the home that was asked for", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-places-"));
  try {
    const home = path.join(root, "home");
    await mkdir(path.join(home, "Documents"), { recursive: true });
    const places = await listStandardPlaces(home);
    assert.deepEqual(places.map((place) => place.id), ["home", "documents", "desktop", "downloads"]);
    assert.equal(places[0].path, await realpath(home));
    assert.equal(places[0].exists, true);
    assert.equal(places[0].readable, true);
    assert.equal(places[1].path, path.join(await realpath(home), "Documents"));
    assert.equal(places[1].exists, true);
    assert.equal(places[2].exists, false, "no Desktop here, and the rail is told so");
    assert.equal(places[2].readable, false);
    assert.equal(places.length, STANDARD_PLACE_DIRS.length + 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a folder the process may not read is a place that is not openable", async (t) => {
  if (process.platform === "win32") return t.skip("chmod does not restrict reads on Windows");
  const root = await mkdtemp(path.join(tmpdir(), "pi-places-"));
  try {
    const home = path.join(root, "home");
    const documents = path.join(home, "Documents");
    await mkdir(documents, { recursive: true });
    await chmod(documents, 0o000);
    const places = await listStandardPlaces(home);
    const documentsPlace = places.find((place) => place.id === "documents");
    assert.equal(documentsPlace.exists, true, "the folder is there");
    assert.equal(documentsPlace.readable, false, "and this process may not open it");
    assert.equal(await isReadableDirectory(home), true);
  } finally {
    await chmod(path.join(root, "home", "Documents"), 0o755);
    await rm(root, { recursive: true, force: true });
  }
});

test("the remembered paths are answered once, deduped and capped", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-places-"));
  try {
    const kept = path.join(root, "kept");
    await mkdir(kept);
    const missing = path.join(root, "gone");
    const report = await reportDirectories([kept, ` ${kept} `, missing, ""]);
    assert.deepEqual(report.map((item) => item.path), [kept, missing], "one entry per folder, blanks dropped");
    assert.equal(report[0].exists, true);
    assert.equal(report[0].readable, true);
    assert.equal(report[1].exists, false);
    assert.equal(report[1].readable, false);

    const many = Array.from({ length: REPORTED_PATHS_MAX + 12 }, (_unused, index) => path.join(root, `d${index}`));
    assert.equal((await reportDirectories(many)).length, REPORTED_PATHS_MAX, "a route that reads the filesystem stays bounded");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the real home is the first place, so the rail opens where people are", async () => {
  const places = await listStandardPlaces();
  assert.equal(places[0].id, "home");
  assert.equal(places[0].path, await realpath(userHome()));
  assert.equal(places[0].exists, true);
  assert.equal(places[0].readable, true);
});

test("a home that is itself a link resolves to one folder", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-places-"));
  try {
    const real = path.join(root, "real-home");
    await mkdir(path.join(real, "Downloads"), { recursive: true });
    const link = path.join(root, "link-home");
    await writeFile(path.join(root, "marker"), "x");
    const { symlink } = await import("node:fs/promises");
    await symlink(real, link, "dir");
    const places = await listStandardPlaces(link);
    assert.equal(places[0].path, await realpath(real));
    const downloads = places.find((place) => place.id === "downloads");
    assert.equal(downloads.exists, true);
    assert.equal(downloads.path, path.join(await realpath(real), "Downloads"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
