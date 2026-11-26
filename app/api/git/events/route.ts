import { NextResponse } from "next/server";
import { isWindowsAbsolutePath } from "@/lib/file-access";
import { isApiRequestAllowed } from "@/lib/request-security";
import { resolveRepoRuntime } from "@/lib/git/workspace";
import { createGitWatchResponse } from "@/lib/git/watch-stream";

/**
 * Live Git state for the panel (SSE).
 *
 * Branchshift watched the repository inside the extension host and broadcast
 * `gitStateChanged` to its webviews. The panel opens one of these streams for
 * the repository it shows; it reports changes git made anywhere (a terminal
 * commit, an agent checkout, a fetch) and the operations this server ran.
 */
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const url = new URL(request.url);
  const cwd = url.searchParams.get("cwd")?.trim() ?? "";
  const repoId = url.searchParams.get("repoId")?.trim() || null;
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
  }

  const runtime = await resolveRepoRuntime(cwd, repoId);
  if (!runtime) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  return createGitWatchResponse({ repoId: runtime.descriptor.id, paths: runtime.paths }, request);
}
