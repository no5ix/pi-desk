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
 * Resolves null for every non-result — cancelled panel, non-macOS server, remote
 * request, network failure — so callers keep their existing fallback (the typed-path
 * picker) without branching on the reason.
 */
export async function pickProjectDirectoryFromServer(prompt?: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const picked = await fetch("/api/cwd/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prompt ? { prompt } : {}),
    });
    if (!picked.ok) return null;
    const data = await picked.json().catch(() => ({})) as { cwd?: unknown; cancelled?: unknown };
    if (data.cancelled === true || typeof data.cwd !== "string" || !data.cwd) return null;

    const validated = await fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: data.cwd }),
    });
    const result = await validated.json().catch(() => ({})) as { cwd?: string; error?: string };
    if (!validated.ok || result.error) return null;
    return result.cwd ?? data.cwd;
  } catch {
    return null;
  }
}
