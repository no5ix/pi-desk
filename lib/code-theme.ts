import { vs } from "react-syntax-highlighter/dist/esm/styles/prism";

/* Ayu Monokai, as the one syntax palette for both colour modes.
 *
 * The hues are the ones `vendor/ayu-monokai/Ayu Monokai-color-theme.json` names:
 * `lib/editor/ayu-monokai.ts` (the generated Monaco theme) reads that file, and
 * the Markdown preview's ink in app/native-theme.css is the same set. Every
 * value below is a `var(--code-*)`, `var(--md-*)` or app role token, so a
 * light/dark switch stays a CSS change and the highlighter never re-renders for
 * it. The same tokens paint the editor, the Markdown preview and a fenced block
 * in a chat reply, so one document — a Markdown file with fenced TypeScript in
 * it — is one palette top to bottom, in source and in preview.
 *
 * Prism's stock `vs` / `vscDarkPlus` themes use five-plus saturated hues. This
 * keeps their layout and recolours every token from the palette: keyword and
 * storage warm, strings green, numbers and constants purple, functions amber,
 * types and classes blue, properties the theme's rose, comments the muted
 * comment tone, variables and default text the editor foreground.
 *
 * Two things the stock stylesheet does not do, and this file has to:
 *
 *  - `vs` carries no key for Markdown's markup. Prism's markdown grammar names a
 *    heading `title`, a bullet `list`, a quote marker `blockquote` and an inline
 *    code run `code`, and aliases the bullet, the quote marker and a rule to
 *    `punctuation`; with no key, every one of them falls back to the default
 *    ink and a Markdown file reads as one flat colour. The EXTRA table below
 *    names them, in the ink the rendered preview gives the same construct.
 *  - a link's label and its target are one token tree (`url` containing
 *    `variable` and `string`), so the label is the link colour and the URL is
 *    the muted ink — the same split the preview makes between the phrase and a
 *    bare address.
 */
type Style = Record<string, string | number>;

const TEXT = "var(--text)";
const MUTED = "var(--text-muted)";
const COMMENT = "var(--code-comment)";
const KEYWORD = "var(--code-keyword)";
const STRING = "var(--code-string)";
const CONSTANT = "var(--code-constant)";
const FUNCTION = "var(--code-function)";
const TYPE = "var(--code-type)";
const PROPERTY = "var(--code-property)";
const OPERATOR = "var(--code-operator)";
const REGEXP = "var(--code-regexp)";
const INSERTED = "var(--code-inserted)";
const DELETED = "var(--code-deleted)";
const CHANGED = "var(--code-changed)";
const PUNCTUATION = "var(--code-punctuation)";
const HEADING = "var(--md-heading)";
const STRONG = "var(--md-strong)";
const LINK = "var(--md-link)";
const LINK_URL = "var(--md-link-url)";
const MARKDOWN_CODE = "var(--md-inline-code)";
const LIST = "var(--md-list)";
const QUOTE = "var(--md-quote)";
const RULE = "var(--md-rule)";

/* Order matters: a token is recoloured by the first group it matches, and the
 * groups read Prism's (`refractor`'s) token names. */
