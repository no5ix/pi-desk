import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { appleScriptString, appleScriptCancelled, folderPanelScript, folderPanelLocation } =
  await createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false })
    .import("./apple-script.ts");

// Both native bridges (the folder panel and the notification) build AppleScript source,
// and the user's text is inside it. The routes are the callers; these helpers are the
// part that can corrupt the source — and the part that decides whether the panel behaves
// like the browser's own (lib/apple-script.ts: folderPanelScript).

test("an AppleScript string literal escapes the two characters that end it", () => {
  assert.equal(appleScriptString("plain"), `"plain"`);
  assert.equal(appleScriptString('He said "done"'), '"He said \\"done\\""');
  assert.equal(appleScriptString("a\\b"), '"a\\\\b"');
  assert.equal(appleScriptString(""), `""`);
  // The classic escape-out: an unescaped quote would let the value run a statement.
  assert.equal(appleScriptString('x" with title "y'), '"x\\" with title \\"y"');
});

test("a dismissed AppleScript panel is recognised, not an error", () => {
  assert.equal(appleScriptCancelled('48:72: execution error: User canceled. (-128)'), true);
  assert.equal(appleScriptCancelled("user canceled"), true);
  assert.equal(appleScriptCancelled("-128"), true);
  assert.equal(appleScriptCancelled("execution error: Can’t get folder (−1728)"), false, "a real failure stays a failure");
  assert.equal(appleScriptCancelled(""), false);
});

test("the panel is shown by System Events, so nothing in the Dock wakes and the panel is key", () => {
  const script = folderPanelScript({ prompt: "Choose a project folder" });
  assert.ok(!script.includes('"Finder"'),
    "Finder's panel activates Finder: the desktop flashes forward and the page loses focus");
  const panel = script.match(/tell application "System Events"\n    activate\n    set chosenItem to ([^\n]*)/);
  assert.ok(panel, "System Events activates, so the panel is the key window: the keyboard is its, as in the browser's own panel");
  assert.equal(panel[1], 'choose folder of (defaultLocation) with prompt "Choose a project folder"',
    "the location comes before the prompt: a trailing `of` parses as possession of the string (-1723)");
  assert.match(script, /return POSIX path of chosenItem/, "the route answers with an absolute POSIX path");
  // Running the panel from osascript alone leaves it non-key (a background-only process),
  // which is why the command sits inside the tell block.
  assert.ok(!/^set chosenItem to/m.test(script));
});

test("the browser gets the front back on both exits, and a cancel is still a cancel", () => {
  const script = folderPanelScript({ prompt: "Choose a project folder" });
  assert.match(script, /on restoreFront\(frontApp\)[\s\S]*set frontmost of application process frontApp to true[\s\S]*end restoreFront/);
  // Once for the answer (top level), once for the cancel (inside the try).
  assert.equal(script.split("\n").filter((line) => line.trim() === "restoreFront(frontApp)").length, 2);
  const cancel = script.match(/on error number -128([\s\S]*?)end try/)[1];
  assert.match(cancel, /restoreFront\(frontApp\)/, "cancelling leaves the page frontmost, as the panel did nothing");
  assert.match(cancel, /error number -128/, "and re-raises, so the route reports a cancel and the client opens nothing");
});

test("the frontmost lookups sit in try blocks, so a missing Accessibility permission is not a failure", () => {
  const script = folderPanelScript({ prompt: "x" });
  const lines = script.split("\n").map((line) => line.trim());
  for (const [index, line] of lines.entries()) {
    if (!/application process/.test(line)) continue;
    const before = lines.slice(0, index);
    assert.ok(before.lastIndexOf("try") > before.lastIndexOf("end try"),
      `the permission-dependent call on line ${index + 1} is guarded: ${line}`);
  }
  assert.match(script, /set frontApp to name of first application process whose frontmost is true/);
});

test("the prompt is a literal, so the page cannot write statements", () => {
  const script = folderPanelScript({ prompt: 'x" with title "y' });
  assert.match(script, /with prompt "x\\" with title \\"y"/);
  assert.ok(!/\nset /.test(script.split("with prompt")[1].split("\n")[0]), "the value cannot escape its quotes onto its own line");
});

test("the panel opens where the projects are, and only when the hint is real", async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const root = await mkdtemp(`${tmpdir()}/pi-pick-`);
  try {
    await mkdir(`${root}/projects`);
    await mkdir(`${root}/projects/current`);
    assert.equal(folderPanelLocation(`${root}/projects/current`), `${root}/projects`,
      "the folder that holds the current project, so a sibling is one click away");
    // A file inside a project is a plausible hint too; its folder is the useful place.
    await writeFile(`${root}/projects/current/notes.md`, "x");
    assert.equal(folderPanelLocation(`${root}/projects/current/notes.md`), `${root}/projects/current`,
      "a file inside a project opens the folder that holds it");
    assert.equal(folderPanelLocation(`${root}/gone/nowhere`), undefined, "a path whose parent is not there opens nothing special");
    assert.equal(folderPanelLocation("relative/path"), undefined, "never a relative path");
    assert.equal(folderPanelLocation(""), undefined);
    assert.equal(folderPanelLocation(undefined), undefined);
    assert.equal(folderPanelLocation(42), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("without a usable hint the script opens at the home folder", () => {
  const plain = folderPanelScript({ prompt: "x" });
  assert.match(plain, /set defaultLocation to \(path to home folder\)/);
  assert.ok(!plain.includes("POSIX file"), "no location line at all when the caller has no hint");
  const located = folderPanelScript({ prompt: "x", defaultPath: "/Users/lynx/projects" });
  assert.match(located, /try\n  set defaultLocation to \(POSIX file "\/Users\/lynx\/projects"\) as alias\nend try/,
    "a bad path keeps the home folder: the panel always opens");
});
