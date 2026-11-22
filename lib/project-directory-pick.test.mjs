import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

// Adopting the folder chosen in the app's folder window ("Add project" in a browser tab).
// The window answers with a path; this module is only the validation step, the same
// /api/cwd/validate call every other project adoption goes through — it probes permissions
// (macOS TCC denies Desktop, Documents, Downloads) and it is the route that grants file
// access. Nothing is adopted on the dialog's authority.

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { chooseProjectDirectory } = await jiti.import("./project-directory-pick.ts");

const sidebar = readFileSync(new URL("../components/SessionSidebar.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const savedWindow = globalThis.window;
const savedFetch = globalThis.fetch;

function stubFetch(handler) {
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

test("the chosen folder is validated, and the server's path is what gets adopted", async () => {
  const calls = stubFetch(() => json({ cwd: "/Users/lynx/repos/pi-desk", projectRoot: "/Users/lynx/repos/pi-desk" }));
  assert.deepEqual(await chooseProjectDirectory("  /Users/lynx/repos/pi-desk  "),
    { status: "picked", cwd: "/Users/lynx/repos/pi-desk" });
  assert.deepEqual(calls, [{ url: "/api/cwd/validate", body: { cwd: "/Users/lynx/repos/pi-desk" } }],
    "the same validation the desktop and typed pickers use, so permissions and the allow-list apply");
});

test("a refusal is a reason for the window, not a dead end", async () => {
  stubFetch(() => json({ error: "Permission denied: /Users/lynx/Desktop" }, 403));
  const refused = await chooseProjectDirectory("/Users/lynx/Desktop");
  assert.equal(refused.status, "unavailable");
  assert.equal(refused.reason, "Permission denied: /Users/lynx/Desktop", "shown inside the window, so the user can go up a level");

  stubFetch(() => json({}, 500));
  assert.match((await chooseProjectDirectory("/tmp/x")).reason, /refused \(500\)/);

  stubFetch(() => Promise.reject(new Error("offline")));
  assert.equal((await chooseProjectDirectory("/tmp/x")).reason, "offline");
});

test("an empty path asks the server nothing, and a server render has no server", async () => {
  const calls = stubFetch(() => json({ cwd: "/tmp/x" }));
  for (const cwd of ["", "   ", null, undefined]) {
    assert.equal((await chooseProjectDirectory(cwd)).status, "unavailable");
  }
  assert.deepEqual(calls, []);

  delete globalThis.window;
  assert.equal((await chooseProjectDirectory("/tmp/x")).status, "unavailable");
});

// --- the sidebar wiring -----------------------------------------------------------------

test("Add project opens the app's window, in a click, not after a round trip", () => {
  const handler = sidebar.match(/const handleAddProject = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)[0];
  assert.match(handler, /if \(!isTauriDesktop\(\)\) \{[\s\S]*?setProjectPickError\(null\);\n\s*setProjectFolderOpen\(true\);\n\s*return;\n\s*\}/,
    "the window is React state: it is there on the next paint, like the composer's file panel is");
  assert.ok(!handler.includes("fetch") && !handler.includes("/api/"),
    "the click talks to nobody, so it cannot stall");
  assert.ok(!handler.includes("setProjectPickerOpen"),
    "the typed picker is not the answer to a click on Add project");
});

test("the window is the shared folder picker, titled for this job", () => {
  const dialog = sidebar.match(/\{\/\*\n\s*\* The web "Add project" window[\s\S]*?\{projectFolderOpen && \(\n\s*<DirectoryPicker\n([\s\S]*?)\n\s*\/>\n\s*\)\}/);
  assert.ok(dialog, "the dialog is rendered from a single open flag");
  const props = dialog[1];
  assert.match(props, /title=\{t\("sidebar\.chooseFolderTitle"\)\}/, "titled Choose folder, not Choose Files to Upload");
  assert.match(props, /initialPath=\{selectedCwd \|\| homeDir \|\| undefined\}/, "it starts beside the project in use");
  assert.match(props, /busy=\{projectPickBusy\}\n\s*error=\{projectPickError\}/, "the validation state and its message live in the window");
  assert.match(props, /onSelect=\{\(cwd\) => void handleProjectFolderSelect\(cwd\)\}/);
  assert.match(props, /onCancel=\{\(\) => \{\n\s*setProjectFolderOpen\(false\);\n\s*setProjectPickError\(null\);\n\s*\}\}/,
    "Cancel closes and forgets; nothing is adopted, nothing is left open");
});

test("the chosen folder is adopted only once the server accepts it", () => {
  const select = sidebar.match(/const handleProjectFolderSelect = useCallback\(async \(cwd: string\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/)[0];
  assert.match(select, /const picked = await chooseProjectDirectory\(cwd\);/, "validation first");
  assert.match(select, /if \(picked\.status === "picked"\) \{\n\s*setProjectFolderOpen\(false\);\n\s*setProjectPickError\(null\);\n\s*activateProject\(picked\.cwd\);/,
    "adopt and close, in that order");
  const failure = select.match(/\n      \/\/[\s\S]*?\n      setProjectPickError\(picked\.reason\);/) ?? "";
  assert.ok(!failure.includes("setProjectFolderOpen\(false\)"),
    "a refused folder leaves the window open so the user can go up a level and choose again");
  assert.match(select, /finally \{\n\s*setProjectPickBusy\(false\);\n\s*\}/);
});

test("the folder panel of lib/apple-script.ts and the file-input pick are gone from the sidebar", () => {
  assert.ok(!sidebar.includes("/api/cwd/pick"), "no native panel request from a click");
  assert.ok(!sidebar.includes("pickProjectDirectoryFromServer"), "its client helper is gone too");
  assert.ok(!sidebar.includes("webkitdirectory"),
    "the file input's panel is a file chooser titled Choose Files to Upload, and it reports no folder path");
  assert.match(sidebar, /title=\{t\(projectPickBusy \? "sidebar\.checkingFolder" : "sidebar\.addProject"\)\}/,
    "while the folder is being checked, the button says what it is doing");
});
