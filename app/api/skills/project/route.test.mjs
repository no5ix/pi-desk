import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-skills-project-route-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousRootsCache = globalThis.__piAllowedRootsCache;
const previousAdditionalRoots = globalThis.__piAdditionalAllowedRoots;
delete globalThis.__piAllowedRootsCache;
delete globalThis.__piAdditionalAllowedRoots;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false,
});
const { POST } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("@/lib/file-access.ts");

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  globalThis.__piAllowedRootsCache = previousRootsCache;
  globalThis.__piAdditionalAllowedRoots = previousAdditionalRoots;
  fs.rmSync(base, { recursive: true, force: true });
});

function writeGlobalSkill(name, { disabled = false } = {}) {
  const dir = path.join(process.env.PI_CODING_AGENT_DIR, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  fs.writeFileSync(
    file,
    `---\nname: ${name}\ndescription: A fixture skill.\n${disabled ? "disable-model-invocation: true\n" : ""}---\n\nBody.\n`,
  );
  return { dir, file };
}

function makeProject() {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(base, "project-")));
  allowFileRoot(cwd);
  return cwd;
}

function post(body) {
  return POST(new Request("http://localhost/api/skills/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function isOff(file) {
  return /disable-model-invocation:\s*true/.test(fs.readFileSync(file, "utf8"));
}

test("turning a skill on in a project copies it there, and names the file it wrote", async () => {
  const { dir: skillDir, file: globalFile } = writeGlobalSkill("routed-skill", { disabled: true });
  const cwd = makeProject();

  const response = await post({ cwd, name: "routed-skill" });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.action, "on");
  assert.equal(data.state, "on");
  assert.equal(data.copied, true);
  // The request named a skill; the write is inside the project's own skills folder.
  assert.equal(data.path, path.join(cwd, ".pi", "skills", "routed-skill", "SKILL.md"));
  assert.equal(fs.existsSync(data.path), true);
  assert.equal(isOff(data.path), false, "the project's copy is on");
  assert.equal(isOff(globalFile), true, "the global skill keeps its own state");
  assert.equal(fs.existsSync(path.join(skillDir, "SKILL.md")), true);
});

test("turning a skill off in a project writes only the project's copy", async () => {
  const { file: globalFile } = writeGlobalSkill("quiet-route");
  const cwd = makeProject();

  const off = await post({ cwd, name: "quiet-route", action: "off" });
  const data = await off.json();
  assert.equal(off.status, 200);
  assert.equal(data.state, "off");
  assert.equal(isOff(data.path), true);
  assert.equal(isOff(globalFile), false, "the global skill stays on for the other projects");

  // Flipping it back on moves the same file, not a second copy.
  const on = await (await post({ cwd, name: "quiet-route", action: "on" })).json();
  assert.equal(on.state, "on");
  assert.equal(on.copied, false, "the project's own copy is kept and re-flipped");
  assert.equal(isOff(globalFile), false);
});

test("an unallowed project, a relative folder, and a missing folder are refused", async () => {
  writeGlobalSkill("guarded-skill");
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(base, "outside-")));

  const denied = await post({ cwd: outside, name: "guarded-skill" });
  assert.equal(denied.status, 403);

  const relative = await post({ cwd: "relative/project", name: "guarded-skill" });
  assert.equal(relative.status, 400);

  // A folder that is not there is not an allowed root either: the answer is the
  // same refusal, and nothing is written.
  const gone = await post({ cwd: path.join(makeProject(), "nope"), name: "guarded-skill" });
  assert.equal(gone.status, 403);

  const malformed = await POST(new Request("http://localhost/api/skills/project", { method: "POST", body: "{" }));
  assert.equal(malformed.status, 400);
});

test("the action and the skill name are checked before anything is written", async () => {
  writeGlobalSkill("checked-skill");
  const cwd = makeProject();

  const badAction = await post({ cwd, name: "checked-skill", action: "explode" });
  assert.equal(badAction.status, 400);
  assert.equal((await badAction.json()).reason, "bad-request");

  for (const name of ["../escape", "Nested/Name", "double--hyphen"]) {
    const bad = await post({ cwd, name });
    assert.equal(bad.status, 400, name);
    assert.equal((await bad.json()).reason, "invalid-name", name);
  }
  assert.equal(fs.existsSync(path.join(cwd, ".pi", "skills")), false, "a refused request writes nothing");

  const unknown = await post({ cwd, name: "not-a-skill-here" });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).reason, "skill-not-found");
  assert.equal(fs.existsSync(path.join(cwd, ".pi", "skills", "not-a-skill-here")), false);
});

test("removing takes the project's copy and leaves the global skill alone", async () => {
  const { file: globalFile } = writeGlobalSkill("route-remove");
  const cwd = makeProject();
  const installed = await (await post({ cwd, name: "route-remove" })).json();
  const dir = path.dirname(installed.path);

  const removed = await post({ cwd, name: "route-remove", action: "remove" });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).removed, true);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(fs.existsSync(globalFile), true);

  const absent = await post({ cwd, name: "route-remove", action: "remove" });
  assert.equal(absent.status, 404);
  assert.equal((await absent.json()).reason, "not-in-project");

  // Turning it off for a project that follows the global skill gives it a copy.
  const off = await post({ cwd, name: "route-remove", action: "off" });
  assert.equal(off.status, 200);
  assert.equal(isOff((await off.json()).path), true);
  assert.equal(isOff(globalFile), false);
});
