/**
 * The web path's native folder pick.
 *
 * The desktop app picks a project folder with the Tauri dialog plugin
 * (selectDirectoryNative in lib/desktop-native.ts). A browser tab has no folder API
 * that returns a path — Safari has no showDirectoryPicker() and a directory file
 * input reports only names — so the local server shows the native macOS panel instead
 * (app/api/cwd/pick). This helper is the client half: ask the server, then validate
 * the chosen path through /api/cwd/validate exactly like the native Tauri path does,
 * so the folder lands in the file allow-list.
 *
 * The answer is a status, not a path-or-null: pressing **Cancel** in the panel is
 * a finished decision and must end the flow, while a panel this server cannot show
 * (non-macOS, a remote page, a network failure) is the reason to fall back to the
 * in-app typed-path picker. Collapsing the two made Cancel open the typed picker over
 * the chat, which reads as a stray window.
 */

export type ProjectDirectoryPick =
  /** A folder the server picked and /api/cwd/validate accepted. */
  | { status: "picked"; cwd: string }
  /** The user dismissed the panel, or a panel is already open. Nothing further to do. */
  | { status: "cancelled" }
  /** No native panel here, or the chosen folder was refused: offer the typed picker. */
  | { status: "unavailable"; reason: string };

export interface ProjectDirectoryPickOptions {
  /** The panel's prompt line. */
  prompt?: string;
  /**
   * The folder the sidebar is sitting in. The panel opens in its parent, so the projects
   * beside the current one are visible straight away; the server ignores it unless it is
   * a real directory.
   */
  cwd?: string;
}

export async function pickProjectDirectoryFromServer(
  options: ProjectDirectoryPickOptions = {},
): Promise<ProjectDirectoryPick> {
  if (typeof window === "undefined") return { status: "unavailable", reason: "no browser" };
  const payload: { prompt?: string; cwd?: string } = {};
  if (options.prompt) payload.prompt = options.prompt;
  if (options.cwd) payload.cwd = options.cwd;
  let response: Response;
  try {
    response = await fetch("/api/cwd/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error: unknown) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
  const data = await response.json().catch(() => ({}) as unknown) as { cwd?: unknown; cancelled?: unknown };
  if (!response.ok) {
    // 409 is "a panel is already open": the user is looking at it, so add nothing.
    if (response.status === 409) return { status: "cancelled" };
    return { status: "unavailable", reason: `the folder panel answered ${response.status}` };
  }
  if (data.cancelled === true) return { status: "cancelled" };
  if (typeof data.cwd !== "string" || !data.cwd) {
    return { status: "unavailable", reason: "the folder panel returned no path" };
  }
  const chosen = data.cwd;
  try {
    const validated = await fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: chosen }),
    });
    const result = await validated.json().catch(() => ({}) as unknown) as { cwd?: string; error?: string };
    if (!validated.ok || result.error) {
      return { status: "unavailable", reason: result.error || `the folder was refused (${validated.status})` };
    }
    return { status: "picked", cwd: result.cwd ?? chosen };
  } catch (error: unknown) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
}
