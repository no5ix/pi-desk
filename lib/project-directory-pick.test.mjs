import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// The browser half of the native Finder pick. It is a client module (it checks for a
// window), so the tests stub a window and the fetches.
//
// The answer is a status, because the caller has to tell the two non-picks apart:
// Cancel in the Finder panel ends the flow, while a server that cannot show a panel is
// the reason to fall back to the in-app typed picker. Reporting both as "nothing" made
// Cancel open a typed picker over the chat.

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
  assert.deepEqual(
    await pickProjectDirectoryFromServer({ prompt: "Choose a project folder", cwd: "/Users/lynx/repos/pi-desk" }),
    { status: "picked", cwd: "/Users/lynx/Downloads/new-project" });
  assert.deepEqual(calls[0].body, { prompt: "Choose a project folder", cwd: "/Users/lynx/repos/pi-desk" },
    "the prompt and the current folder go out: the panel opens beside the current project");
  assert.deepEqual(calls.map((call) => call.url), ["/api/cwd/pick", "/api/cwd/validate"]);
  assert.deepEqual(calls[1].body, { cwd: "/Users/lynx/Downloads/new-project" },
    "the path is validated exactly like the Tauri pick, so it enters the file allow-list");
});

test("Cancel is a decision: cancelled, with no validation and no fallback", async () => {
  const calls = scenario(() => json({ cancelled: true }));
  assert.deepEqual(await pickProjectDirectoryFromServer(), { status: "cancelled" });
  assert.deepEqual(calls.map((call) => call.url), ["/api/cwd/pick"],
    "a dismissed panel asks the server for nothing further");
});

test("a panel already open is cancelled too — the user is looking at it", async () => {
  const calls = scenario(() => json({ error: "A folder panel is already open." }, 409));
  assert.deepEqual(await pickProjectDirectoryFromServer(), { status: "cancelled" });
  assert.deepEqual(calls.map((call) => call.url), ["/api/cwd/pick"]);
});

test("a server that cannot show a panel reports it, so the typed picker can appear", async () => {
  for (const handler of [
    () => json({ error: "Native folder picking is only available on macOS." }, 501),
    () => json({ error: "Folder picking is only available on the computer running Pi." }, 403),
    () => json({}, 500),
    () => json({}),
    () => Promise.reject(new Error("offline")),
  ]) {
    scenario(handler);
    const result = await pickProjectDirectoryFromServer();
    assert.equal(result.status, "unavailable");
    assert.ok(typeof result.reason === "string" && result.reason.length > 0, "the reason is reported, not swallowed");
  }
});

test("without a hint the pick request carries nothing, so the server opens at home", async () => {
  const calls = scenario(() => json({ cwd: "/Users/lynx/x" }));
  assert.deepEqual(await pickProjectDirectoryFromServer(), { status: "picked", cwd: "/Users/lynx/x" });
  assert.deepEqual(calls[0].body, {}, "an empty object, not a stray prompt or cwd");
});

test("a folder the server will not accept is not adopted", async () => {
  scenario((url) =>
    url.includes("/api/cwd/pick")
      ? json({ cwd: "/System/Volumes" })
      : json({ error: "Not a directory" }, 400));
  const result = await pickProjectDirectoryFromServer();
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "Not a directory");
});

test("without a window (a server render) the picker is not called", async () => {
  delete globalThis.window;
  globalThis.fetch = () => { throw new Error("must not fetch during a server render"); };
  assert.equal((await pickProjectDirectoryFromServer()).status, "unavailable");
});

test("Add project distinguishes the outcomes in the sidebar", async () => {
  const { readFileSync } = await import("node:fs");
  const sidebar = readFileSync(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8");
  const handler = sidebar.match(/const handleAddProject = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)[0];
  assert.match(handler, /const picked = await pickProjectDirectoryFromServer\(\{\n\s*prompt: t\("sidebar\.addProjectPrompt"\),\n\s*cwd: selectedCwd \|\| homeDir \|\| undefined,\n\s*\}\);/,
    "the panel is told where the sidebar is sitting");
  assert.match(handler, /if \(projectPickBusy\) return;\n\s*setProjectPickBusy\(true\);/, "one panel per click");
  assert.match(handler, /\} finally \{\n\s*setProjectPickBusy\(false\);\n\s*\}/, "and the button stops showing progress when the panel answers");
  assert.match(handler, /if \(picked\.status === "picked"\) \{\n\s*activateProject\(picked\.cwd\);\n\s*return;\n\s*\}/);
  assert.match(handler, /if \(picked\.status === "unavailable"\) setProjectPickerOpen\(true\);/,
    "only a server with no native panel opens the typed picker");
  const buttons = sidebar.match(/className=\{`sidebar-project-tree-add\$\{projectPickBusy \? " is-busy" : ""\}`\}\n\s*onClick=\{\(\) => void handleAddProject\(\)\}\n\s*disabled=\{projectPickBusy\}\n\s*aria-busy=\{projectPickBusy\}/);
  assert.ok(buttons, "the button shows that the native panel is open");
  const webBranch = handler.split("isTauriDesktop()")[1].split("try {")[0];
  assert.ok(!/\n\s*setProjectPickerOpen\(true\);\n\s*return;/.test(webBranch),
    "a cancelled panel opens nothing: only the `unavailable` branch, guarded, opens the typed picker");
});
