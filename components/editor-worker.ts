/**
 * Monaco's editor worker, as one file the bundler can see.
 *
 * The editor asks for this worker through `new URL("./editor-worker.js",
 * import.meta.url)`, a *relative* specifier: webpack 5 and esbuild both emit
 * what a relative `new URL` names, and neither emits anything for a bare module
 * specifier (`"monaco-editor/esm/..."`) — the request then 404s and Monaco falls
 * back to running this on the main thread, with a warning about UI freezes.
 *
 * Only the editor worker lives here. The language workers (TypeScript, CSS,
 * HTML, JSON) are not loaded: this app runs no language server, and the
 * completion it offers is the document's own words.
 */
import "monaco-editor/esm/vs/editor/editor.worker.js";
