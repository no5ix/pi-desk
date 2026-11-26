#!/usr/bin/env node
/**
 * Generates `lib/editor/ayu-monokai.ts` from the vendored TextMate theme, so
 * the editor, the completion menu and the read view all read one palette.
 *
 *   node scripts/build-ayu-monokai.mjs
 *
 * Source: `vendor/ayu-monokai/Ayu Monokai-color-theme.json` (the theme file
 * from the Ayu Monokai VS Code extension). Nothing here is hand-copied: the UI
 * colours come from `workbench.colorCustomizations`, the syntax colours from
 * `tokenColors`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const THEME_FILE = path.join(ROOT, "vendor/ayu-monokai/Ayu Monokai-color-theme.json");

function stripJsonComments(text) {
  return text
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[}\]])/g, "$1");
}

const theme = JSON.parse(stripJsonComments(readFileSync(THEME_FILE, "utf8")));
const colors = theme.colors ?? {};
const tokenColors = theme.tokenColors ?? [];

/** TextMate scope prefixes → the scope names Monaco's languages emit. Monaco
 *  matches a rule against a token's scope by prefix, so a coarse prefix set is
 *  enough, and the TextMate names that survive are the ones a real token gets. */
const MONACO_SCOPES = [
  ["comment", "comment"],
  ["string", "string"],
  ["constant.numeric", "number"],
  ["constant.language", "constant.language"],
  ["constant", "constant"],
  ["keyword.operator", "keyword.operator"],
  ["keyword", "keyword"],
  ["storage.type", "storage.type"],
  ["storage", "storage"],
  ["support.type.property-name", "type"],
  ["support.type", "type"],
  ["support.class", "class"],
  ["support.function", "identifier"],
  ["support", "support"],
  ["entity.name.tag", "tag"],
  ["entity.name.function", "identifier"],
  ["entity.name.type", "type.identifier"],
  ["entity.name", "entity.name"],
  ["entity.other.attribute-name", "attribute.name"],
  ["variable.language", "variable.language"],
  ["variable.parameter", "parameter"],
  ["variable.member", "property"],
  ["variable", "variable"],
  ["meta.tag", "metatag"],
  ["punctuation.definition.tag", "metatag"],
  ["punctuation.separator", "delimiter"],
  ["punctuation", "delimiter"],
  ["invalid", "invalid"],
  ["meta.decorator", "annotation"],
  ["meta.diff.header", "metatag"],
  ["markup.heading", "keyword"],
  ["markup.inserted", "string.inserted"],
  ["markup.deleted", "string.deleted"],
  ["markup.changed", "string.changed"],
];

/** The most specific rule wins; Monaco applies `inherit` rules in order, so the
 *  generated list is ordered from the most to the least specific prefix. */
const syntaxRules = new Map();
for (const entry of tokenColors) {
  const scopes = Array.isArray(entry.scope) ? entry.scope : String(entry.scope ?? "").split(",");
  const foreground = entry.settings?.foreground;
  const fontStyle = entry.settings?.fontStyle;
  for (const raw of scopes) {
    const scope = raw.trim();
    if (!scope) continue;
    for (const [prefix, monaco] of MONACO_SCOPES) {
      if (scope === prefix || scope.endsWith(` ${prefix}`) || scope === monaco) {
        const existing = syntaxRules.get(monaco);
        // Later entries in the theme refine earlier ones; a rule with no
        // foreground is a reset and must not erase a colour already set.
        if (foreground) syntaxRules.set(monaco, { token: monaco, foreground, fontStyle });
        else if (existing && fontStyle) existing.fontStyle = fontStyle;
      }
    }
  }
}

/** The palette in CSS custom properties, so plain CSS (the file panel chrome,
 *  the read view, the fallback editor) reads the same values. */
