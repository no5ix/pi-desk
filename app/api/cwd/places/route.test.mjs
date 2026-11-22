import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("./route.ts");
const { NextRequest } = await jiti.import("next/server");

/**
 * GET /api/cwd/places: the folder window's rail. The standard places come from the
 * server's own home, and the paths the panel remembers (its favourites and recents)
 * come back with exists/readable, so a folder that is gone is shown as gone.
 */
function placesRequest(paths = []) {
  const params = new URLSearchParams();
  for (const item of paths) params.append("path", item);
  const query = params.toString();
  return new NextRequest(`http://localhost/api/cwd/places${query ? `?${query}` : ""}`);
}

test("the standard places, read from this computer", async () => {
  const response = await GET(placesRequest());
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.places.map((place) => place.id), ["home", "documents", "desktop", "downloads"]);
  assert.equal(data.places[0].path, await (await jiti.import("node:fs/promises")).realpath(homedir()));
  assert.equal(data.places[0].exists, true);
  assert.ok(data.directories, "the caller's list is answered, empty when nothing was sent");
  assert.deepEqual(data.directories, []);
});

test("the remembered folders are reported as they are now", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pi-places-route-"));
  try {
    const kept = path.join(root, "kept");
    await mkdir(kept);
    const gone = path.join(root, "gone");
    const response = await GET(placesRequest([kept, gone]));
    assert.equal(response.status, 200);
    const data = await response.json();
    const byPath = new Map(data.directories.map((item) => [item.path, item]));
    assert.equal(byPath.get(kept).exists, true);
    assert.equal(byPath.get(kept).readable, true);
    assert.equal(byPath.get(gone).exists, false);
    assert.equal(byPath.get(gone).readable, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a remembered folder the process cannot read is reported unreadable", async (t) => {
  if (process.platform === "win32") return t.skip("chmod does not restrict reads on Windows");
  const root = await mkdtemp(path.join(tmpdir(), "pi-places-route-"));
  try {
    const denied = path.join(root, "denied");
    await mkdir(denied);
    await chmod(denied, 0o000);
    const data = await (await GET(placesRequest([denied]))).json();
    assert.equal(data.directories[0].exists, true);
    assert.equal(data.directories[0].readable, false);
  } finally {
    await chmod(path.join(root, "denied"), 0o755);
    await rm(root, { recursive: true, force: true });
  }
});

test("the list a caller sends cannot grow the work the route does", async () => {
  const many = Array.from({ length: 200 }, (_unused, index) => path.join(tmpdir(), `pi-places-${index}`));
  const data = await (await GET(placesRequest(many))).json();
  assert.ok(data.directories.length <= 32, `bounded answer, got ${data.directories.length}`);
});
