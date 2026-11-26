/**
 * Monaco's side-effect modules have no type entry of their own — importing them
 * is the whole point (the editor contributions, the basic-language tokenizers),
 * and there is nothing to import *from* them. Declared here so the import in
 * `CodeEditor.tsx` typechecks without an `any` widening.
 */
declare module "monaco-editor/esm/vs/editor/editor.all";
declare module "monaco-editor/esm/vs/basic-languages/monaco.contribution";