const GROUPS: Array<[RegExp, string, Style?]> = [
  // Markdown markup: the document's own structure, in the preview's ink.
  [/(^|\.)title(\W|$)/, HEADING, { fontWeight: "bold" }],
  [/(^|\.)heading(\W|$)/, HEADING, { fontWeight: "bold" }],
  [/(^|\.)bold(\W|$)/, STRONG, { fontWeight: "bold" }],
  [/(^|\.)italic(\W|$)/, TEXT, { fontStyle: "italic" }],
  [/(^|\.)strikethrough(\W|$)/, MUTED, { textDecoration: "line-through" }],
  [/(^|\.)code-block(\W|$)/, TEXT],
  [/(^|\.)(code-snippet|inline-code|code-kbd)(\W|$)/, MARKDOWN_CODE],
  [/(^|\.)url(\W|$)/, LINK],
  [/(^|\.)(link|reference|reference-url)(\W|$)/, LINK],
  // Source code, in the palette's roles.
  [/(^|\.)(comment|prolog|doctype|cdata|shebang)(\W|$)/, COMMENT],
  // Additions and removals, as a diff shows them: the palette's inserted green
  // and deleted red, the same ink the file panel's diff rows use.
  [/(^|\.)(inserted|addition)(\W|$)/, INSERTED],
  [/(^|\.)(string|char|template-string|attr-value)(\W|$)/, STRING],
  [/(^|\.)(number|boolean|constant|symbol|color|hexcode|escape)(\W|$)/, CONSTANT],
  [/(^|\.)(keyword|module|import|from|export|storage|atrule|at-rule|directive|control|module-export|module-import)(\W|$)/, KEYWORD],
  [/(^|\.)(builtin|class-name|interface|type-identifier|type|trait|struct|enum|union|generic)(\W|$)/, TYPE],
  // Attributes join the function amber: in a tag, the attribute name is the
  // emphasised word, and the vendored theme paints it amber. A tag in the
  // property rose, its attributes amber, its values green.
  [/(^|\.)(function|method|function-definition|function-name|macro|constructor|attr-name)(\W|$)/, FUNCTION],
  [/(^|\.)(property|field|variable\.property|selector|tag|entity\.name\.tag)(\W|$)/, PROPERTY],
  [/(^|\.)operator(\W|$)/, OPERATOR],
  [/(^|\.)(regex|regexp)(\W|$)/, REGEXP],
  [/(^|\.)(annotation|decorator|metatag|meta)(\W|$)/, FUNCTION],
  [/(^|\.)deleted(\W|$)/, DELETED],
  [/(^|\.)changed(\W|$)/, CHANGED],
  [/(^|\.)important(\W|$)/, KEYWORD, { fontWeight: "bold" }],
  [/(^|\.)(punctuation|namespace|delimiter|interpolation)(\W|$)/, PUNCTUATION],
];

/** Prism names these and `vs` carries no key for them, so they need adding, not
 *  recolouring. The dotted keys are Prism's nested token paths: a link's target
 *  (`url.string`) and a link's label (`url.variable`).
 *
 *  The `token` key matters most: react-syntax-highlighter writes an inline style
 *  on every token span, and a nested span's class list is only `token` — with a
 *  colour on that key, every inner span (a tag's name, a bold run's words, a
 *  link's label) overrode its own token and the page flattened to the default
 *  ink. With no colour on `token`, a nested span inherits the token that
 *  contains it, and a tag reads as a tag. */
const EXTRA: Record<string, Style> = {
  token: {},
  title: { color: HEADING, fontWeight: "bold" },
  heading: { color: HEADING, fontWeight: "bold" },
  list: { color: LIST, fontWeight: "bold" },
  // Prism aliases a bullet, a quote marker and a rule to `punctuation`; the
  // token name is carried beside it, and the combinations below let each of the
  // three keep its own ink.
  blockquote: { color: LIST, fontWeight: "bold" },
  quote: { color: QUOTE, fontStyle: "italic" },
  hr: { color: RULE, fontWeight: "bold" },
  color: { color: CONSTANT },
  hexcode: { color: CONSTANT },
  table: { color: TEXT },
  "table-header": { color: HEADING },
  "table-cell": { color: TEXT },
  code: { color: MARKDOWN_CODE },
  "code-snippet": { color: MARKDOWN_CODE },
  "code-block": { color: TEXT },
  bold: { color: STRONG, fontWeight: "bold" },
  italic: { color: TEXT, fontStyle: "italic" },
  "bold-italic": { color: STRONG, fontWeight: "bold", fontStyle: "italic" },
  strike: { color: MUTED, textDecoration: "line-through" },
  strikethrough: { color: MUTED, textDecoration: "line-through" },
  url: { color: LINK },
  "url.variable": { color: LINK },
  "url.string": { color: LINK_URL },
  "url.punctuation": { color: PUNCTUATION },
  builtin: { color: TYPE },
  changed: { color: CHANGED },
  annotation: { color: FUNCTION },
  decorator: { color: FUNCTION },
  escape: { color: CONSTANT },
  "keyword.control": { color: KEYWORD },
  "keyword.module": { color: KEYWORD },
  "variable.property": { color: PROPERTY },
  "string.template": { color: STRING },
  "punctuation.definition.string": { color: PUNCTUATION },
};