const CSS_VARS = {
  "editor-background": colors["editor.background"],
  "editor-foreground": colors["editor.foreground"],
  "editor-selection-background": colors["editor.selectionBackground"],
  "editor-selection-highlight": colors["editor.selectionHighlightBackground"],
  "editor-word-highlight": colors["editor.wordHighlightBackground"],
  "editor-cursor": colors["editorCursor.foreground"],
  "editor-line-highlight": colors["editor.lineHighlightBackground"],
  "editor-line-number": colors["editorLineNumber.foreground"],
  "editor-line-number-active": colors["editorLineNumber.activeForeground"],
  "editor-gutter-background": colors["editorGutter.background"],
  "editor-gutter-added": colors["editorGutter.addedBackground"],
  "editor-gutter-modified": colors["editorGutter.modifiedBackground"],
  "editor-gutter-deleted": colors["editorGutter.deletedBackground"],
  "editor-guide": colors["editorIndentGuide.background1"],
  "editor-guide-active": colors["editorIndentGuide.activeBackground1"],
  "editor-find-match": colors["editor.findMatchBackground"],
  "editor-find-match-border": colors["editor.findMatchBorder"],
  "editor-bracket-match": colors["editorBracketMatch.background"],
  "editor-bracket-match-border": colors["editorBracketMatch.border"],
  "editor-widget-background": colors["editorWidget.background"],
  "editor-widget-border": colors["editorWidget.border"],
  "editor-suggest-highlight": colors["editorSuggestWidget.highlightForeground"],
  "editor-suggest-selected": colors["editorSuggestWidget.selectedBackground"],
  "editor-hover-background": colors["editorHoverWidget.background"],
  "editor-hover-border": colors["editorHoverWidget.border"],
  "editor-scrollbar-slider": colors["editorScrollbarSlider.background"],
  "editor-scrollbar-slider-hover": colors["editorScrollbarSlider.hoverBackground"],
  "list-hover": colors["list.hoverBackground"],
  "list-active-selection": colors["list.activeSelectionBackground"],
  "list-inactive-selection": colors["list.inactiveSelectionBackground"],
  "list-highlight": colors["list.highlightForeground"],
  "menu-background": colors["menu.background"],
  "menu-selection": colors["menu.selectionBackground"],
  "menu-foreground": colors["menu.foreground"],
  "menu-selection-foreground": colors["menu.selectionForeground"],
  "menu-separator": colors["menu.separatorBackground"],
  "panel-background": colors["panel.background"],
  "panel-border": colors["panel.border"],
  "side-bar-background": colors["sideBar.background"],
  "activity-bar-background": colors["activityBar.background"],
  "status-bar-background": colors["statusBar.background"],
  "title-bar-background": colors["titleBar.activeBackground"],
  "tab-active-background": colors["tab.activeBackground"],
  "tab-inactive-background": colors["tab.inactiveBackground"],
  "text-link-foreground": colors["textLink.foreground"],
  "diff-inserted": colors["diffEditor.insertedTextBackground"],
  "diff-deleted": colors["diffEditor.removedTextBackground"],
};

/** Syntax colours for the token classes the read view (Prism/react-syntax-
 *  highlighter) and any CSS-only fallback use. Keyed by the token class name. */
function scopeColor(scope) {
  for (const entry of [...tokenColors].reverse()) {
    const scopes = Array.isArray(entry.scope) ? entry.scope : String(entry.scope ?? "").split(",");
    for (const raw of scopes) {
      const s = raw.trim();
      if (s === scope && entry.settings?.foreground) return entry.settings.foreground;
    }
  }
  return colors["editor.foreground"];
}

const SYNTAX = {
  comment: scopeColor("comment"),
  keyword: scopeColor("keyword"),
  keywordControl: scopeColor("keyword.control"),
  operator: scopeColor("keyword.operator"),
  storage: scopeColor("storage"),
  string: scopeColor("string"),
  regexp: scopeColor("string.regexp"),
  number: scopeColor("constant.numeric"),
  constant: scopeColor("constant.language"),
  symbol: scopeColor("constant.other.symbol"),
  function: scopeColor("entity.name.function"),
  class: scopeColor("entity.name.type"),
  type: scopeColor("support.type"),
  property: scopeColor("variable.member"),
  variable: scopeColor("variable"),
  parameter: scopeColor("variable.parameter"),
  tag: scopeColor("entity.name.tag"),
  attribute: scopeColor("entity.other.attribute-name"),
  punct: scopeColor("punctuation"),
  link: scopeColor("markup.underline.link"),
  inserted: scopeColor("markup.inserted"),
  deleted: scopeColor("markup.deleted"),
  changed: scopeColor("markup.changed"),
  invalid: scopeColor("invalid"),
};

const hex = (value) => (typeof value === "string" && value.startsWith("#") ? value : null);
function rgba(value, alpha) {
  const h = hex(value);
  if (!h) return value;
  const digits = h.slice(1);
  const full = digits.length === 3 ? digits.split("").map((d) => d + d).join("") : digits;
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
  const sourceAlpha = full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1;
  return `rgba(${r}, ${g}, ${b}, ${Math.round(sourceAlpha * alpha * 1000) / 1000})`;
}

