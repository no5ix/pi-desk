/**
 * esbuild plugin: keep Monaco out of the e2e bundles.
 *
 * These harnesses measure layout — a menu's placement, a panel's rows, a diff's
 * box. The editor is Monaco, five megabytes of code and its icon font, and it
 * only appears at the end of a chain (a panel imports the file viewer, the file
 * viewer imports the editor). Bundling it makes every one of these builds carry
 * a font binary esbuild has no loader for, and slows each run for a component
 * the test never mounts.
 *
 * The stub answers the import with the surface the app touches, so a component
 * that mounts the editor renders a box and the measurement of everything around
 * it is unaffected. `e2e/file-editor.mjs` is the harness that measures the
 * editor for real, and it does not use this plugin.
 */
export const stubMonaco = {
  name: "stub-monaco",
  setup(build) {
    build.onResolve({ filter: /^monaco-editor$/ }, () => ({ path: "monaco-stub", namespace: "stub-monaco" }));
    build.onLoad({ filter: /.*/, namespace: "stub-monaco" }, () => ({
      loader: "js",
      contents: `
const noop = { dispose() {} };
const call = () => noop;
export const languages = {
  registerCompletionItemProvider: call,
  setLanguageConfiguration: call,
  getLanguages: () => [],
};
export const editor = {
  defineTheme() {},
  setTheme() {},
  create() {
    return {
      dispose() {},
      getValue: () => "",
      setValue() {},
      focus() {},
      layout() {},
      save() {},
      savePoint: () => true,
      addCommand: call,
      onDidChangeModelContent: () => noop,
      onDidFocusEditorText: () => noop,
      onDidBlurEditorText: () => noop,
      onDidScrollChange: () => noop,
      getModel: () => ({
        getVersionId: () => 0,
        getValue: () => "",
        getWordAtPosition: () => null,
        getLineCount: () => 1,
      }),
      getPosition: () => ({ lineNumber: 1, column: 1 }),
      setPosition() {},
      revealLineInCenter() {},
      updateOptions() {},
      getScrollTop: () => 0,
    };
  },
};
export const KeyMod = { CtrlCmd: 2048, Shift: 1024, Alt: 512 };
export const KeyCode = { KeyS: 83, Enter: 3, Tab: 2, Escape: 9 };
export const Uri = { parse: (value) => value };
export default { editor, languages, KeyMod, KeyCode, Uri };
`,
    }));
    // Monaco's icon font, for the case that reaches it by another route.
    build.onLoad({ filter: /\.(ttf|woff2?|eot)$/ }, () => ({ loader: "text", contents: "" }));
  },
};
