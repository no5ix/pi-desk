/* @jsx runtime:automatic */
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../hooks/useI18n";
import { FileViewer } from "../components/FileViewer";

/**
 * The file panel's editor, mounted for real: the file, the save, and the
 * completion list.
 *
 * Monaco is loaded as the app loads it — no stub — because the point of this
 * harness is that the editor works here: it paints the file in the panel's
 * width, it reports an unsaved change, it saves on Cmd/Ctrl+S, and the
 * completion it offers is the document's own words.
 *
 * The file is served from a fetch mock: a read, and a write that answers with
 * the new modification time. `?content=` chooses the buffer's text.
 */
const CONTENT = new URLSearchParams(location.search).get("content")
  ?? "export function formatCommitTime(value: number): string {\n  const delta = Date.now() - value;\n  return `${Math.round(delta / 60000)} minutes ago`;\n}\n";

const disk = { content: CONTENT, mtime: new Date("2026-11-20T10:00:00Z").toISOString() };
const writes = [];
window.__writes = writes;
window.__dirty = [];

const theme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
try { localStorage.setItem("pi-theme", theme); } catch { /* private mode */ }
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle("dark", theme === "dark");

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input?.url ?? input), "http://fixture.local");
  const method = String(init?.method ?? "GET").toUpperCase();
  if (url.pathname.startsWith("/api/files/")) {
    if (method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      writes.push(body);
      disk.content = String(body.content ?? "");
      disk.mtime = new Date().toISOString();
      return new Response(JSON.stringify({ ok: true, mtime: disk.mtime, size: disk.content.length, etag: "W/2", created: false, overwritten: false }),
        { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.searchParams.get("type") === "watch") {
      return new Response("", { status: 501, headers: { "content-type": "text/event-stream" } });
    }
    // The read: a chunked text read, the shape the viewer asks for.
    return new Response(JSON.stringify({
      content: disk.content,
      language: "typescript",
      size: disk.content.length,
      nextOffset: disk.content.length,
      truncated: false,
      mtime: disk.mtime,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};

class StubEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = 0;
  close() {}
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}
globalThis.EventSource = StubEventSource;

const host = document.createElement("div");
host.id = "file-panel";
host.style.flex = "1";
host.style.minHeight = "0";
// The shell gives the viewer a box; the viewer's own toolbar and content area
// stack inside it. A flex row here would shrink the editor to its content width.
host.style.display = "block";
const root = document.getElementById("root");
root.style.display = "flex";
root.style.flexDirection = "column";
root.style.height = "100vh";
root.appendChild(host);

createRoot(host).render(
  <I18nProvider>
    <FileViewer
      filePath="/repo/components/git/log/format-time.ts"
      cwd="/repo"
      initialDisplayMode="edit"
      watchEnabled={false}
      onDirtyChange={(dirty) => window.__dirty.push(dirty)}
    />
  </I18nProvider>,
);
