import fs from "node:fs";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { userHome } from "./user-home";

/**
 * Where skills live for one project and for the user.
 *
 * Kept apart from the code that writes skills so a read-only listing can use
 * the same folders without importing the writer.
 */

/** Where pi looks for a project's own skills. */
export const PROJECT_SKILLS_RELATIVE_DIR = path.join(".pi", "skills");

/** A skill name becomes a folder name, so it stays a single safe path segment. */
export function isSafeSkillName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name) && !name.includes("--");
}

/** Directories that hold a project's own skills. */
export function projectSkillDirs(cwd: string): string[] {
  return [path.join(cwd, PROJECT_SKILLS_RELATIVE_DIR), path.join(cwd, ".agents", "skills")];
}

/** The project skill folders that already exist, creating none. */
export function existingProjectSkillDirs(cwd: string): string[] {
  return projectSkillDirs(cwd).filter((dir) => fs.existsSync(dir));
}

/** A skill folder inside a project: its directory, its SKILL.md, its skills root. */
export interface ProjectSkillPaths {
  dir: string;
  file: string;
  skillsDir: string;
}

/** Where a project's copy of `name` would be created. */
export function projectSkillTarget(cwd: string, name: string): ProjectSkillPaths {
  const skillsDir = path.join(cwd, PROJECT_SKILLS_RELATIVE_DIR);
  return { dir: path.join(skillsDir, name), file: path.join(skillsDir, name, "SKILL.md"), skillsDir };
}

/** Where a project's copy of `name` already lives, across every project skill folder. */
export function findProjectSkill(cwd: string, name: string): ProjectSkillPaths | null {
  if (!isSafeSkillName(name)) return null;
  for (const skillsDir of projectSkillDirs(cwd)) {
    const dir = path.join(skillsDir, name);
    const file = path.join(dir, "SKILL.md");
    if (fs.existsSync(file)) return { dir, file, skillsDir };
  }
  return null;
}

/** The folders the user's own skills come from, in pi's own order. */
export function globalSkillDirs(agentDir = getAgentDir()): Array<{ dir: string; source: "user" | "skills.sh" }> {
  const dirs: Array<{ dir: string; source: "user" | "skills.sh" }> = [{ dir: path.join(agentDir, "skills"), source: "user" }];
  const agentsSkills = path.join(userHome(), ".agents", "skills");
  if (fs.existsSync(agentsSkills)) dirs.push({ dir: agentsSkills, source: "skills.sh" });
  return dirs;
}

/**
 * True when a project's skill entry is a link to a folder somewhere else, the
 * shape an older build left behind. A link is one file shared by the global and
 * the project row, so its switch moves the global skill's state too; installing
 * replaces it with the project's own copy.
 */
export function isLinkedSkillEntry(dirPath: string): boolean {
  try {
    // isJunction() is newer than the Stats typing here, and older Node lacks it.
    const stat = fs.lstatSync(dirPath) as fs.Stats & { isJunction?: () => boolean };
    return stat.isSymbolicLink() || stat.isJunction?.() === true;
  } catch {
    return false;
  }
}
