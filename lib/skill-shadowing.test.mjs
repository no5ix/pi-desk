import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// pi keeps one skill per name, so a project copy of a global skill and the
// global file never appear together in the loader's list. The panel shows both
// and says which one this project runs; these tests drive that supplement with
// real folders.

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { addShadowedSkills } = await jiti.import("./skill-shadowing.ts");

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-skill-shadowing-")));
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

function fixture(label, { globalName = "mg", globalDisabled = true, projectName = "mg", projectDisabled = false, linkProjectToGlobal = false } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(base, label + "-")));
  const agentDir = path.join(root, "agent");
  const cwd = path.join(root, "project");
  const globalDir = path.join(agentDir, "skills", globalName);
  const projectDir = path.join(cwd, ".pi", "skills", projectName);
  fs.mkdirSync(globalDir, { recursive: true });
  fs.writeFileSync(
    path.join(globalDir, "SKILL.md"),
    `---\nname: ${globalName}\ndescription: Global.\n${globalDisabled ? "disable-model-invocation: true\n" : ""}---\n\nGlobal.\n`,
  );
  if (linkProjectToGlobal) {
    fs.mkdirSync(path.join(cwd, ".pi", "skills"), { recursive: true });
    fs.symlinkSync(globalDir, projectDir, "junction");
  } else {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "SKILL.md"),
      `---\nname: ${projectName}\ndescription: Project.\n${projectDisabled ? "disable-model-invocation: true\n" : ""}---\n\nProject.\n`,
    );
  }
  return { cwd, agentDir, globalFile: path.join(globalDir, "SKILL.md"), projectFile: path.join(projectDir, "SKILL.md") };
}

function entry(filePath, { scope, disabled }) {
  return {
    name: "mg",
    description: scope === "project" ? "Project." : "Global.",
    filePath,
    baseDir: path.dirname(filePath),
    disableModelInvocation: disabled,
    sourceInfo: { scope, source: "local" },
  };
}

test("the global file a project copy hides comes back, with the project marked as the winner", () => {
  const f = fixture("project-wins", { globalDisabled: true, projectDisabled: false });
  const loaded = [entry(f.projectFile, { scope: "project", disabled: false })];

  const out = addShadowedSkills(loaded, { cwd: f.cwd, agentDir: f.agentDir });
  assert.equal(out.length, 2);
  const project = out.find((skill) => skill.sourceInfo.scope === "project");
  const global = out.find((skill) => skill.sourceInfo.scope === "user");
  assert.equal(global.filePath, f.globalFile);
  assert.equal(global.disableModelInvocation, true, "the global row reports the global file's own switch");
  assert.equal(project.disableModelInvocation, false);
  assert.equal(project.skillCollision.winner, "project");
  assert.equal(global.skillCollision.winner, "project");
});

test("the project copy a global file hides comes back as a project row", () => {
  const f = fixture("global-wins", { globalDisabled: false, projectDisabled: true });
  const loaded = [entry(f.globalFile, { scope: "user", disabled: false })];

  const out = addShadowedSkills(loaded, { cwd: f.cwd, agentDir: f.agentDir });
  assert.equal(out.length, 2);
  const project = out.find((skill) => skill.sourceInfo.scope === "project");
  assert.equal(project.filePath, f.projectFile);
  assert.equal(project.disableModelInvocation, true, "the project row reports the project file's switch");
  assert.equal(project.skillCollision.winner, "global", "this project's sessions follow the global skill");
  assert.equal(out.find((skill) => skill.filePath === f.globalFile).skillCollision.winner, "global");
});

test("a skill with no twin is returned untouched", () => {
  const f = fixture("solo", { projectName: "other" });
  const loaded = [entry(f.globalFile, { scope: "user", disabled: true })];
  const out = addShadowedSkills(loaded, { cwd: f.cwd, agentDir: f.agentDir });
  assert.equal(out, loaded, "no collision, no copy, no new array");
  assert.equal(loaded[0].skillCollision, undefined);
});

test("a project link to the global folder shows both rows, and says the file is shared", () => {
  const f = fixture("link", { linkProjectToGlobal: true });
  // The loader reports the file once, under the path it reached it by: the
  // project link. The global file is the same bytes, so it is not a second
  // skill today — but the panel must show it, and say why its switch is shared.
  const loaded = [entry(f.projectFile, { scope: "project", disabled: true })];
  const out = addShadowedSkills(loaded, { cwd: f.cwd, agentDir: f.agentDir });
  assert.equal(out.length, 2);
  const global = out.find((skill) => skill.filePath === f.globalFile);
  assert.ok(global, JSON.stringify(out));
  assert.equal(global.skillCollision?.linkedToGlobal, true);
  assert.equal(out.find((skill) => skill.filePath === f.projectFile)?.skillCollision?.linkedToGlobal, true);
  assert.equal(global.disableModelInvocation, true, "both rows read the one file's switch");
});

test("an untrusted project's own skill is not put back on the list", () => {
  const f = fixture("untrusted", { projectDisabled: true });
  const loaded = [entry(f.globalFile, { scope: "user", disabled: false })];
  const out = addShadowedSkills(loaded, { cwd: f.cwd, agentDir: f.agentDir, projectDirs: [] });
  assert.equal(out, loaded, "trust decides what the panel may show, as it decides what loads");
});
