import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// The source of a project skill is a skill this project already loads, so the
// fixture is a real agent dir with a global skill and a real project folder.
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-project-skills-")));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(base, "agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false,
});
const { installProjectSkill, isSafeSkillName, projectSkillsRoot, removeProjectSkill } = await jiti.import("./project-skills.ts");
const { loadSkillsWithInstallInfo } = await jiti.import("./skills-service.ts");
const { getProjectTrustStatus, trustProject } = await jiti.import("./project-trust.ts");

function writeGlobalSkill(name, body = `# ${name}\n\nDo the thing.\n`) {
  const dir = path.join(process.env.PI_CODING_AGENT_DIR, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: A fixture skill.\n---\n\n${body}`);
  fs.writeFileSync(path.join(dir, "reference.md"), "Detail the skill links to.\n");
  return dir;
}

function makeProject() {
  return fs.realpathSync(fs.mkdtempSync(path.join(base, "project-")));
}

test.after(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  fs.rmSync(base, { recursive: true, force: true });
});

test("the names this module may write and delete are single folder names", () => {
  assert.equal(isSafeSkillName("my-skill"), true);
  assert.equal(isSafeSkillName("skill.v2_x"), true);
  for (const name of ["../evil", "a/b", "..", ".hidden", "", " lead", "x".repeat(200)]) {
    assert.equal(isSafeSkillName(name), false, `${JSON.stringify(name)} is not a skill folder name`);
  }
});

test("turning a global skill on in a project writes it into .pi/skills", async () => {
  const skillDir = writeGlobalSkill("linked-skill");
  const cwd = makeProject();

  const result = await installProjectSkill(cwd, "linked-skill");
  assert.equal(result.ok, true);
  assert.equal(result.reason, undefined);
  assert.equal(result.target, path.join(projectSkillsRoot(cwd), "linked-skill"));
  assert.equal(fs.existsSync(path.join(result.target, "SKILL.md")), true);

  // The project carries the skill: pi discovers it as a project skill once the
  // project is trusted, and the global folder is the same folder (a link), so
  // its updates land here.
  assert.equal(getProjectTrustStatus(cwd, process.env.PI_CODING_AGENT_DIR).trusted, false);
  trustProject(cwd, process.env.PI_CODING_AGENT_DIR);
  const loaded = await loadSkillsWithInstallInfo(cwd);
  const project = loaded.skills.filter((skill) => skill.sourceInfo?.scope === "project" || skill.sourceInfo?.source === "project");
  assert.deepEqual(project.map((skill) => skill.name), ["linked-skill"]);
  assert.equal(fs.realpathSync(path.join(result.target, "SKILL.md")), fs.realpathSync(path.join(skillDir, "SKILL.md")));
});

test("turning it off deletes the project's entry and keeps the global skill", async () => {
  const skillDir = writeGlobalSkill("removable-skill");
  const cwd = makeProject();
  const installed = await installProjectSkill(cwd, "removable-skill");
  assert.equal(installed.ok, true);

  const removed = removeProjectSkill(cwd, "removable-skill");
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(installed.target), false);
  assert.equal(fs.existsSync(path.join(skillDir, "SKILL.md")), true, "the global skill survives");

  trustProject(cwd, process.env.PI_CODING_AGENT_DIR);
  const loaded = await loadSkillsWithInstallInfo(cwd);
  assert.equal(loaded.skills.filter((skill) => skill.sourceInfo?.scope === "project").length, 0);
});

test("a name the project already has, and an unknown name, are refused", async () => {
  writeGlobalSkill("twice");
  const cwd = makeProject();
  assert.equal((await installProjectSkill(cwd, "twice")).ok, true);
  const second = await installProjectSkill(cwd, "twice");
  assert.equal(second.ok, false);
  assert.equal(second.reason, "target-exists");

  const missing = await installProjectSkill(cwd, "never-installed");
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "skill-not-found");

  const traversal = await installProjectSkill(cwd, "../outside");
  assert.equal(traversal.ok, false);
  assert.equal(traversal.reason, "invalid-name");
  assert.equal(fs.existsSync(path.join(base, "outside")), false);
});

test("removing what the project does not carry says so, and touches nothing", async () => {
  const cwd = makeProject();
  const removed = removeProjectSkill(cwd, "absent");
  assert.equal(removed.ok, false);
  assert.equal(removed.reason, "not-in-project");
  assert.equal(fs.existsSync(projectSkillsRoot(cwd)), false);
});

test("the copy path keeps a skill's own files", async () => {
  const skillDir = writeGlobalSkill("copied-skill");
  const cwd = makeProject();
  const { copySkillTree } = await jiti.import("./project-skills.ts");
  const target = path.join(projectSkillsRoot(cwd), "copied-skill");
  copySkillTree(skillDir, target);
  assert.match(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), /name: copied-skill/);
  assert.match(fs.readFileSync(path.join(target, "reference.md"), "utf8"), /Detail the skill links to/);
});
