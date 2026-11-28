// Monaco's editor worker: the request the editor makes has to name a file the
// bundlers can resolve.
//
// `new Worker(new URL("./x.js", import.meta.url))` is resolved *by name* and the
// asset is emitted as JavaScript, so the worker's module graph never reaches the
// TypeScript loader. Turbopack (`next dev`) and webpack (`next build --webpack`)
// both refuse a `.js` request whose only sibling is `.ts`: the page carrying the
// editor prints "Module not found: Can't resolve './editor-worker.js'" and the
// editor runs its text services on the main thread. These guards keep the file
// and the request in step, which is the whole of what a source-level test can
// say about it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const editor = fs.readFileSync("components/CodeEditor.tsx", "utf8");
const workerFile = "components/editor-worker.js";

await test("the worker request names a file that exists with that exact extension", () => {
  const request = editor.match(/new URL\("(\.\/editor-worker\.[a-z]+)", import\.meta\.url\)/);
  assert.ok(request, "the editor worker is requested through a relative new URL");
  assert.equal(request[1], "./editor-worker.js", "the request asks for JavaScript");
  assert.ok(
    fs.existsSync(workerFile),
    "the file the request names must exist — a worker asset is not type-checked, only emitted",
  );
  assert.ok(
    !fs.existsSync("components/editor-worker.ts"),
    "a .ts sibling is invisible to the worker request; the source has to be .js",
  );
});

await test("the worker is built as a module worker, and the request is a sibling path", () => {
  assert.match(
    editor,
    /new Worker\(\s*new URL\("\.\/editor-worker\.js", import\.meta\.url\),\s*\{ type: "module" \},\s*\)/,
    "a relative new URL and type: module are the form both bundlers emit an asset for",
  );
});

await test("the worker file is Monaco's editor worker and nothing more", () => {
  const source = fs.readFileSync(workerFile, "utf8");
  assert.match(source, /^import "monaco-editor\/esm\/vs\/editor\/editor\.worker\.js";$/m);
  // The language workers are not loaded: no language server, and the completion
  // this editor offers is the document's own words.
  assert.doesNotMatch(source, /monaco-editor\/esm\/vs\/language\//, "no language worker is bundled");
});

await test("a worker the build cannot emit does not take the editor down", () => {
  assert.match(
    editor,
    /if \(label !== "editorWorkerService"\) return silentWorker\(\);/,
    "the language workers get the stub that answers nothing",
  );
  assert.match(
    editor,
    /new Worker\(\s*new URL\("\.\/editor-worker\.js", import\.meta\.url\),\s*\{ type: "module" \},\s*\);\s*\} catch \{[\s\S]{0,140}?return silentWorker\(\);/,
    "a construction failure falls back to the stub, throwing is what breaks completion",
  );
});
