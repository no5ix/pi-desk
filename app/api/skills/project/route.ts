import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { getAllowedFileRoots, isExistingFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { installProjectSkill, removeProjectSkill } from "@/lib/project-skills";
import { hasParentDirectorySegment } from "@/lib/path-security";

export const dynamic = "force-dynamic";

/**
 * Project-level skills: `POST { cwd, name, action? }`.
 *
 * `action: "add"` (the default) turns a global skill on in `cwd` alone, by
 * linking its folder into `<cwd>/.pi/skills/<name>`; `action: "remove"` deletes
 * that entry, leaving the global skill untouched. The request carries a skill
 * *name*, never a path: the source folder is resolved from the skills this
 * project already loads, and the write target is fixed to the project's own
 * skills folder.
 */
export async function POST(req: Request) {
  let body: { cwd?: unknown; name?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const action = body.action === "remove" ? "remove" : "add";
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
  }
  if (hasParentDirectorySegment(cwd) || !name) {
    return NextResponse.json({ error: "cwd must not walk out of its folder, and name a skill" }, { status: 400 });
  }

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ error: "The project folder no longer exists" }, { status: 404 });
    }

    const result = action === "remove"
      ? removeProjectSkill(cwd, name)
      : await installProjectSkill(cwd, name);

    if (result.ok) return NextResponse.json({ ok: true, path: result.target, mode: result.mode });
    return NextResponse.json({ ok: false, reason: result.reason, error: result.error }, { status: result.reason === "target-exists" ? 409 : 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, reason: "failed", error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
