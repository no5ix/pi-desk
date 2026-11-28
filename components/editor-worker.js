/**
 * Monaco's editor worker, as a file the bundlers resolve by that exact name.
 *
 * The editor asks for this worker through `new URL("./editor-worker.js",
 * import.meta.url)`, a *relative* specifier naming this file. A bundler turns a
 * relative `new URL` into an emitted asset and can emit nothing for a bare
 * module specifier (`"monaco-editor/esm/..."`) — the request then 404s and
 * Monaco falls back to running this on the main thread, with a warning about UI
 * freezes.
 *
 * This file is `.js` and not `.ts` on purpose. The `new URL` request is resolved
 * literally and the asset is emitted as JavaScript, so neither Turbopack
 * (`next dev`) nor webpack (`next build --webpack`) maps the `.js` request onto
 * a `.ts` source: the module graph for a worker asset does not go through the
 * TypeScript loader. A `.ts` sibling leaves the request unresolved — a
 * "Module not found" build warning, and an editor with no worker.
 *
 * Only the editor worker lives here. The language workers (TypeScript, CSS,
 * HTML, JSON) are not loaded: this app runs no language server, and the
 * completion it offers is the document's own words.
 */
import "monaco-editor/esm/vs/editor/editor.worker.js";
