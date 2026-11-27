import { NextRequest, NextResponse } from "next/server";
import { lstatSync } from "fs";
import path from "path";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { getGitFileDiff } from "@/lib/git-changes";
import { hasParentDirectorySegment } from "@/lib/path-security";

/**
 * A commit named by hash. The commit panel hands the tab a full sha, and a
 * search box may type any prefix of one; the ref reaches git as an argument
 * (never through a shell), so the shape is what keeps it a commit and not a
 * revision range, a ref name, or an option.
 */
function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{4,64}$/i.test(value);
}

function isDiffPathAllowed(filePath: string, allowedRoots: Set<string>): boolean {
  if (hasParentDirectorySegment(filePath)) return false;
  // Deleted files (and their parents) may be absent. Authorize the nearest
  // existing entry, but never walk past a dangling link or an access error.
  let candidate = filePath;
  while (isFilePathAllowed(candidate, allowedRoots)) {
    try {
      lstatSync(candidate);
      return isExistingFilePathAllowed(candidate, allowedRoots);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return false;
    candidate = parent;
  }
  return false;
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const filePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
    const ref = request.nextUrl.searchParams.get("ref")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
    }
    if (!filePath || (!filePath.startsWith("/") && !isWindowsAbsolutePath(filePath))) {
      return NextResponse.json({ error: "path must be an absolute path" }, { status: 400 });
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots) || !isFilePathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // Check the target as well as cwd: a directory junction inside a repository
    // can otherwise expose an outside file through an apparently local path.
    if (!isExistingFilePathAllowed(cwd, allowedRoots) || !isDiffPathAllowed(filePath, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (ref && !isCommitSha(ref)) {
      return NextResponse.json({ error: "ref must be a commit", supported: false }, { status: 400 });
    }
    return NextResponse.json(await getGitFileDiff(cwd, filePath, ref || undefined));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
