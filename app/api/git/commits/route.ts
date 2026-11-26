import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { commitPageLimit, commitPageSkip, findRepositoryRoot, isSafeGitRef, readCommitPage } from "@/lib/git-log";
import type { GitCommitListResponse } from "@/lib/git-types";

// GET /api/git/commits?cwd=&ref=&limit=&skip=
//   →  { isGitRepository, ref, resolvedRef, repositoryRoot, commits, hasMore }
//
// One page of one branch's history, for the right panel's Git view
// (components/GitPanel.tsx): the branch tree is already the worktrees route's
// (`/api/worktrees?branches=1`), and a file's working-tree diff is /api/git/diff's;
// this is the middle level, the commits behind the branch the user picked.
//
// `ref` is a branch as the branch list names it. A remote-only row is listed with its
// remote prefix stripped, so a name with no local branch is resolved to the remote's
// own ref (`origin/fix/x`), which is what `resolvedRef` reports.
//
// Nothing here is cached and nothing runs on a timer: the panel asks when it is
// opened, when the user presses its reload, and for the next page.

async function repositoryGate(cwd: string): Promise<{ error: NextResponse } | { root: string } | { notRepository: true }> {
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return { error: NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 }) };
  }
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(cwd, allowedRoots)) {
    return { error: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(cwd);
  } catch {
    return { error: NextResponse.json({ error: "Directory not found" }, { status: 404 }) };
  }
  if (!stat.isDirectory()) {
    return { error: NextResponse.json({ error: "Not a directory" }, { status: 400 }) };
  }
  // The same gate /api/git/status uses: the folder itself must be an allowed,
  // existing path, not only a path under an allowed root (a junction out of one).
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { error: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }
  const root = await findRepositoryRoot(cwd);
  return root ? { root } : { notRepository: true };
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const ref = request.nextUrl.searchParams.get("ref")?.trim() ?? "";
    if (!ref || !isSafeGitRef(ref)) {
      return NextResponse.json({ error: "ref is not a branch name" }, { status: 400 });
    }

    const gate = await repositoryGate(cwd);
    if ("error" in gate) return gate.error;
    if ("notRepository" in gate) {
      const empty: GitCommitListResponse = {
        isGitRepository: false, ref, resolvedRef: null, repositoryRoot: null, commits: [], hasMore: false,
      };
      return NextResponse.json(empty);
    }

    const limit = commitPageLimit(Number(request.nextUrl.searchParams.get("limit")));
    const skip = commitPageSkip(Number(request.nextUrl.searchParams.get("skip")));
    const page = await readCommitPage(gate.root, ref, { limit, skip });
    const response: GitCommitListResponse = {
      isGitRepository: true,
      ref,
      resolvedRef: page.resolvedRef,
      repositoryRoot: gate.root,
      commits: page.commits,
      hasMore: page.hasMore,
    };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
