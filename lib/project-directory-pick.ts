/**
 * Adopting a project folder chosen in the browser.
 *
 * "Add project" opens the app's own folder window — the same **DirectoryPicker** the project
 * picker's browse uses (components/DirectoryPicker.tsx): the app's overlay and panel, the
 * app's modal animation, folders only, and a real path on this computer as the answer.
 *
 * Two paths the web platform offers were measured and are not used. A native AppleScript
 * panel is never the browser's own window: Finder's activates Finder (the Dock bounce, the
 * desktop coming forward) and one owned by `osascript` is not even the key window, so the
 * keyboard stays in the tab. And the composer's **Add files** control in its folder form
 * (`<input type="file" webkitdirectory>`) opens a *file* chooser — macOS titles it "Choose
 * Files to Upload", lists files, and a web page cannot retitle it — while reporting only the
 * files inside the folder, with no absolute path at all (see
 * lib/project-directory-resolve.ts in git history, which tried to find the folder by name).
 *
 * So the dialog's path goes through `/api/cwd/validate`, the route that probes permissions
 * (macOS TCC denies Desktop, Documents and Downloads) and grants file access. Nothing is
 * adopted on the dialog's own authority.
 */
import { errorMessage } from "./errors.ts";

export type ProjectDirectoryChoice =
  | { status: "picked"; cwd: string }
  | { status: "unavailable"; reason: string };

/**
 * Ask the server to take this folder as a project. `ok`/`error` in the answer is the
 * message to show *in the dialog* — the window stays open so the user can go up a level and
 * choose again, which is what a refused folder means here.
 */
export async function chooseProjectDirectory(cwd: string): Promise<ProjectDirectoryChoice> {
  const trimmed = typeof cwd === "string" ? cwd.trim() : "";
  if (!trimmed) return { status: "unavailable", reason: "Choose a folder first." };
  if (typeof window === "undefined") return { status: "unavailable", reason: "no browser" };
  try {
    const response = await fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: trimmed }),
    });
    const data = await response.json().catch(() => ({}) as unknown) as { cwd?: string; error?: string };
    if (!response.ok || data.error) {
      return { status: "unavailable", reason: data.error || `The folder was refused (${response.status})` };
    }
    return { status: "picked", cwd: data.cwd ?? trimmed };
  } catch (error: unknown) {
    return { status: "unavailable", reason: errorMessage(error) };
  }
}
