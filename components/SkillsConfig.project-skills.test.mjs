import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");

test("a global skill is turned on in this project by name", () => {
  // The request carries the project folder and the skill's name: the server
  // resolves the source folder and writes it into <cwd>/.pi/skills. No path from
  // the browser is trusted.
  assert.match(source, /fetch\("\/api\/skills\/project", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON.stringify\(\{ cwd, name: skill\.name, action: enabled \? "add" : "remove" \}\),\s*\}\)/);
});

test("the list reloads after the write and lands on the project's copy", () => {
  const handler = source.slice(source.indexOf("const setSkillInProject"), source.indexOf("}, [cwd, loadSkills, t]);"));
  assert.match(handler, /const list = await loadSkills\(\);/);
  assert.match(handler, /sourceLabel\(entry\) === "project" && entry\.name === skill\.name/);
  assert.match(handler, /if \(added\) setSelected\(added\.filePath\);/);
  // A refusal is shown, not swallowed: the reason the server answered with.
  assert.match(handler, /data\.reason === "target-exists"\s*\?\s*t\("skills\.inProject\.exists"\)/);
  assert.match(handler, /setProjectBusy\(null\);/);
});

test("the row states what the skill is for this project", () => {
  // The project's own copy is removable; a global skill whose name the project
  // already carries points at that copy; anything else can be turned on here.
  assert.match(
    source,
    /inProject=\{selectedSkill\s*\?\s*sourceLabel\(selectedSkill\) === "project"\s*\?\s*"remove"\s*:\s*projectSkillByName\.has\(selectedSkill\.name\.toLowerCase\(\)\) \? "shadowed" : "add"\s*:\s*null\}/,
  );
  assert.match(source, /if \(sourceLabel\(skill\) === "project"\) byName\.set\(skill\.name\.toLowerCase\(\), skill\);/);
  assert.match(source, /t\("skills\.inProject\.turnOn"\)/);
  assert.match(source, /t\("skills\.inProject\.turnOff"\)/);
  assert.match(source, /t\("skills\.inProject\.saved"\)/);
});

test("the project write is refused while its resources are not loaded", () => {
  // An untrusted folder does not load .pi/skills, so the panel says so above and
  // does not invite a write that would sit there unused.
  assert.match(source, /projectEnabled=\{projectResourcesLoaded\}/);
  assert.match(source, /disabled=\{projectBusy \|\| !projectEnabled\}/);
  assert.match(source, /ConfigTrustNotice message=\{t\("trust\.skillsNotLoaded"\)/);
});

test("the row is built from the shared settings blocks", () => {
  // UI consistency: settings rows are ConfigField + ConfigButton everywhere.
  const row = source.slice(
    source.indexOf('<ConfigField label={t("skills.detail.inProject")}>'),
    source.indexOf('<ConfigField label={t("skills.instructions")}>'),
  );
  assert.ok(row.length > 100, "the row exists between the description and the instructions");
  assert.match(row, /<ConfigField label=\{t\("skills\.detail\.inProject"\)\}>/);
  assert.match(row, /<ConfigButton size="small"/);
  assert.doesNotMatch(row, /<select|<input/);
});
