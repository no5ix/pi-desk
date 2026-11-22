import fs from "node:fs";
import path from "node:path";
import { getAgentDir, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { existingProjectSkillDirs, globalSkillDirs } from "./project-skills";

/**
 * Skills pi's loader hides, put back for Settings › Skills.
 *
 * pi keeps one skill per name: when a project carries a copy of a skill the
 * user also installed globally, the loader returns a single entry and drops
 * the other file. The panel would then show one row and hide the state of the
 * file it dropped — the global skill looked removed from the machine, and a
 * switch that looked global was really the project's file.
 *
 * So the panel gets the hidden twin back: it is a real file on disk with its
 * own `disable-model-invocation` switch, and both rows carry `skillCollision`
 * saying which file a session in this project follows.
 */

/** The fields the supplement reads and writes; keeps the helper generic. */
export interface ShadowableSkill {
  name: string;
  filePath: string;
  baseDir?: string;
  description?: string;
  disableModelInvocation?: boolean;
  sourceInfo?: { source?: string; scope?: string; baseDir?: string };
  /** One name, two files: the side a session in this project uses. */
  skillCollision?: { winner: "project" | "global"; linkedToGlobal?: boolean };
}

export interface ShadowedSkillsOptions {
  cwd: string;
  agentDir?: string;
  /** Skill folders the user's own skills live in; defaults to pi's two roots. */
  globalDirs?: Array<{ dir: string; source: "user" | "skills.sh" }>;
  /** The project's own skill folders; defaults to the ones that exist. */
  projectDirs?: string[];
}

/** Resolve symlinks so a project link to a global folder counts as one file. */
function fileKey(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isUnder(filePath: string, dir: string): boolean {
  const relative = path.relative(path.resolve(dir), path.resolve(filePath));
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Return the loaded skills plus the entries the loader dropped, marking both
 * sides of every name collision.
 *
 * A global skill hidden by the project's copy comes back with its global
 * scope, so the panel keeps listing it beside the project row; a project copy
 * the global file won comes back as a project row, so the switch the user
 * pressed stays visible even while the session follows the global skill.
 */
export function addShadowedSkills<T extends ShadowableSkill>(loaded: T[], options: ShadowedSkillsOptions): T[] {
  const seen = new Set(loaded.map((skill) => fileKey(skill.filePath)));
  const globalDirs = options.globalDirs ?? globalSkillDirs(options.agentDir ?? getAgentDir());
  const projectDirs = options.projectDirs ?? existingProjectSkillDirs(options.cwd);
  const cache = new Map<string, T[]>();
  const skillsIn = (dir: string, source: "user" | "skills.sh" | "project"): T[] => {
    const cached = cache.get(dir);
    if (cached) return cached;
    // pi's own reader, so the copy back carries its parsing, name rules and
    // frontmatter state; `source` is also what decides the row's scope.
    const found = loadSkillsFromDir({ dir, source }).skills as unknown as T[];
    cache.set(dir, found);
    return found;
  };
  const appended: T[] = [];
  const marked = loaded.map((skill) => {
    const winner: "project" | "global" = projectDirs.some((dir) => isUnder(skill.filePath, dir)) ? "project" : "global";
    const dirs =
      winner === "project"
        ? globalDirs.map(({ dir, source }) => ({ dir, source }))
        : projectDirs.map((dir) => ({ dir, source: "project" as const }));
    const skillKey = fileKey(skill.filePath);
    for (const { dir, source } of dirs) {
      const found = skillsIn(dir, source);
      // An older build linked the global folder into the project, so the two
      // rows are one file. Show the global file beside it: its switch is the
      // same today, and turning it on or off in this project makes the copy
      // the rules ask for.
      const link = winner === "project" ? found.find((candidate) => candidate.filePath !== skill.filePath && fileKey(candidate.filePath) === skillKey) : undefined;
      const twin =
        link ??
        found.find(
          (candidate) =>
            candidate.name === skill.name &&
            candidate.filePath !== skill.filePath &&
            !seen.has(fileKey(candidate.filePath)),
        );
      if (!twin) continue;
      if (!link) seen.add(fileKey(twin.filePath));
      appended.push({ ...twin, skillCollision: { winner, ...(link ? { linkedToGlobal: true } : {}) } } as T);
      return { ...skill, skillCollision: { winner, ...(link ? { linkedToGlobal: true } : {}) } } as T;
    }
    return skill;
  });
  if (!appended.length) return loaded;
  return [...marked, ...appended];
}
