import { getFileExt } from "../file-types.ts";

/**
 * Extension → the Monaco / TextMate language identifier. Deliberately short:
 * every language Monaco ships works from its own id, and an unknown extension
 * falls back to plaintext, which still gives the editor's editing features and
 * the theme's default colours.
 */
const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  jsonl: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  vue: "html",
  svelte: "html",
  xml: "xml",
  svg: "xml",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  py: "python",
  pyi: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  psm1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  sql: "sql",
  graphql: "graphql",
  lua: "lua",
  r: "r",
  dart: "dart",
  dockerfile: "dockerfile",
  makefile: "makefile",
  diff: "diff",
  patch: "diff",
  pl: "perl",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  clj: "clojure",
  scala: "scala",
  groovy: "groovy",
  vim: "vim",
  lua_: "lua",
};

const FILENAME_LANGUAGES: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  "gitignore": "ini",
  "gitattributes": "ini",
  ".gitignore": "ini",
  ".gitattributes": "ini",
  ".env": "ini",
  "agents.md": "markdown",
  "readme": "markdown",
  "license": "markdown",
};

export function languageForPath(filePath: string): string {
  const base = filePath.replace(/\\/g, "/").split("/").pop() ?? "";
  const lower = base.toLowerCase();
  const fromName = FILENAME_LANGUAGES[lower];
  if (fromName) return fromName;
  const ext = getFileExt(filePath).toLowerCase();
  if (ext === "containerfile") return "dockerfile";
  return EXTENSION_LANGUAGES[ext] ?? "plaintext";
}

/** Files the editor may open for writing. Binary and document formats keep the
 *  existing read-only viewers, so the list is "text the read endpoint returns". */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tiff", "avif", "heic", "heif",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp",
  "mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "mp4", "webm", "mov", "avi", "mkv",
  "zip", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "war", "dmg", "iso",
  "woff", "woff2", "ttf", "otf", "eot",
  "so", "dylib", "dll", "exe", "bin", "o", "a", "class", "pyc", "pyo", "wasm",
  "db", "sqlite", "sqlite3", "pack", "idx",
]);

export function isEditableExtension(filePath: string): boolean {
  const ext = getFileExt(filePath).toLowerCase();
  if (!ext) return true; // An extensionless file (Makefile, LICENSE, CHANGELOG) is text.
  return !BINARY_EXTENSIONS.has(ext);
}
