import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from "fs";
import path from "path";
import { loadSkillsWithInstallInfo } from "./skills-service";

/**
 * Project-level skills: a skill folder inside the project's own `.pi/skills`.
 *
 * Pi discovers `<cwd>/.pi/skills/**\/SKILL.md`, so a project can carry skills
 * nobody else sees — the same split the project's `.pi/mcp.json` gives MCP
 * servers. Turning a global skill on in one project links its folder here, which
 * keeps the global skill's updates (a `skills.sh` update lands in the linked
 * folder); a copy is used where links are unavailable, e.g. Windows without
 * developer mode.
 */
export const PROJECT_SKILLS_RELATIVE_DIR = path.join(".pi", "skills");

export interface ProjectSkillResult {
  ok: boolean;
  /** The folder the skill landed at, or the one removed. */
  target?: string;
  /** How it landed: a link to the global folder, or a private copy. */
  mode?: "link" | "copy";
  /** A stable code the panel maps to a sentence. */
  reason?:
    | "invalid-name"
    | "skill-not-found"
    | "source-missing"
    | "already-in-project"
    | "target-exists"
    | "not-in-project"
    | "failed";
  error?: string;
}

export function projectSkillsRoot(cwd: string): string {
  return path.join(cwd, PROJECT_SKILLS_RELATIVE_DIR);
}

/**
 * A skill folder name pi accepts and this module can delete safely: a single
 * path segment, no traversal, no hidden dot-folder.
 */
export function isSafeSkillName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name);
}

/** Refuse a target that escapes the project's skills folder through a link. */
function projectSkillTarget(cwd: string, name: string): string | null {
  if (!isSafeSkillName(name)) return null;
  const root = path.resolve(projectSkillsRoot(cwd));
  const target = path.resolve(root, name);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

/** Copy a skill folder, following the links a skills tree is full of. */
export function copySkillTree(source: string, target: string): void {
  const stat = statSync(source);
  if (stat.isFile()) {
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
    return;
  }
  if (!stat.isDirectory()) return;
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    copySkillTree(path.join(source, entry.name), path.join(target, entry.name));
  }
}

function linkSkillFolder(source: string, target: string): void {
  mkdirSync(path.dirname(target), { recursive: true });
  // A directory junction needs no developer mode on Windows; elsewhere a link.
  symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
}

/**
 * Turn a global skill on in one project: link its folder into
 * `<cwd>/.pi/skills/<name>`, copying where links are refused.
 *
 * The source is resolved from the skills this project already loads, so the
 * caller never names a path: the request carries a skill name only.
 */
export async function installProjectSkill(cwd: string, name: string): Promise<ProjectSkillResult> {
  const target = projectSkillTarget(cwd, name);
  if (!target) return { ok: false, reason: "invalid-name" };

  const skills = await loadSkillsWithInstallInfo(cwd);
  const wanted = name.toLowerCase();
  const source = skills.skills.find((skill) => skill.name.toLowerCase() === wanted && skill.sourceInfo?.scope !== "project");
  if (!source) return { ok: false, reason: "skill-not-found" };
  const sourceDir = path.resolve(source.baseDir);
  if (!existsSync(source.filePath) || !existsSync(sourceDir)) return { ok: false, reason: "source-missing" };

  if (existsSync(target) || safeLstat(target)) return { ok: false, target, reason: "target-exists" };

  try {
    linkSkillFolder(sourceDir, target);
    return { ok: true, target, mode: "link" };
  } catch (error) {
    // No permission to link (Windows without developer mode, a filesystem
    // without links): the project gets its own copy of the folder.
    try {
      copySkillTree(sourceDir, target);
      return { ok: true, target, mode: "copy" };
    } catch (copyError) {
      return { ok: false, target, reason: "failed", error: errorMessage(copyError) || errorMessage(error) };
    }
  }
}

/**
 * Take a skill out of the project: remove the entry in the project's skills
 * folder. A linked skill's global folder is never touched, and only a top-level
 * entry of that folder is removable.
 */
export function removeProjectSkill(cwd: string, name: string): ProjectSkillResult {
  const target = projectSkillTarget(cwd, name);
  if (!target) return { ok: false, reason: "invalid-name" };
  const entry = safeLstat(target);
  if (!entry) return { ok: false, target, reason: "not-in-project" };
  try {
    rmSync(target, { recursive: true, force: true });
    return { ok: true, target };
  } catch (error) {
    return { ok: false, target, reason: "failed", error: errorMessage(error) };
  }
}

function safeLstat(target: string) {
  try {
    return lstatSync(target);
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}
