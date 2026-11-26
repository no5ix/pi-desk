"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AYU_MONOKAI_NAME,
  ayuMonokaiMonacoColors,
  ayuMonokaiMonacoRules,
} from "@/lib/editor/ayu-monokai";
import { completeWords, collectDocumentWords, prefixAtCaret } from "@/lib/editor/word-completions";
import { languageForPath } from "@/lib/editor/language";

/** The one theme name this app registers, built from the vendored theme file. */
/**
 * Monaco's theme id. It is a slug, not the palette's display name: Monaco
 * rejects a theme name with a space, and `Ayu Monokai` is the display name the
 * generated file carries. The palette itself comes from there; this is only the
 * id this app registers it under.
 */
export const EDITOR_THEME = "ayu-monokai";

/*
 * Monaco, loaded in the shape this panel needs:
 *
 *  - `editor.api` + `editor.all`: the editor and its contributions (the suggest
 *    widget, find, folding, the context menu);
 *  - `basic-languages`: tokenization, so a `.ts`, `.py` or `.json` file is
 *    coloured without a language service;
 *  - not the `monaco-editor` root, which pulls in the TypeScript/CSS/HTML/JSON
 *    language services. The plan is no language server, and the completion the
 *    panel offers is the document's own words. Leaving the services in also
 *    registers completion providers that answer nothing, and the list then
 *    waits for them.
 */
type MonacoModule = typeof import("monaco-editor/esm/vs/editor/editor.api");

let monacoPromise: Promise<MonacoModule> | null = null;
let configured = false;

/**
 * Load Monaco and set it up once per page.
 *
 * Workers: `new URL(..., import.meta.url)` is the webpack 5 form, which is what
 * Next's client build is. A worker that fails to construct is not fatal —
 * Monaco falls back to running the language service on the main thread — so the
 * editor keeps working in a build where the worker chunks are unavailable, at
 * the cost of a busier main thread.
 */
/**
 * A worker that answers nothing. Monaco requires a Worker object; a language
 * feature that talks to it will simply never get an answer, which is the
 * intended state here: no language server, no semantic features. Throwing from
 * `getWorker` is what breaks the editor — Monaco's worker manager lets the error
 * out of the completion path, and the completion list never opens.
 */
let silentWorkerUrl: string | null = null;
function silentWorker(): Worker {
  if (silentWorkerUrl === null) {
    const source = "self.onmessage = () => {};";
    silentWorkerUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  }
  return new Worker(silentWorkerUrl);
}

function loadMonaco(): Promise<MonacoModule> {
  if (monacoPromise) return monacoPromise;
  monacoPromise = (async () => {
    const globalScope = globalThis as typeof globalThis & { MonacoEnvironment?: unknown };
    if (!globalScope.MonacoEnvironment) {
      globalScope.MonacoEnvironment = {
        getWorker(_workerId: string, label: string) {
          // Only the editor worker is asked for: text operations (folding, the
          // word inspector, multi-cursor) run there. The language workers are
          // not — the plan is no language server, and the completion the panel
          // offers is the document's words — so those labels get the stub.
          // A bundler emits a worker chunk only for a `new URL` it can read
          // statically, so every worker path here is a literal. A template
          // string is invisible to webpack and to esbuild, and the worker then
          // does not exist at runtime — which silently costs the editor its word
          // context, and with it the completion list.
          if (label !== "editorWorkerService") return silentWorker();
          try {
            return new Worker(
              new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url),
              { type: "module" },
            );
          } catch {
            // A build that cannot emit the chunk must not take the editor down.
            return silentWorker();
          }
        },
      };
    }
    const monaco = await import("monaco-editor/esm/vs/editor/editor.api");
    await import("monaco-editor/esm/vs/editor/editor.all");
    await import("monaco-editor/esm/vs/basic-languages/monaco.contribution");
    if (!configured) {
      configured = true;
      monaco.editor.defineTheme(EDITOR_THEME, {
        base: "vs-dark",
        inherit: true,
        rules: ayuMonokaiMonacoRules.map((rule) => ({
          token: rule.token,
          foreground: rule.foreground.replace("#", ""),
          ...(rule.fontStyle ? { fontStyle: rule.fontStyle } : {}),
        })),
        colors: ayuMonokaiMonacoColors as Record<string, string>,
      });
      registerWordCompletion(monaco);
    }
    return monaco;
  })();
  return monacoPromise;
}

