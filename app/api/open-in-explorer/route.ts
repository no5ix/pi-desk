import { stat } from "fs/promises";
import { resolve } from "path";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import {
  fileManagerPlatform,
  isFileManagerSupported,
  launchFileManager,
  revealInFileManager,
} from "@/lib/open-in-file-manager";
import { isLocalRequest } from "@/lib/remote-access";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Whether this request may raise a file-manager window on the server. */
function availabilityFor(request: Request): { supported: boolean; reason: string | null } {
  // A relayed or Tailscale-forwarded request carries a loopback Host too; isLocalRequest tells them apart.
  if (!isLocalRequest(request)) return { supported: false, reason: "remote" };
  if (!isFileManagerSupported(process.platform)) return { supported: false, reason: "unsupported-platform" };
  return { supported: true, reason: null };
}

/** Lets the sidebar pick the button label and disable it when unavailable. */
export async function GET(request: Request) {
  const { supported, reason } = availabilityFor(request);
  // Under WSL this is "win32": Explorer answers, so the button names it.
  return NextResponse.json({ supported, reason, platform: fileManagerPlatform() });
}

/**
 * Opens the session workspace, or one file inside it, in the OS file manager.
 *
 * `cwd` opens a folder; `path` shows one item inside its folder (Finder and
 * Explorer select it). Both are authorized against the app's file roots, so the
 * route reveals a file the file panel has already listed — never an arbitrary
 * path on the machine.
 */
export async function POST(request: Request) {
  try {
    const { supported, reason } = availabilityFor(request);
    if (!supported) {
      return NextResponse.json({ error: reason }, { status: 403 });
    }

    const body = await request.json() as { cwd?: unknown; path?: unknown };
    const requested = typeof body.cwd === "string" && body.cwd.trim()
      ? body.cwd
      : typeof body.path === "string" && body.path.trim()
        ? body.path
        : null;
    if (!requested) {
      return NextResponse.json({ error: "cwd-required" }, { status: 400 });
    }
    const target = resolve(requested);
    // Authorize before touching the path, so a location outside the allowed
    // roots answers 403 whether or not it exists.
    const roots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(target, roots)) {
      return NextResponse.json({ error: "access-denied" }, { status: 403 });
    }
    const isDirectory = await stat(target).then((s) => s.isDirectory()).catch(() => false);
    if (!isDirectory && typeof body.cwd === "string" && body.cwd.trim()) {
      return NextResponse.json({ error: "not-a-directory" }, { status: 400 });
    }

    if (isDirectory) await launchFileManager(target);
    else await revealInFileManager(target);
    return NextResponse.json({ opened: true });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
