import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { findRepositoryRoot, isCommitSha, readCommitDetail } from "@/lib/git-log";
import type { GitCommitDiffResponse } from "@/lib/git-types";
import { errorMessage } from "@/lib/errors";

// GET /api/git/commit-diff?cwd=&sha=
//   →  { isGitRepository, supported, reason?, commit, repositoryRoot, files, patch, patchBytes }
//
// One commit's patch, for the right panel's Git view. The panel paints it with the
// file viewer's own diff view (components/FileViewer.tsx exports it), so a commit
// reads exactly like a file's diff tab — one renderer, not two.
//
// The patch is capped (COMMIT_PATCH_MAX_BYTES in lib/git-log.ts): a commit that
// touches a vendor tree is not a thing to paint in a side panel, and the answer says
// so (`reason: "too-large"`) rather than sending megabytes. A merge is answered
// against its first parent, the way a hosting site shows one.

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const sha = request.nextUrl.searchParams.get("sha")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!isCommitSha(sha)) {
      return NextResponse.json({ error: "sha must be a commit" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return NextResponse.json({ error: "Directory not found" }, { status: 404 });
    }
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a directory" }, { status: 400 });
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const repositoryRoot = await findRepositoryRoot(cwd);
    if (!repositoryRoot) {
      const answer: GitCommitDiffResponse = { isGitRepository: false, supported: false, reason: "not-a-repository" };
      return NextResponse.json(answer);
    }

    const detail = await readCommitDetail(repositoryRoot, sha);
    return NextResponse.json({ isGitRepository: true, ...detail });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
