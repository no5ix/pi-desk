import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The editor palette, checked as a system and not as a picture.
 *
 * `e2e/ayu-theme.mjs` measures the ink a browser paints. This file guards the
 * structure that makes one picture possible, because a palette that drifts into
 * component files is invisible to a screenshot of one document:
 *
 *  1. every role token (`--code-*`, `--md-*`, `--editor-*`) is declared in both
 *     themes, so a light page and a dark page carry the same set of roles;
 *  2. nothing is painted with a colour the palette does not name: the Prism
 *     stylesheets reach the screen through CSS custom properties, and the file
 *     panel's Markdown, source and diff surfaces name the role tokens;
 *  3. the requested palette is present verbatim, so a re-tokening pass cannot
 *     quietly repaint the editor away from the theme it is built on;
 *  4. `lib/editor/ayu-monokai.ts` is generated, and its colours come from the
 *     vendored theme — editing it by hand breaks the one place the palette lives;
 *  5. the generated Monaco theme's surface colours agree with the CSS tokens for
 *     the same roles, so the editor and the panel around it are one surface.
 */
/** The vendored theme carries comments (the generator strips them); read it the
 *  same way so the check sees the same object the generator does. */
function readThemeJson(path) {
  const text = readFileSync(path, "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(text);
}

const CSS = readFileSync("app/native-theme.css", "utf8");
const CODE_THEME = readFileSync("lib/code-theme.ts", "utf8");
const MONACO_THEME = readFileSync("lib/editor/ayu-monokai.ts", "utf8");
const GENERATOR = readFileSync("scripts/build-ayu-monokai.mjs", "utf8");
const VENDORED = readThemeJson("vendor/ayu-monokai/Ayu Monokai-color-theme.json");

/** The two palette blocks, found by what they declare: the file is long, and the
 *  selectors (`:root`, `html.dark`) repeat, so the roles are the handle. */
function blockContaining(marker) {
  const at = CSS.indexOf(marker);
  assert.ok(at >= 0, `app/native-theme.css declares ${marker} in its palette`);
  const open = CSS.lastIndexOf("{", at);
  let depth = 0;
  for (let i = open; i < CSS.length; i += 1) {
    if (CSS[i] === "{") depth += 1;
    if (CSS[i] === "}" && (depth -= 1) === 0) return CSS.slice(open, i);
  }
  assert.fail(`unbalanced block at ${marker}`);
}

const LIGHT = blockContaining("--editor-bg: #ffffff");
const DARK = blockContaining("--editor-bg: #0b0e14");

const declared = (text) => new Set([...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const roleNames = (text) => new Set([...text.matchAll(/(--(?:code|md|editor)-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
// Painted means: named in the sheet, or named as a role in the Prism stylesheet
// (lib/code-theme.ts paints the source view and a fenced block inline, from the
// same tokens). Both paths are the palette reaching the screen. The app's own
// roles (`--text`, `--text-muted`) are not the palette's and are checked where
// Prism is: every colour it paints must be declared in both themes.
const rolesUsed = new Set([
  ...CSS.matchAll(/var\((--(?:code|md|editor)-[a-z0-9-]+)[),]/g),
  ...CODE_THEME.matchAll(/"var\((--(?:code|md|editor)-[a-z0-9-]*)\)"/g),
].map((m) => m[1]));

test("every syntax, Markdown and editor role token is declared in both themes", () => {
  const light = roleNames(LIGHT);
  const dark = roleNames(DARK);
  // A role may be spelled once, outside both blocks, when its value is a role
  // that already follows the theme (`--code-surface: var(--bg-panel)`) — one
  // declaration, two themes. Anything theme-specific belongs in both blocks.
  const shared = new Set([...roleNames(CSS)].filter((role) => !light.has(role) && !dark.has(role)));
  assert.ok(rolesUsed.size >= 30, `the palette's roles paint the sheet (${rolesUsed.size} names)`);
  for (const role of rolesUsed) {
    const inShared = shared.has(role);
    assert.ok(inShared || light.has(role), `${role} is used but not declared for a light page`);
    assert.ok(inShared || dark.has(role), `${role} is used but not declared for a dark page`);
  }
  // The declarations are the palette; a role declared and never painted is a
  // second source of truth waiting to drift.
  for (const role of new Set([...light, ...dark])) {
    assert.ok(rolesUsed.has(role), `${role} is declared but never painted — drop it or use it`);
  }
});

test("the Prism themes colour with role tokens, not literals", () => {
  const styles = CODE_THEME.slice(CODE_THEME.indexOf("const TEXT"));
  const literals = [...styles.matchAll(/color:\s*["'](#[0-9a-fA-F]{3,8}|rgba?\()/g)];
  assert.deepEqual(literals, [], "a Prism colour must be var(--…) so one palette paints every mode");
  const named = [...styles.matchAll(/const [A-Z_]+ = "(var\(--[a-z0-9-]+\))"/g)].map((m) => m.slice(1)[0].slice(4, -1));
  assert.ok(named.length >= 20, `the roles are named up front (${named.length})`);
  const light = declared(LIGHT);
  const dark = declared(DARK);
  for (const value of named) {
    assert.ok(light.has(value) && dark.has(value), `${value} is painted by Prism, so both themes must declare it`);
  }
});

test("the palette the editor is built on is the palette the file names", () => {
  const requested = {
    "--editor-bg": "#0b0e14",
    "--editor-fg": "#bfbdb6",
    "--editor-current-line": "#131721",
    "--editor-selection": "#409fff4d",
    "--editor-selection-inactive": "#409fff21",
    "--editor-cursor": "#e6b450",
    "--code-comment": "#ACB6BF8C",
    "--code-string": "#AAD94C",
    "--code-constant": "#D2A6FF",
    "--code-keyword": "#FF8F40",
    "--code-function": "#FFB454",
    "--code-type": "#59C2FF",
    "--md-heading": "#FFB454",
    "--md-strong": "#FF8F40",
    "--md-link": "#59C2FF",
    "--md-inline-code": "#AAD94C",
  };
  for (const [token, value] of Object.entries(requested)) {
    const pattern = new RegExp(`${token}:\\s*(${value}|var\\(--[a-z0-9-]+\\))\\s*:?.*?;`, "i");
    assert.ok(pattern.test(DARK), `${token} is ${value} on a dark page, as the palette names it`);
  }
});

test("the Monaco theme is generated, and its colours come from the vendored theme", () => {
  assert.match(MONACO_THEME, /^\/\/ GENERATED by scripts\/build-ayu-monokai\.mjs - do not edit\./);
  const rules = JSON.parse(MONACO_THEME.match(/ayuMonokaiMonacoRules: EditorTokenRule\[\] = (\[[\s\S]*?\n\]);/)[1]);
  assert.ok(rules.length > 20, `${rules.length} token rules`);
  const themeColors = new Set();
  for (const entry of VENDORED.tokenColors) {
    const foreground = entry.settings?.foreground;
    if (typeof foreground === "string") themeColors.add(foreground.toUpperCase());
  }
  for (const key of Object.keys(VENDORED.colors ?? {})) {
    const value = VENDORED.colors[key];
    if (typeof value === "string" && value.startsWith("#")) themeColors.add(value.toUpperCase());
  }
  // The generator re-points a role at the app's palette (`ROLE_OVERRIDES`),
  // names the editor surface (`EDITOR_SURFACE_OVERRIDES`) and spells the read
  // view's roles (`SYNTAX`); those are the only colours allowed beyond the
  // theme's own, and they are all in that part of the script.
  const overrides = GENERATOR.slice(GENERATOR.indexOf("const ROLE_OVERRIDES"), GENERATOR.indexOf("const monacoColors"));
  const allowed = new Set([
    ...themeColors,
    ...[...overrides.matchAll(/"(#[0-9a-fA-F]{3,8})"/g)].map((m) => m[1].toUpperCase()),
  ]);
  for (const rule of rules) {
    assert.ok(allowed.has(rule.foreground.toUpperCase()),
      `the rule for ${rule.token} paints ${rule.foreground}, which the theme and the generator's role table do not name`);
  }
});

test("the editor surface Monaco paints is the surface the panel paints", () => {
  const colors = JSON.parse(MONACO_THEME.match(/ayuMonokaiMonacoColors = (\{[\s\S]*?\n\}) as const;/)[1]);
  const pairs = [
    ["editor.background", "--editor-bg"],
    ["editor.foreground", "--editor-fg"],
    ["editor.lineHighlightBackground", "--editor-current-line"],
    ["editor.selectionBackground", "--editor-selection"],
    ["editor.inactiveSelectionBackground", "--editor-selection-inactive"],
    ["editorCursor.foreground", "--editor-cursor"],
  ];
  for (const [monacoColor, token] of pairs) {
    const fromCss = (DARK.match(new RegExp(`${token}:\\s*([^;]+);`)) ?? [])[1]?.trim();
    assert.ok(fromCss, `${token} is declared`);
    assert.equal(String(colors[monacoColor]).toLowerCase(), String(fromCss).toLowerCase(),
      `${monacoColor} is the panel's ${token}: the editor and the file panel are one surface`);
  }
});

test("the palette lives in one place: no component paints an editor colour", () => {
  const files = [
    "components/CodeEditor.tsx",
    "components/FileViewer.tsx",
    "components/MermaidBlock.tsx",
    "components/MarkdownBody.tsx",
  ];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const source = readFileSync(file, "utf8");
    const literals = [...source.matchAll(/color:\s*["'](#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))["']/g)];
    assert.deepEqual(literals, [], `${file} paints with a literal; the palette's tokens are the way`);
  }
});