const monacoColors = {
  "editor.background": colors["editor.background"],
  "editor.foreground": colors["editor.foreground"],
  "editorLineNumber.foreground": colors["editorLineNumber.foreground"],
  "editorLineNumber.activeForeground": colors["editorLineNumber.activeForeground"],
  "editorCursor.foreground": colors["editorCursor.foreground"],
  "editor.selectionBackground": colors["editor.selectionBackground"],
  "editor.selectionHighlightBackground": colors["editor.selectionHighlightBackground"],
  "editor.wordHighlightBackground": colors["editor.wordHighlightBackground"],
  "editor.lineHighlightBackground": colors["editor.lineHighlightBackground"],
  "editorIndentGuide.background1": colors["editorIndentGuide.background1"],
  "editorIndentGuide.activeBackground1": colors["editorIndentGuide.activeBackground1"],
  "editorGutter.background": colors["editorGutter.background"],
  "editorGutter.addedBackground": colors["editorGutter.addedBackground"],
  "editorGutter.modifiedBackground": colors["editorGutter.modifiedBackground"],
  "editorGutter.deletedBackground": colors["editorGutter.deletedBackground"],
  "editorBracketMatch.background": colors["editorBracketMatch.background"],
  "editorBracketMatch.border": colors["editorBracketMatch.border"],
  "editor.findMatchBackground": colors["editor.findMatchBackground"],
  "editorWidget.background": colors["editorWidget.background"],
  "editorWidget.border": colors["editorWidget.border"],
  "editorSuggestWidget.background": colors["editorSuggestWidget.background"],
  "editorSuggestWidget.border": colors["editorSuggestWidget.border"],
  "editorSuggestWidget.foreground": colors["editorSuggestWidget.foreground"],
  "editorSuggestWidget.highlightForeground": colors["editorSuggestWidget.highlightForeground"],
  "editorSuggestWidget.selectedBackground": colors["editorSuggestWidget.selectedBackground"],
  "editorHoverWidget.background": colors["editorHoverWidget.background"],
  "editorHoverWidget.border": colors["editorHoverWidget.border"],
  "editorWhitespace.foreground": colors["editorWhitespace.foreground"],
  "scrollbarSlider.background": rgba(colors["editorScrollbarSlider.background"], 1),
  "scrollbarSlider.hoverBackground": rgba(colors["editorScrollbarSlider.hoverBackground"], 1),
  "scrollbarSlider.activeBackground": rgba(colors["editorScrollbarSlider.activeBackground"], 1),
};

const cssVariables = {
  ...CSS_VARS,
  ...Object.fromEntries(
    Object.entries(SYNTAX).map(([key, value]) => [
      `syn-${key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())}`,
      value,
    ]),
  ),
};
const cssBlock = Object.entries(cssVariables)
  .map(([key, value]) => `  --${key}: ${value};`)
  .join("\n");

const out = [
  "// GENERATED by scripts/build-ayu-monokai.mjs - do not edit.",
  `// Source: vendor/ayu-monokai/Ayu Monokai-color-theme.json ("${theme.name}").`,
  "// The editor, its completion menu, the read view and the file panel chrome read",
  "// these values, so the palette exists in exactly one place.",
  "",
  `export const AYU_MONOKAI_NAME = ${JSON.stringify(theme.name)};`,
  "",
  `export const ayuMonokaiColors = ${JSON.stringify(CSS_VARS, null, 2)} as const;`,
  "",
  `export const ayuMonokaiSyntax = ${JSON.stringify(SYNTAX, null, 2)} as const;`,
  "",
  "/** Monaco's colors section, straight from the theme's colorCustomizations. */",
  `export const ayuMonokaiMonacoColors = ${JSON.stringify(monacoColors, null, 2)} as const;`,
  "",
  "/** Monaco token rules, in theme order (Monaco matches a rule by scope prefix). */",
  "export interface EditorTokenRule { token: string; foreground: string; fontStyle?: string }",
  "",
  `export const ayuMonokaiMonacoRules: EditorTokenRule[] = ${JSON.stringify([...syntaxRules.values()], null, 2)};`,
  "",
  "/** CSS custom properties for the file panel scope, ready to paste into CSS. */",
  "export const ayuMonokaiCssBlock = `",
  cssBlock,
  "`;",
  "",
].join("\n");

mkdirSync(path.join(ROOT, "lib/editor"), { recursive: true });
writeFileSync(path.join(ROOT, "lib/editor/ayu-monokai.ts"), out);
console.log(
  `lib/editor/ayu-monokai.ts: ${Object.keys(CSS_VARS).length} ui colours, ${syntaxRules.size} token rules`,
);