/**
 * Document-local word completion, registered for every language so the list is
 * the same behaviour in a `.ts` file and a `.md` one. The vocabulary is the
 * open document; matching and ranking live in `lib/editor/word-completions.ts`.
 *
 * The provider claims the request (`incompleteCompletions` is not set, and no
 * other provider is registered), so the popup holds exactly the document's
 * words. Enter and Tab accept the highlighted entry, Escape closes it, and Tab
 * indents when the popup is closed — Monaco's own keybindings.
 */
function registerWordCompletion(monaco: MonacoModule) {
  const wordIndexCache = new WeakMap<object, { text: string; index: ReturnType<typeof collectDocumentWords> }>();
  monaco.languages.registerCompletionItemProvider("*", {
    triggerCharacters: [],
    provideCompletionItems(model, position) {
      const text = model.getValue();
      let cached = wordIndexCache.get(model);
      if (!cached || cached.text !== text) {
        cached = { text, index: collectDocumentWords(text) };
        wordIndexCache.set(model, cached);
      }
      const line = model.getLineContent(position.lineNumber);
      const prefix = prefixAtCaret(line.slice(0, position.column - 1));
      if (!prefix) return { suggestions: [] };
      const completions = completeWords(cached.index, prefix, { excludeWord: prefix });
      const word = model.getWordAtPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: (word?.startColumn ?? position.column - prefix.length),
        endColumn: word?.endColumn ?? position.column,
      };
      return {
        suggestions: completions.map((entry, order) => ({
          kind: monaco.languages.CompletionItemKind.Keyword,
          label: entry.word,
          insertText: entry.word,
          filterText: entry.word,
          range,
          // A word that appears more often wins; the index order breaks ties.
          sortText: String(order).padStart(4, "0"),
          detail: entry.count > 1 ? `${entry.count}× in this document` : "in this document",
        })),
      };
    },
  });
}

export interface CodeEditorHandle {
  focus(): void;
  save(): void;
  revealLine(line: number): void;
  getValue(): string;
}

