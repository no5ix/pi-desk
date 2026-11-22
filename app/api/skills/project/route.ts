import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { getAllowedFileRoots, isExistingFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { installProjectSkill, isSafeSkillName, removeProjectSkill, setProjectSkillState, type ProjectSkillState } from "@/lib/project-skills";
import { hasParentDirectorySegment } from "@/lib/path-security";

export const dynamic = "force-dynamic";

/** The panel's three asks; `add` / `delete` stay accepted for older clients. */
type RequestedAction = ProjectSkillState | "remove";

function readAction(action: unknown): RequestedAction | null {
  if (action === undefined || action === "add" || action === "on") return "on";
  if (action === "off") return "off";
  if (action === "remove" || action === "delete") return "remove";
  return null;
}

/**
 * Project-level skills: `POST { cwd, name, action }`.
 *
 * `action: "on"` puts the skill into `cwd`'s own `.pi/skills/<name>` as a copy
 * of the user's skill, switched on; `"off"` does the same switched off, so the
 * skill stops reaching this project's sessions while the global skill keeps its
 * own state everywhere else; `"remove"` deletes the project's copy, after which
 * the project follows the global skill again.
 *
 * The request carries a skill *name*, never a path: the source is resolved from
 * the skills this project loads (falling back to the user's skill folders), and
 * every write is inside the project's own skills folder.
 */
export async function POST(req: Request) {
  let body: { cwd?: unknown; name?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-request", error: "Expected a JSON body" }, { status: 400 });
  }

  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const action = readAction(body.action);
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return NextResponse.json({ ok: false, reason: "bad-request", error: "cwd must be an absolute path" }, { status: 400 });
  }
  if (hasParentDirectorySegment(cwd) || !name) {
    return NextResponse.json({ ok: false, reason: "bad-request", error: "cwd must not walk out of its folder, and name a skill" }, { status: 400 });
  }
  if (!action) {
    return NextResponse.json({ ok: false, reason: "bad-request", error: 'action must be "on", "off" or "remove"' }, { status: 400 });
  }
  if (!isSafeSkillName(name)) {
    return NextResponse.json({ ok: false, reason: "invalid-name", error: "That skill name cannot be used for a project skill folder." }, { status: 400 });
  }

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ ok: false, reason: "denied", error: "Access denied" }, { status: 403 });
    }
    if (!existsSync(cwd)) {
      return NextResponse.json({ ok: false, reason: "no-project", error: "The project folder no longer exists" }, { status: 404 });
    }

    if (action === "remove") {
      const removed = removeProjectSkill(cwd, name);
      return NextResponse.json({ ok: true, action, path: removed, removed: true });
    }
    const result = action === "off"
      ? await turnOffInProject(cwd, name)
      : await installProjectSkill(cwd, name, "on");
    return NextResponse.json({ ok: true, action, path: result.path, state: result.state, copied: result.files > 0 });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const message = error instanceof Error ? error.message : String(error);
    const status = code === "skill-not-found" || code === "not-in-project" ? 404 : 500;
    return NextResponse.json({ ok: false, reason: code ?? "failed", error: message }, { status });
  }
}

/**
 * Switch a skill off for this project only.
 *
 * With a copy of its own the project just flips it. With none, it gets a copy
 * of the user's skill switched off: writing the global file would switch the
 * skill off in every project, which is not what "in this project" asks for.
 */
async function turnOffInProject(cwd: string, name: string) {
  try {
    return setProjectSkillState(cwd, name, "off");
  } catch (error) {
    if ((error as { code?: string })?.code !== "not-in-project") throw error;
    return installProjectSkill(cwd, name, "off");
  }
}
