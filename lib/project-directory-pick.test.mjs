import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// The browser half of the native Finder pick. It is a client module (it checks for a
// window), so the tests stub a window and the fetches.

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { pickProjectDirectoryFromServer } = await jiti.import("./project-directory-pick.ts");

const savedWindow = globalThis.window;
const savedFetch = globalThis.fetch;

function scenario(handler) {
  const calls = [];
  globalThis.window = {};
  globalThis.fetch = (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(init.body) : undefined });
    return Promise.resolve(handler(String(input), init));
  };
  return calls;
}

function json(value, status = 200) {
  return { status, ok: status < 400, json: async () => value };
}

test.afterEach(() => {
  if (savedWindow === undefined) delete globalThis.window;
  else globalThis.window = savedWindow;
  if (savedFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = savedFetch;
});

test("the folder the server picked is validated before the client adopts it", async () => {
  const calls = scenario((url) =>
    url.includes("/api/cwd/pick")
      ? json({ cwd: "/Users/lynx/Downloads/new-project" })
      : json({ cwd: "/Users/lynx/Downloads/new-project", name: "new-project" }));
  assert.equal(await pickProjectDirectoryFromServer(), "/Users/lynx/Downloads/new-project");
  assert.deepEqual(calls.map((call) => call.url), ["/api/cwd/pick", "/api/cwd/validate"]);
  assert.deepEqual(calls[1].body, { cwd: "/Users/lynx/Downloads/new-project" },
    "the path is validated exactly like the Tauri pick, so it enters the file allow-list");
});

test("a dismissed panel is no path and no validation", async () => {
  const calls = scenario(() => json({ cancelled: true }));
  assert.equal(await pickProjectDirectoryFromServer(), null);
  assert.deepEqual(calls.map((call) => call.url), ["/api/cwd/pick"]);
});

test("a refused, failed, non-macOS or broken pick is no path", async () => {
  for (const handler of [
    () => json({ error: "Native folder picking is only available on macOS." }, 501),
    () => json({ error: "Folder picking is only available on the computer running Pi." }, 403),
    () => json({}, 500),
    () => json({}),
    () => Promise.reject(new Error("offline")),
  ]) {
    scenario(handler);
    assert.equal(await pickProjectDirectoryFromServer(), null);
  }
});

test("a folder the server will not accept is not adopted", async () => {
  scenario((url) =>
    url.includes("/api/cwd/pick")
      ? json({ cwd: "/System/Volumes" })
      : json({ error: "Not a directory" }, 400));
  assert.equal(await pickProjectDirectoryFromServer(), null,
    "the caller falls back to the in-app picker, where the path is validated too");
});

test("without a window (a server render) the picker is not called", async () => {
  delete globalThis.window;
  globalThis.fetch = () => { throw new Error("must not fetch during a server render"); };
  assert.equal(await pickProjectDirectoryFromServer(), null);
});
