import { NextResponse } from "next/server";
import { isCwdAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";
import { discoverWorkspaceRepos, invalidateGitWorkspace, listProjectRepos, repoLabel } from "@/lib/git/workspace";

/**
 * The repositories the Git panel can act on for one project cwd.
 *
 * Branchshift listed the VS Code workspace folders in its repo switcher. Here
 * the list is derived from the cwd: the checkout the cwd belongs to, every other
 * worktree of that repository, and the checkouts nested directly inside it. A
 * worktree is its own checkout (own index, own HEAD), so it is listed as its own
 * repository and every operation targets it, never the main checkout.
 */
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const url = new URL(request.url);
  const cwd = url.searchParams.get("cwd")?.trim() ?? "";
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
  }
  if (url.searchParams.get("refresh") === "1") invalidateGitWorkspace(cwd);

  if (!(await isCwdAllowed(cwd))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const workspace = await discoverWorkspaceRepos(cwd);
  // `?projects=1` adds the app's own project list (the folders the sessions
  // live in), because the panel's switcher is meant to move between the projects
  // the app works in — the way Branchshift's switcher moved between the IDE's.
  const projects = url.searchParams.get("projects") === "1" ? await listProjectRepos() : [];
  return NextResponse.json({
    cwd: workspace.cwd,
    activeId: workspace.currentId,
    repos: workspace.repos.map((repo) => ({ ...repo, label: repoLabel(repo, workspace.repos) })),
    projects,
  });
}
