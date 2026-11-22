import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createJiti } from "jiti";
import { getAgentDir, ProjectTrustStore } from "@earendil-works/pi-coding-agent";

// A project skill is the project's own copy of a skill: it reaches only this
// project's sessions, it sits behind the same project trust, and its switch is
// independent of the global skill's. These tests run against a temp
// PI_CODING_AGENT_DIR, and trust the folder only after it carries a skill —
// the same order the app's trust dialog produces.

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});

const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-project-skills-")));
const baseAgentDir = getAgentDir();
after(() => {
  process.env.PI_CODING_AGENT_DIR = baseAgentDir;
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function isolatedAgentDir(label) {
  const dir = path.join(tempRoot, label, "agent");
  fs.mkdirSync(dir, { recursive: true });
  process.env.PI_CODING_AGENT_DIR = dir;
  return dir;
}

function writeGlobalSkill(agentDir, name, { disabled = false } = {}) {
  const dir = path.join(agentDir, "skills", name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "SKILL.md");
  fs.writeFileSync(
    file,
    `---\nname: ${name}\ndescription: Global ${name}.\n${disabled ? "disable-model-invocation: true\n" : ""}---\n\nGlobal body.\n`,
  );
  // A helper file, so a copy that kept only SKILL.md would fail.
  fs.writeFileSync(path.join(dir, "helper.sh"), "echo helper\n");
  return file;
}

function makeProject(label) {
  return fs.realpathSync(fs.mkdtempSync(path.join(tempRoot, label + "-")));
}

async function trust(cwd) {
  const { trustProject } = await jiti.import("./project-trust.ts");
  return trustProject(cwd, process.env.PI_CODING_AGENT_DIR);
}

async function loadSkills(cwd) {
  const { loadSkillsWithInstallInfo } = await jiti.import("./skills-service.ts");
  return loadSkillsWithInstallInfo(cwd);
}

function skillState(file) {
  // True when the file says the skill is off for the model.
  return /disable-model-invocation:\s*true/.test(fs.readFileSync(file, "utf8"));
}

test("turning a skill on in a project copies it, and leaves the global skill alone", async () => {
  const agentDir = isolatedAgentDir("on");
  const globalFile = writeGlobalSkill(agentDir, "copy-skill", { disabled: true });
  const cwd = makeProject("on");
  const { installProjectSkill, projectSkillTarget } = await jiti.import("./project-skills.ts");

  const result = await installProjectSkill(cwd, "copy-skill", "on");
  await trust(cwd);
  const target = projectSkillTarget(cwd, "copy-skill");
  assert.equal(result.state, "on");
  assert.equal(result.files, 2, "the skill folder's files come along, not just SKILL.md");
  assert.equal(result.path, target.file);
  // A copy, never a link: the two files keep their own state.
  assert.equal(fs.lstatSync(target.dir).isSymbolicLink(), false);
  assert.equal(fs.realpathSync(target.file), target.file);
  assert.equal(fs.existsSync(path.join(target.dir, "helper.sh")), true);
  assert.equal(skillState(target.file), false, "the project asked for the skill on");
  assert.equal(skillState(globalFile), true, "the global skill stays disabled");

  const listed = (await loadSkills(cwd)).skills.filter((skill) => skill.name === "copy-skill");
  assert.equal(listed.length, 2, "both files stay on the panel's list");
  const project = listed.find((skill) => skill.sourceInfo?.scope === "project");
  const global = listed.find((skill) => skill.sourceInfo?.scope === "user");
  assert.ok(project && global, JSON.stringify(listed));
  assert.equal(project.disableModelInvocation, false);
  assert.equal(global.disableModelInvocation, true, "the global row keeps showing its own state");
  assert.equal(project.skillCollision?.winner, "project", "this project's sessions follow the project copy");
  assert.equal(global.skillCollision?.winner, "project");
});

test("turning a skill off in a project does not switch it off everywhere", async () => {
  const agentDir = isolatedAgentDir("off");
  const globalFile = writeGlobalSkill(agentDir, "quiet-skill");
  const cwd = makeProject("off");
  const { installProjectSkill, projectSkillTarget } = await jiti.import("./project-skills.ts");

  // The panel sends "off" for a skill the project has never carried: pi keeps
  // one skill per name, so the project gets its own copy, switched off.
  await installProjectSkill(cwd, "quiet-skill", "off");
  await trust(cwd);
  const target = projectSkillTarget(cwd, "quiet-skill");
  assert.equal(skillState(target.file), true);
  assert.equal(skillState(globalFile), false, "the global skill stays on for every other project");

  const listed = (await loadSkills(cwd)).skills.filter((skill) => skill.name === "quiet-skill");
  assert.equal(listed.length, 2);
  assert.equal(listed.find((skill) => skill.sourceInfo?.scope === "project")?.disableModelInvocation, true);
  assert.equal(listed.find((skill) => skill.sourceInfo?.scope === "user")?.disableModelInvocation, false);
});

test("flipping the project's switch never moves the global skill's switch", async () => {
  const agentDir = isolatedAgentDir("flip");
  const globalFile = writeGlobalSkill(agentDir, "flip-skill");
  const cwd = makeProject("flip");
  const { installProjectSkill, setProjectSkillState } = await jiti.import("./project-skills.ts");

  await installProjectSkill(cwd, "flip-skill", "on");
  await trust(cwd);
  const { findProjectSkill } = await jiti.import("./skill-roots.ts");
  setProjectSkillState(cwd, "flip-skill", "off");
  assert.equal(skillState(globalFile), false, "the global file is untouched by a project flip");
  assert.equal(skillState(findProjectSkill(cwd, "flip-skill").file), true, "the project's own copy is what went off");
  setProjectSkillState(cwd, "flip-skill", "on");
  assert.equal(skillState(findProjectSkill(cwd, "flip-skill").file), false);
  assert.equal(skillState(globalFile), false);
  assert.throws(() => setProjectSkillState(cwd, "never-added", "on"), { code: "not-in-project" });
});

test("removing a project skill keeps the global skill on disk and listed", async () => {
  const agentDir = isolatedAgentDir("remove");
  const globalFile = writeGlobalSkill(agentDir, "linked-skill");
  const cwd = makeProject("remove");
  const { installProjectSkill, removeProjectSkill } = await jiti.import("./project-skills.ts");

  const installed = await installProjectSkill(cwd, "linked-skill", "on");
  await trust(cwd);
  const removed = removeProjectSkill(cwd, "linked-skill");
  assert.equal(removed, path.dirname(installed.path));
  assert.equal(fs.existsSync(path.dirname(installed.path)), false);
  assert.equal(fs.existsSync(globalFile), true, "only the project's copy goes away");

  const listed = (await loadSkills(cwd)).skills.filter((skill) => skill.name === "linked-skill");
  assert.deepEqual(listed.map((skill) => skill.sourceInfo?.scope), ["user"], "the project follows the global skill again");
  assert.equal(listed[0].skillCollision, undefined);
  assert.throws(() => removeProjectSkill(cwd, "linked-skill"), { code: "not-in-project" });
});

test("a skill the user never installed cannot be turned on in a project", async () => {
  isolatedAgentDir("missing");
  const cwd = makeProject("missing");
  const { installProjectSkill } = await jiti.import("./project-skills.ts");
  await assert.rejects(() => installProjectSkill(cwd, "nope", "on"), { code: "skill-not-found" });
});

test("skill names stay one safe folder inside the project", async () => {
  const agentDir = isolatedAgentDir("names");
  writeGlobalSkill(agentDir, "safe-skill");
  const cwd = makeProject("names");
  const { installProjectSkill, isSafeSkillName, findProjectSkill, projectSkillTarget } = await jiti.import("./project-skills.ts");
  for (const name of ["../escape", "a/b", "..", ".hidden", "UPPER", "double--hyphen", ""]) {
    assert.equal(isSafeSkillName(name), false, name);
    await assert.rejects(() => installProjectSkill(cwd, name, "on"), (error) => error.code === "skill-not-found");
  }
  assert.equal(isSafeSkillName("my-skill-2"), true);
  // The write target is always the project's own skills folder.
  assert.equal(projectSkillTarget(cwd, "x").skillsDir, path.join(cwd, ".pi", "skills"));
  assert.equal(findProjectSkill(cwd, "../escape"), null);
});

test("a global skill the project copy hides is still found on disk", async () => {
  const agentDir = isolatedAgentDir("shadowed");
  const globalFile = writeGlobalSkill(agentDir, "shad-skill", { disabled: true });
  const cwd = makeProject("shadowed");
  const { installProjectSkill, findGlobalSkillByName } = await jiti.import("./project-skills.ts");

  // The project copy takes the name in its own sessions, so the global entry is
  // off the loader's list; the source lookup reads the folder instead.
  await installProjectSkill(cwd, "shad-skill", "on");
  const found = findGlobalSkillByName("shad-skill", { dirs: [{ dir: path.join(agentDir, "skills"), source: "user" }] });
  assert.equal(found.filePath, globalFile);
  assert.equal(found.disableModelInvocation, true);
});

test("an untrusted project's own skills stay unloaded, and are not offered back", async () => {
  const agentDir = isolatedAgentDir("trust");
  writeGlobalSkill(agentDir, "trust-skill");
  const cwd = makeProject("trust");
  const { installProjectSkill, projectSkillTarget } = await jiti.import("./project-skills.ts");

  const target = projectSkillTarget(cwd, "trust-skill");
  fs.mkdirSync(target.dir, { recursive: true });
  fs.writeFileSync(target.file, "---\nname: trust-skill\ndescription: Project.\n---\n\nProject body.\n");
  await trust(cwd);
  const trusted = (await loadSkills(cwd)).skills.find((skill) => skill.name === "trust-skill" && skill.sourceInfo?.scope === "project");
  assert.ok(trusted, "the project copy loads once the folder is trusted");

  new ProjectTrustStore(process.env.PI_CODING_AGENT_DIR).set(cwd, false);
  const notTrusted = await loadSkills(cwd);
  assert.equal(notTrusted.projectResourcesLoaded, false);
  assert.deepEqual(
    notTrusted.skills.filter((skill) => skill.name === "trust-skill").map((skill) => skill.sourceInfo?.scope),
    ["user"],
    "an untrusted project's copy is neither loaded nor put back on the list",
  );
});

test("a project skill left as a link becomes the project's own copy on the next switch", async () => {
  const agentDir = isolatedAgentDir("link-migrate");
  const globalFile = writeGlobalSkill(agentDir, "legacy-link", { disabled: true });
  const cwd = makeProject("link-migrate");
  const { installProjectSkill, isLinkedSkillEntry, findProjectSkill } = await jiti.import("./project-skills.ts");
  // An older build linked the global folder into the project, which made the
  // global row and the project row one file.
  fs.mkdirSync(path.join(cwd, ".pi", "skills"), { recursive: true });
  fs.symlinkSync(path.join(agentDir, "skills", "legacy-link"), path.join(cwd, ".pi", "skills", "legacy-link"), "junction");
  assert.equal(isLinkedSkillEntry(path.join(cwd, ".pi", "skills", "legacy-link")), true);

  const result = await installProjectSkill(cwd, "legacy-link", "on");
  await trust(cwd);
  const copy = findProjectSkill(cwd, "legacy-link");
  assert.equal(isLinkedSkillEntry(copy.dir), false, "the link is gone");
  assert.equal(fs.realpathSync(copy.file), copy.file, "the project's entry is a real file now");
  assert.equal(skillState(copy.file), false, "the project asked for the skill on");
  assert.equal(skillState(globalFile), true, "the global skill keeps its own state");
  assert.equal(fs.existsSync(globalFile), true, "taking the link away never took the global folder");
  assert.equal(result.files >= 1, true, "the copy came from the user's skill folder");
});
