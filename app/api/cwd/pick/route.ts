import { NextResponse } from "next/server";

import { appleScriptCancelled, folderPanelLocation, folderPanelScript, runOsascript } from "@/lib/apple-script";
import { isLocalRequest } from "@/lib/remote-access";

/**
 * POST /api/cwd/pick  body: { prompt?: string, cwd?: string }
 *   → { cwd }              the folder the user chose in the native macOS panel
 *   → { cancelled: true }  the panel was dismissed
 *
 * The browser cannot hand Pi a folder path: Safari has no showDirectoryPicker() (not
 * through 27.x), and an <input type="file" webkitdirectory> only yields the folder's
 * *name* plus relative paths. The desktop app gets the panel from the Tauri dialog plugin
 * (selectDirectoryNative in lib/desktop-native.ts), so this route is the web path's
 * equivalent. The client validates the result through /api/cwd/validate exactly like the
 * Tauri path does, so the folder enters the file allow-list.
 *
 * The panel is the one built by folderPanelScript() in lib/apple-script.ts: shown by
 * System Events rather than Finder (nothing wakes, bounces in the Dock, or takes the
 * desktop forward), opened inside the parent of the project the sidebar has selected when
 * that hint is a real directory, and it hands the front back to the browser on both the
 * answer and the cancel — the shape of the composer's **Add files** panel, which is what a
 * Safari user compares it to.
 *
 * Local-only, like every native-OS bridge: isLocalRequest() refuses the relay mark,
 * Tailscale logins, Funnel and any non-loopback Host (AGENTS.md hard rule — a route is
 * never local because its Host says 127.0.0.1). macOS only; other platforms answer 501
 * and the client keeps its typed-path picker.
 */

export const dynamic = "force-dynamic";

const PANEL_TIMEOUT_MS = 10 * 60_000;

/** One open panel per process: a second click while a panel is up gets 409. */
let panelOpen = false;

export async function POST(req: Request) {
  if (!isLocalRequest(req)) {
    return NextResponse.json(
      { error: "Folder picking is only available on the computer running Pi." },
      { status: 403 },
    );
  }
  if (process.platform !== "darwin") {
    return NextResponse.json(
      { error: "Native folder picking is only available on macOS." },
      { status: 501 },
    );
  }
  if (panelOpen) {
    return NextResponse.json({ error: "A folder panel is already open." }, { status: 409 });
  }

  const body = await req.json().catch(() => ({})) as { prompt?: unknown; cwd?: unknown };
  const prompt = typeof body.prompt === "string" && body.prompt.trim()
    ? body.prompt.trim().slice(0, 120)
    : "Choose a project folder";

  panelOpen = true;
  try {
    const result = await runOsascript(
      folderPanelScript({ prompt, defaultPath: folderPanelLocation(body.cwd) }),
      PANEL_TIMEOUT_MS,
    );
    const path = result.stdout.trim().replace(/\/+$/, "");
    if (result.code === 0 && path) return NextResponse.json({ cwd: path });
    if (appleScriptCancelled(result.stderr)) return NextResponse.json({ cancelled: true });
    return NextResponse.json(
      { error: result.stderr.trim() || "The folder panel did not return a folder." },
      { status: 500 },
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    panelOpen = false;
  }
}
