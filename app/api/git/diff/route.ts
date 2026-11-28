import { NextRequest, NextResponse } from "next/server";
import { getAllowedFileRoots, isWindowsAbsolutePath } from "@/lib/file-access";
import { readDiffPathDenial } from "@/lib/git-diff-access";
import { getGitFileDiff } from "@/lib/git-changes";
import { errorMessage } from "@/lib/errors";

/**
 * A commit named by hash. The commit panel hands the tab a full sha, and a
 * search box may type any prefix of one; the ref reaches git as an argument
 * (never through a shell), so the shape is what keeps it a commit and not a
 * revision range, a ref name, or an option.
 */
function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{4,64}$/i.test(value);
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
    // Both sides are the path git printed (git resolves links, so a worktree
    // opened through a link answers with the link-free path), while the roots
    // record the folder the user picked. The gate is containment after the links
    // are followed, on both sides; the reason names which of the four cases a 403
    // is, so the panel never answers "Access denied" to a file of the user's own
    // working tree. A directory junction inside a repository stays refused: that
    // is `link-escapes-root`.
    const denial = readDiffPathDenial(cwd, allowedRoots) ?? readDiffPathDenial(filePath, allowedRoots);
    if (denial) {
      return NextResponse.json({ error: "Access denied", reason: denial, supported: false }, { status: 403 });
    }

    if (ref && !isCommitSha(ref)) {
      return NextResponse.json({ error: "ref must be a commit", supported: false }, { status: 400 });
    }
    return NextResponse.json(await getGitFileDiff(cwd, filePath, ref || undefined));
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