interface Props {
  filePath: string;
  /** The text on disk (or in the buffer). A new value replaces the buffer only
   *  when the file changed underneath, never while the user is mid-edit. */
  value: string;
  onChange?: (value: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
  wordWrap?: boolean;
  /** Line to reveal and focus, for a blame jump. */
  revealLine?: number;
  /** Keeps the panel's scroll position across a tab switch. */
  onScroll?: (top: number) => void;
  minHeight?: number;
}

export const CodeEditor = forwardRef<CodeEditorHandle, Props>(function CodeEditor({
  filePath,
  value,
  onChange,
  onSave,
  readOnly = false,
  wordWrap = false,
  revealLine,
  onScroll,
  minHeight = 240,
}, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<import("monaco-editor/esm/vs/editor/editor.api").editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<MonacoModule | null>(null);
  const modelFileRef = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const [failed, setFailed] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const language = useMemo(() => languageForPath(filePath), [filePath]);

  useEffect(() => {
    let disposed = false;
    let subscription: { dispose(): void } | null = null;
    let scrollSubscription: { dispose(): void } | null = null;
    const host = hostRef.current;
    if (!host) return;
    (async () => {
      let monaco: MonacoModule;
      try {
        monaco = await loadMonaco();
      } catch (error) {
        if (!disposed) setFailed((error as Error).message || "The editor failed to load.");
        return;
      }
      if (disposed || !hostRef.current) return;
      monacoRef.current = monaco;
      const editor = monaco.editor.create(hostRef.current, {
        value,
        language,
        theme: EDITOR_THEME,
        readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        renderLineHighlight: "all",
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: true,
        foldingStrategy: "indentation",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        matchBrackets: "always",
        wordWrap: wordWrap ? "on" : "off",
        padding: { top: 8, bottom: 8 },
        scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10, useShadows: false },
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        overviewRulerLanes: 0,
        renderWhitespace: "selection",
        renderControlCharacters: false,
        links: true,
        // The document's own words, nothing else.
        wordBasedSuggestions: "off",
        quickSuggestions: { other: true, comments: false, strings: false },
        suggest: {
          showWords: false,
          showKeywords: false,
          showSnippets: false,
          showClasses: false,
          showFunctions: false,
          showVariables: false,
          localityBonus: true,
          preview: false,
        },
        // Sublime's Tab: it completes inside a word and accepts a visible
        // suggestion; with nothing to complete it indents as usual.
        tabCompletion: "on",
        acceptSuggestionOnEnter: "on",
        acceptSuggestionOnCommitCharacter: false,
        multiCursorModifier: "alt",
        accessibilitySupport: "auto",
        ariaLabel: `Editing ${filePath}`,
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
        stickyScroll: { enabled: false },
      });
      editorRef.current = editor;
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => onSaveRef.current?.());
      subscription = editor.onDidChangeModelContent(() => {
        const model = editor.getModel();
        onChangeRef.current?.(model?.getValue() ?? "");
      });
      if (onScroll) {
        scrollSubscription = editor.onDidScrollChange((event) => onScroll(event.scrollTop));
      }
      setReady(true);
      setFailed(null);
    })();
    return () => {
      disposed = true;
      subscription?.dispose();
      scrollSubscription?.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
      modelFileRef.current = null;
    };
    // The editor is created once; file and option changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new file replaces the model, so undo history, cursor and folding belong
  // to one file rather than to the panel.
  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !ready) return;
    if (modelFileRef.current === filePath) return;
    modelFileRef.current = filePath;
    const model = monaco.editor.getModel(monaco.Uri.file(filePath))
      ?? monaco.editor.createModel(value, language, monaco.Uri.file(filePath));
    editor.setModel(model);
    if (revealLine) {
      editor.revealLineInCenter(revealLine);
      editor.setPosition({ lineNumber: revealLine, column: 1 });
      editor.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, ready, language, revealLine]);

  // A reload (an external change accepted by the user) sets the buffer; typing
  // never flows back here, because the parent's `value` is the buffer itself.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || modelFileRef.current !== filePath) return;
    const current = model.getValue();
    if (current === value) return;
    const position = editor.getPosition();
    const scrollTop = editor.getScrollTop();
    const edits = model.getFullModelRange();
    model.setValue(value);
    if (position) editor.setPosition(position);
    editor.setScrollTop(scrollTop);
  }, [value, filePath]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({ readOnly, wordWrap: wordWrap ? "on" : "off" } as never);
  }, [readOnly, wordWrap]);

  useImperativeHandle(ref, () => ({
    focus() {
      editorRef.current?.focus();
    },
    save() {
      onSaveRef.current?.();
    },
    revealLine(line: number) {
      const editor = editorRef.current;
      if (!editor) return;
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
      editor.focus();
    },
    getValue() {
      return editorRef.current?.getValue() ?? "";
    },
  }), []);

  return (
    <div className="code-editor-host" style={{ minHeight }}>
      <div ref={hostRef} className="code-editor-monaco" />
      {failed ? (
        <div className="file-viewer-message code-editor-failed">
          The editor did not start: {failed}
        </div>
      ) : null}
      <span className="sr-only">{AYU_MONOKAI_NAME} theme</span>
    </div>
  );
});
