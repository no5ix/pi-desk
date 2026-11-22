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
delete globalThis.__piAdditionalRoots;
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

function writeGlobalSkill(name) {
  const dir = path.join(process.env.PI_CODING_AGENT_DIR, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: A fixture skill.\n---\n\nBody.\n`);
  return dir;
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

test("the request names a skill, never a path, and writes inside the project", async () => {
  const skillDir = writeGlobalSkill("routed-skill");
  const cwd = makeProject();

  const response = await post({ cwd, name: "routed-skill" });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.path, path.join(cwd, ".pi", "skills", "routed-skill"));
  assert.equal(fs.existsSync(path.join(data.path, "SKILL.md")), true);
  assert.equal(fs.existsSync(path.join(skillDir, "SKILL.md")), true);
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

test("the same name twice is a conflict, and an unknown skill is not installed", async () => {
  writeGlobalSkill("twice-route");
  const cwd = makeProject();
  assert.equal((await post({ cwd, name: "twice-route" })).status, 200);

  const again = await post({ cwd, name: "twice-route" });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).reason, "target-exists");

  const unknown = await post({ cwd, name: "not-a-skill-here" });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).reason, "skill-not-found");
  assert.equal(fs.existsSync(path.join(cwd, ".pi", "skills", "not-a-skill-here")), false);
});

test("removing takes the project's entry and leaves the global skill alone", async () => {
  const skillDir = writeGlobalSkill("route-remove");
  const cwd = makeProject();
  const installed = await post({ cwd, name: "route-remove" });
  const target = (await installed.json()).path;

  const removed = await post({ cwd, name: "route-remove", action: "remove" });
  assert.equal(removed.status, 200);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.existsSync(path.join(skillDir, "SKILL.md")), true);

  const absent = await post({ cwd, name: "route-remove", action: "remove" });
  assert.equal(absent.status, 400);
  assert.equal((await absent.json()).reason, "not-in-project");
});
