import fs from "node:fs";
import path from "node:path";
import { loadSkillsFromDir, type Skill } from "@earendil-works/pi-coding-agent";
import {
  findProjectSkill,
  globalSkillDirs,
  isLinkedSkillEntry,
  isSafeSkillName,
  projectSkillTarget,
  PROJECT_SKILLS_RELATIVE_DIR,
} from "./skill-roots";
import { loadSkillsWithInstallInfo } from "./skills-service";
import { setDisableModelInvocation } from "./skill-frontmatter";
import { replaceFileAtomicSync } from "./atomic-file";

/**
 * Project-level skills: turn one skill on, or off, for a single project.
 *
 * A project skill is a real file under `<cwd>/.pi/skills/<name>/SKILL.md` —
 * pi's own project skill location, loaded only in sessions started in that
 * project and gated behind the same project trust. It is a **copy**, never a
 * link: the panel flips the global and the project switches independently, and
 * a shared file would move the global skill's state (and every other project
 * that follows it) whenever the project's switch is touched.
 *
 * pi keeps one skill per name, so a project copy collides with the global one
 * and the loader reports a single entry. `lib/skill-shadowing.ts` puts the
 * hidden file back on the panel's list and says which side a session follows.
 */

export {
  PROJECT_SKILLS_RELATIVE_DIR,
  isSafeSkillName,
  isLinkedSkillEntry,
  projectSkillDirs,
  existingProjectSkillDirs,
  findProjectSkill,
  projectSkillTarget,
  globalSkillDirs,
} from "./skill-roots";

/** Copy a skill folder (SKILL.md, scripts, references, …) into place. */
export function copySkillTree(source: string, target: string): number {
  fs.mkdirSync(target, { recursive: true });
  let files = 0;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files += copySkillTree(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      files += 1;
    }
  }
  return files;
}

/**
 * The skill named `name` the user installed globally, read off disk.
 *
 * The loader list is not enough: a project copy of the same name hides the
 * global entry, so the global file is missing from the list exactly when a
 * re-install needs to read it.
 */
export function findGlobalSkillByName(name: string, opts: { dirs?: Array<{ dir: string; source: "user" | "skills.sh" }> } = {}): Skill | null {
  if (!isSafeSkillName(name)) return null;
  for (const { dir, source } of opts.dirs ?? globalSkillDirs()) {
    const { skills } = loadSkillsFromDir({ dir, source });
    const hit = skills.find((skill) => skill.name === name);
    if (hit) return hit;
  }
  return null;
}

export type ProjectSkillState = "on" | "off";

export interface ProjectSkillResult {
  path: string;
  state: ProjectSkillState;
  files: number;
}

/**
 * Put the skill named `name` into this project, switched to `state`.
 *
 * Copies the user's own skill when the project has none of its own; an
 * existing project copy is only re-flipped, so turning a skill off and on
 * keeps whatever the project changed in its own instructions.
 */
export async function installProjectSkill(cwd: string, name: string, state: ProjectSkillState): Promise<ProjectSkillResult> {
  const existing = findProjectSkill(cwd, name);
  const target = projectSkillTarget(cwd, name);
  // A copy of its own: only its switch moves, never the global skill's.
  if (existing && !isLinkedSkillEntry(existing.dir)) {
    writeSkillState(existing.file, state === "on");
    return { path: existing.file, state, files: 0 };
  }
  const loaded = await loadSkillsWithInstallInfo(cwd);
  const source =
    loaded.skills
      .filter((skill) => skill.name === name && skill.sourceInfo?.scope !== "project")
      .map((skill) => ({ baseDir: skill.baseDir ?? path.dirname(skill.filePath), filePath: skill.filePath }))
      .find((candidate) => fs.existsSync(path.join(candidate.baseDir, "SKILL.md")))
    ?? findGlobalSkillByName(name);
  if (!source) {
    throw Object.assign(new Error(`No global skill named "${name}" to turn on in this project.`), { code: "skill-not-found" });
  }
  // An older build linked the global folder in, which made the two rows one
  // file. The link goes (its target stays) and the project gets its own copy.
  const dir = existing?.dir ?? target.dir;
  if (existing) fs.rmSync(existing.dir, { recursive: true, force: true });
  const files = copySkillTree(source.baseDir, dir);
  const file = path.join(dir, "SKILL.md");
  // The copy inherits the global file's switch; the project asked for `state`.
  writeSkillState(file, state === "on");
  return { path: file, state, files };
}

/** Flip the project's own copy; the global skill's file is not touched. */
export function setProjectSkillState(cwd: string, name: string, state: ProjectSkillState): ProjectSkillResult {
  const existing = findProjectSkill(cwd, name);
  if (!existing) {
    throw Object.assign(new Error(`This project has no skill named "${name}".`), { code: "not-in-project" });
  }
  writeSkillState(existing.file, state === "on");
  return { path: existing.file, state, files: 0 };
}

/** Take this project's copy away; the global skill stays as it was. */
export function removeProjectSkill(cwd: string, name: string): string {
  const existing = findProjectSkill(cwd, name);
  if (!existing) {
    throw Object.assign(new Error(`This project has no skill named "${name}".`), { code: "not-in-project" });
  }
  fs.rmSync(existing.dir, { recursive: true, force: true });
  return existing.dir;
}

/** Write `disable-model-invocation` through pi-web's own frontmatter writer. */
function writeSkillState(filePath: string, enabled: boolean): void {
  const content = fs.readFileSync(filePath, "utf8");
  const updated = setDisableModelInvocation(content, !enabled);
  if (updated !== content) replaceFileAtomicSync(filePath, updated);
}
