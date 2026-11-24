import { NextResponse } from "next/server";
import { readCurrentBranch } from "@/lib/worktree";
import { isCwdAllowed } from "@/lib/file-access";

// GET /api/worktrees/branch?cwd=  →  { cwd, branch }
//
// The conversation header's cheap branch read: one short `git rev-parse` on the
// server and no project cache in front of it, so the header can re-check every
// few seconds and follow a branch switched outside pi-desk. The full
// `/api/worktrees` payload answers from a 60-second server cache — fine for the
// sidebar's 10-second poll, far too stale for a label the user watches.
//
// `branch` is null for a detached HEAD and for a folder that is not a git
// repository; the header shows no chip in either case.
export async function GET(req: Request) {
  try {
    const cwd = new URL(req.url).searchParams.get("cwd");
    if (!cwd) {
      return NextResponse.json({ error: "cwd is required" }, { status: 400 });
    }
    if (!(await isCwdAllowed(cwd))) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json({ cwd, branch: await readCurrentBranch(cwd) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
