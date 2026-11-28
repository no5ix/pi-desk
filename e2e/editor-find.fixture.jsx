/**
 * Fixture for e2e/editor-find.mjs: the real Monaco, in a box the width of the
 * right panel, with the app's stylesheets and Monaco's own CSS.
 *
 * Monaco's stylesheet is what lays its find widget out, and esbuild emits it
 * beside the bundle: a harness that links only the app's sheets measures a
 * widget whose buttons are unstyled blocks (337px wide, one per row) and calls
 * that a design bug. Both sheets are served, in the order the app has them.
 */
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/hooks/useI18n";
import { CodeEditor } from "@/components/CodeEditor";

const params = new URLSearchParams(window.location.search);
const width = Number(params.get("width") ?? 520);
const height = Number(params.get("height") ?? 500);
const lines = Number(params.get("lines") ?? 40);

const text = Array.from({ length: lines }, (_, i) =>
  `// line ${i + 1}: the quick brown fox jumps over the lazy dog ${i + 1}\nexport function widget${i + 1}(a, b) { return a + b; }`).join("\n");

function App() {
  return (
    <I18nProvider>
      <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <div className="right-panel-tab-strip" style={{ width }}>
          <div className="file-tab-bar-slot"><div className="file-tab-bar" /></div>
          <button type="button" className="file-workbench-icon-button file-tree-toggle">files</button>
        </div>
        <div className="file-editor-host" style={{ width, height }}>
          <CodeEditor filePath="/repo/src/widget.ts" value={text} />
        </div>
      </div>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);

/**
 * Open Find without a keyboard gesture. A synthetic Ctrl+C keystroke races the
 * editor's own focus, so the harness asks the editor to run the command — the
 * same action the key binding fires.
 */
window.openFindInEditor = async () => {
  const monaco = await import("monaco-editor/esm/vs/editor/editor.api");
  const editor = (monaco.editor.getEditors?.() ?? [])[0];
  if (!editor) return false;
  editor.focus();
  await editor.getAction("actions.find")?.run();
  return true;
};
