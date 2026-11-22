import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { addShadowedSkills } from "@/lib/skill-shadowing";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";

export async function loadSkillsWithInstallInfo(cwd: string): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  // Extensions add skills only through `resources_discover` at session_start,
  // which a listing never runs, so loading them here would only import every
  // extension for nothing (#1226).
  const loader = new DefaultResourceLoader({ cwd, agentDir, noExtensions: true });
  await loader.reload(projectTrustReloadOptions(cwd, agentDir));
  const { skills, diagnostics } = loader.getSkills();
  const trusted = getProjectTrustStatus(cwd, agentDir).trusted;
  // pi keeps one skill per name, so a project copy of a global skill hides the
  // global file (and the other way round). The panel shows both files and says
  // which one this project runs, so put the hidden one back before the install
  // info is attached: the skills.sh Source and Version rows come from the same
  // lookup for both sides. An untrusted project keeps its skills unloaded, so
  // the project side is not offered back either.
  const withHidden = addShadowedSkills(skills as SkillInfo[], {
    cwd,
    agentDir,
    projectDirs: trusted ? undefined : [],
  });
  return {
    skills: annotateSkillsWithInstallInfo(withHidden, { cwd, agentDir }),
    diagnostics,
    projectResourcesLoaded: trusted,
  };
}