function recolour(key: string, base: Style): Style {
  const style: Style = { ...base };
  delete style.background;
  delete style.backgroundColor;
  delete style.textShadow;
  const token = key.split(" ").pop() ?? key;
  for (const [pattern, color, extra] of GROUPS) {
    if (pattern.test(token)) return { ...style, color, ...extra };
  }
  return { ...style, color: TEXT };
}

const LAYOUT_KEYS = new Set(['code[class*="language-"]', 'pre[class*="language-"]']);

const base = Object.fromEntries([
  ...Object.entries(vs as Record<string, Style>).map(([key, base]) => {
    if (LAYOUT_KEYS.has(key)) {
      /* The fenced block's own surface and ink come from the tokens the whole
         editor paints with (`.markdown-code-block`, `.file-source-view`), so the
         Prism layout stays transparent and carries the default foreground. */
      const layout: Style = { ...base, color: TEXT };
      for (const drop of ["border", "background", "backgroundColor"]) delete layout[drop];
      return [key, layout];
    }
    if (key.includes("selection") || key.includes("line-numbers") || key.includes("line-highlight") || key.startsWith("pre >") || key.startsWith(":not(pre)")) return [key, base];
    return [key, recolour(key, base)];
  }),
  ...Object.entries(EXTRA),
]);

/** Markdown, painted as a document and not as code.
 *
 *  Prism's markdown grammar is not shaped like a language: a heading carries
 *  the `bold` and `title` aliases, a bullet, a quote marker and a rule are
 *  `punctuation`, a strike is `strike`, and a link's label and its target are
 *  one `url` tree. With the code roles applied as they are, a Markdown file in
 *  the source view reads as orange headings and gray punctuation while the
 *  preview shows amber headings and a coloured quotation — one file, two moods.
 *
 *  So Markdown gets its own sheet, aimed at the grammar's real names: the
 *  heading ink on a heading (the two-name `bold.title` combination, which the
 *  highlighter applies last), the keyword on emphasis, the default ink on prose,
 *  the link colour on a link and the muted ink on the address it carries, the
 *  string on `` `code` ``, the heading ink on bullets, quote markers and rules.
 *  It is the preview's table, in the source view, from the same tokens.
 *
 *  Two things this sheet deliberately does not do. It leaves `string` and
 *  `keyword` on the code roles, because a fenced block inside Markdown is
 *  highlighted as its own language (TypeScript in a ```` ```ts ```` fence is
 *  coloured as a `.ts` file) and its strings must stay green. And it puts the
 *  heading ink on `bold`: Prism's markdown grammar gives a heading and a bold
 *  run the same class, so one of the two has to carry — the outline wins, as it
 *  does in the preview, and a bold word in the source view reads as the
 *  structure it is. The preview, where the two are separate elements, keeps the
 *  palette's split: heading amber, emphasis the keyword.
 */
export const markdownCodeTheme: Record<string, Style> = {
  ...base,
  title: { color: HEADING, fontWeight: "bold" },
  heading: { color: HEADING, fontWeight: "bold" },
  bold: { color: HEADING, fontWeight: "bold" },
  /* Prism's markdown grammar gives a heading the aliases `bold` and `important`
     and inline code the alias `keyword`; the alias is applied last, so it is the
     alias that has to carry the role. */
  important: { color: HEADING, fontWeight: "bold" },
  "code.keyword": { color: MARKDOWN_CODE },
  list: { color: LIST, fontWeight: "bold" },
  blockquote: { color: LIST, fontWeight: "bold" },
  hr: { color: RULE, fontWeight: "bold" },
  punctuation: { color: LIST, fontWeight: "bold" },
  operator: { color: PUNCTUATION },
  url: { color: LINK },
  "url.variable": { color: LINK },
  "url.string": { color: LINK_URL },
  "url.punctuation": { color: PUNCTUATION },
  code: { color: MARKDOWN_CODE },
  "code-snippet": { color: MARKDOWN_CODE },
  "code-block": { color: TEXT },
  italic: { color: TEXT, fontStyle: "italic" },
  "bold-italic": { color: HEADING, fontWeight: "bold", fontStyle: "italic" },
  strike: { color: MUTED, textDecoration: "line-through" },
  strikethrough: { color: MUTED, textDecoration: "line-through" },
  entity: { color: TYPE },
  table: { color: TEXT },
  "table-header": { color: HEADING },
  "table-cell": { color: TEXT },
};

export const calmCodeTheme = base;
