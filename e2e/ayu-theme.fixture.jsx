import { createRoot } from "react-dom/client";
import { I18nProvider } from "../hooks/useI18n";
import { FileViewer } from "../components/FileViewer";
import { CodeBlock } from "../components/MermaidBlock";

/**
 * The file panel mounted for real, so a browser can measure what the Ayu
 * Monokai theme paints: the Markdown preview, the source view's Prism tokens,
 * and Monaco.
 *
 * `?file=` picks a fixture (its text and its language), `?mode=` the display
 * mode (`preview`, `source`, `edit`), `?theme=` the theme. The theme is set on
 * the document before the first paint, because every colour in the panel is a
 * CSS custom property resolved at paint time — that is the mechanism under
 * test, so it has to be the real one: the same `html.dark` the app toggles, the
 * same stylesheets the app serves, the same components.
 *
 * Only the file read is a mock: it answers with the fixture's text and the
 * language the app's own language table gives that extension.
 */
const MARKDOWN = `# Ayu Monokai

A paragraph with **bold**, *italic*, ~~struck~~, \`inline_code\`, a [guide](https://example.com/guide), a bare <https://example.com/naked> address, and raw <span>HTML</span> inside.

## Second level

### Third level

#### Fourth level

##### Fifth level

###### Sixth level

> A quotation, with \`code\` inside it.

- Bullet
- [x] Done
- [ ] Open
  - Nested under the bullet

1. First
2. Second

| Column | Notes |
| --- | --- |
| \`key\` | A value |

---

\`\`\`ts
// The comment tone.
import { parse } from "./parser";
const LIMIT = 42;
export class Palette extends Base {
  static readonly keyword = "#FF8F40";
  matches(name: string): boolean {
    return /token|scope/.test(name) && LIMIT > 3.5;
  }
}
\`\`\`

\`\`\`json
{ "enabled": true, "count": 7, "name": "ayu" }
\`\`\`
`;

const TYPESCRIPT = `// A comment in the comment tone.
import { readFile } from "node:fs/promises";
const LIMIT = 42;
export interface Palette { keyword: string; }
export class Theme implements Palette {
  keyword = "#FF8F40";
  async load(path: string): Promise<string> {
    return (await readFile(path, "utf8")).trim();
  }
}
const palette = new Theme();
const tail = palette.keyword;
const ok = LIMIT > 3.5;
`;

const JSON_TEXT = `{
  "name": "ayu",
  "enabled": true,
  "count": 7,
  "roles": { "keyword": "#FF8F40" }
}
`;

const CSS_TEXT = `/* The comment tone. */
:root {
  --editor-bg: #0b0e14;
  --editor-fg: #bfbdb6;
}
.panel {
  padding: 12px 4px;
  color: #FFB454;
}
@media (prefers-color-scheme: dark) {
  .markdown-body { background: rgb(11, 14, 20); }
}
`;

const HTML_TEXT = `<!doctype html>
<!-- The comment tone. -->
<section class="panel" data-count="7">
  <h1 style="color: #FFB454">Ayu</h1>
  <a href="https://example.com">A linked phrase</a>
</section>
`;

const FIXTURES = {
  "notes.md": { language: "markdown", content: MARKDOWN },
  "theme.ts": { language: "typescript", content: TYPESCRIPT },
  "theme.json": { language: "json", content: JSON_TEXT },
  "theme.css": { language: "css", content: CSS_TEXT },
  "page.html": { language: "html", content: HTML_TEXT },
};

/* A short Markdown fence — under the fold threshold, so it is highlighted. */
const MARKDOWN_FENCE = `# Heading

A **strong** word and a [link](https://example.com).

> A quotation

- [x] A task

Inline \`code\` here.
`;

const params = new URLSearchParams(location.search);
const key = params.get("file") ?? "notes.md";
const fixture = FIXTURES[key] ?? FIXTURES["notes.md"];
const mode = params.get("mode") ?? "preview";
const theme = params.get("theme") === "light" ? "light" : "dark";

try { localStorage.setItem("pi-theme", theme); } catch { /* private mode */ }
document.documentElement.dataset.theme = theme;
document.documentElement.classList.toggle("dark", theme === "dark");

const read = { content: fixture.content, language: fixture.language, mtime: new Date("2026-11-20T10:00:00Z").toISOString() };

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input?.url ?? input), "http://fixture.local");
  if (url.pathname.startsWith("/api/files/")) {
    if (String(init?.method ?? "GET").toUpperCase() === "PUT") {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.searchParams.get("type") === "watch") {
      return new Response("", { status: 501, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({
      content: read.content,
      language: read.language,
      size: read.content.length,
      nextOffset: read.content.length,
      truncated: false,
      mtime: read.mtime,
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
host.style.cssText = "flex:1;min-height:0;display:block";
const root = document.getElementById("root");
root.style.cssText = "display:flex;flex-direction:column;height:100vh";
root.appendChild(host);

createRoot(host).render(
  <I18nProvider>
    <FileViewer
      filePath={`/repo/${key}`}
      cwd="/repo"
      initialDisplayMode={mode}
      watchEnabled={false}
    />
  </I18nProvider>,
);

/* A fenced block as chat renders it: the same CodeBlock the preview and a reply
 * use, so the palette is measured where a code fence actually appears. */
const fenceHost = document.createElement("div");
fenceHost.id = "fences";
fenceHost.className = "markdown-body";
root.appendChild(fenceHost);
createRoot(fenceHost).render(
  <I18nProvider>
    <CodeBlock code={MARKDOWN_FENCE} lang="md" />
    <CodeBlock code={TYPESCRIPT} lang="ts" />
  </I18nProvider>,
);
