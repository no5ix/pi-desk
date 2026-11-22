import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SkillsConfig.tsx", import.meta.url), "utf8");

test("the project request names a skill, and says the state it wants", () => {
  // The request carries the project folder and the skill's name: the server
  // resolves the source and writes inside <cwd>/.pi/skills. No path from the
  // browser is trusted, and the action is the state the row is asking for.
  assert.match(
    source,
    /fetch\("\/api\/skills\/project", \{\s*method: "POST",\s*headers: \{ "Content-Type": "application\/json" \},\s*body: JSON.stringify\(\{ cwd, name: skill\.name, action: state \}\),\s*\}\)/,
  );
  // Removing the project's copy is its own ask, not a disguised "off".
  assert.match(
    source,
    /body: JSON.stringify\(\{ cwd, name: skill\.name, action: "remove" \}\)/,
  );
});

test("the list reloads after the write, and lands on the row that was moved", () => {
  const handler = source.slice(source.indexOf("const setSkillInProject"), source.indexOf("const removeSkillFromProject"));
  assert.match(handler, /const list = await loadSkills\(\);/);
  assert.match(handler, /sourceLabel\(entry\) === "project" && entry\.name === skill\.name/);
  assert.match(handler, /if \(copy\) setSelected\(copy\.filePath\);/);
  // A refusal is shown, not swallowed: the reason the server answered with.
  assert.match(handler, /data\.reason === "target-exists"\s*\?\s*t\("skills\.inProject\.exists"\)/);
  assert.match(handler, /setProjectBusy\(null\);/);

  // After a removal the project follows the global skill, so the panel shows it.
  const removal = source.slice(source.indexOf("const removeSkillFromProject"), source.indexOf("const projectSkillControl"));
  assert.match(removal, /sourceLabel\(entry\) !== "project" && entry\.name === skill\.name/);
  assert.match(removal, /if \(globalEntry\) setSelected\(globalEntry\.filePath\);/);
});

test("the button mirrors the state here: an enabled skill offers the way off", () => {
  // A skill that reaches this project shows "Turn off in this project"; a
  // disabled one shows "Turn on in this project". Same control, both directions.
  assert.match(source, /inProject\.state === "on" \? t\("skills\.inProject\.turnOff"\) : t\("skills\.inProject\.turnOn"\)/);
  assert.match(source, /onSetInProject\(inProject\.state === "on" \? "off" : "on"\)/);
  // "Remove from this project" only exists once the project carries a copy.
  assert.match(source, /\{inProject\.hasCopy && \(\s*<ConfigButton size="small" disabled=\{projectBusy \|\| !projectEnabled\} onClick=\{onRemoveFromProject\}/);
  assert.match(source, /t\("skills\.inProject\.remove"\)/);
});

test("both files of one name stay on the list, and the row says which one runs", () => {
  // pi keeps one skill per name, so the server puts the hidden file back and
  // marks the winner; the row reads that mark and says what the project runs.
  assert.match(source, /skill\.skillCollision\?\.winner \?\? \(copy \? "project" : "global"\)/);
  assert.match(source, /inProject\.winner === "global"\s*\?\s*t\("skills\.inProject\.winnerGlobal"\)\s*:\s*t\("skills\.inProject\.shadowed"\)/);
  // The project's own copy, by name: the state the row shows for this project.
  assert.match(source, /if \(sourceLabel\(skill\) === "project"\) byName\.set\(skill\.name\.toLowerCase\(\), skill\);/);
  assert.match(source, /const off = \(copy \?\? skill\)\.disableModelInvocation;/);
});

test("a project skill shows its full path, not a dot-relative one", () => {
  // "Saved in its .pi/skills/" is only useful once the row names the file, and
  // the file lives in a specific project folder.
  assert.match(source, /\{shortenPath\(skill\.filePath\)\}/);
  assert.doesNotMatch(source, /displayPathWithin\(skill\.filePath, cwd\)/);
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
  assert.match(row, /className="skill-in-project-note"/);
  assert.doesNotMatch(row, /<select|<input/);
});

test("a project skill left as a link says the file is shared, and how to fix it", () => {
  // The link is one file behind two rows. The panel shows both and names the
  // fix, because the project's switch would otherwise move the global skill.
  assert.match(source, /inProject\.linkedToGlobal\s*\?\s*t\("skills\.inProject\.linked"\)/);
  assert.match(source, /linkedToGlobal: skill\.skillCollision\?\.linkedToGlobal === true,/);
  assert.match(source, /linkedToGlobal: boolean;/);
});

test("every locale carries the project labels", async () => {
  const keys = [
    "skills.inProject.turnOn",
    "skills.inProject.turnOff",
    "skills.inProject.remove",
    "skills.inProject.show",
    "skills.inProject.saved",
    "skills.inProject.shadowed",
    "skills.inProject.winnerGlobal",
    "skills.inProject.linked",
  ];
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const messages = await readFile(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
    for (const key of keys) {
      assert.ok(messages.includes(`"${key}":`), `${locale} is missing ${key}`);
    }
    // The off button is a project switch, not a delete; removal is its own key.
    if (locale === "en") {
      assert.match(messages, /"skills\.inProject\.turnOff": "Turn off in this project"/);
      assert.match(messages, /"skills\.inProject\.remove": "Remove from this project"/);
    }
  }
});
