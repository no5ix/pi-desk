# Editor theme: one Ayu Monokai palette across the file surfaces

The file panel and the chat show the same document in five ways — the Markdown
preview, the Markdown source, a fenced code block, a source read view and the
Monaco editor. They are themed by one palette in one place, and the point of the
arrangement is that a re-tokening pass moves all five together.

## Where each surface gets its colour

| surface | painted by | themed in |
| --- | --- | --- |
| Markdown preview | `components/MarkdownBody.tsx` → `.markdown-body` | `app/native-theme.css` |
| a fenced block in the preview and in chat | `CodeBlock` in `components/MermaidBlock.tsx` | `markdownCodeTheme` / `calmCodeTheme` in `lib/code-theme.ts` |
| source read view (and Markdown source) | `CodeReadView` in `components/FileViewer.tsx` | the same two Prism stylesheets |
| Monaco editing | `components/CodeEditor.tsx` | `lib/editor/ayu-monokai.ts`, generated |
| the app chrome around them | `app/native-theme.css` | the same role tokens |

The rule the whole arrangement rests on: **a component never paints a colour.**
Every syntax, Markdown and editor colour is a role token — `--code-keyword`,
`--md-link`, `--editor-current-line` — declared in the light and the dark
palette blocks of `app/native-theme.css`. `lib/code-theme.ts` hands
`react-syntax-highlighter` a stylesheet whose values are `var(--code-…)`, so the
inline styles it writes resolve against the same palette. A literal in a
component is a second source of truth, and `lib/ayu-palette.test.mjs` fails on
one.

## Markdown, the surface that carries the most meaning

Preview (`.markdown-body`, `app/native-theme.css`): headings are heading amber
with the section-opening rule under h1/h2; **bold** is keyword orange; *emphasis*
is the plain ink italic; a link is the type blue with its bare-URL text in the
comment tone; inline code is string green on the code surface; a blockquote is
the comment tone, italic, behind a keyword-orange rule on a faint plate; list
markers take heading amber (a nested list's rail takes the indent-guide tone, so
nesting is legible); a table's header row is heading amber over a bordered grid;
a checked task box is string green; a raw HTML block is the document ink, on
purpose — markup is structure, not syntax colour. The hierarchy is size, weight
and rules, never six heading hues.

Source view (`markdownCodeTheme` in `lib/code-theme.ts`, chosen in `CodeReadView`
when the file is Markdown): Prism's Markdown grammar aliases a heading to
`title`/`heading`/`bold`/`important` and inline code to `keyword`, so a theme
that only spells code roles makes Markdown read like code. The Markdown sheet
maps Prism's Markdown keys — `title`, `bold`, `important`, `quote`, `url`,
`list`, `table` — to the preview's roles, so a heading, a link and a code span
are the same colour in the preview and in the source. `strike` is the palette's
deleted red because the preview strikes it.

Two `react-syntax-highlighter` facts the sheets depend on:

- the token **class names do not reach the DOM** (the library keeps the styles
  and drops the classes), so a browser test resolves a token's ink by finding the
  deepest span whose text is a known word;
- a nested span inherits its token's style only if the `token` key paints
  nothing. Giving `token` a colour flattens every nested token to one ink —
  keep `token: {}` colourless.

## Monaco

`lib/editor/ayu-monokai.ts` is **generated** from
`vendor/ayu-monokai/Ayu Monokai-color-theme.json` by
`scripts/build-ayu-monokai.mjs`; edit the script and re-run it, never the
output. It translates the theme's own scope table into Monaco's flat token
rules, re-points the syntax roles at the app's palette (`ROLE_OVERRIDES`), names
the editor surface (`EDITOR_SURFACE_OVERRIDES`) and sets the bracket-pair and
guide colours. Two things the generator handles that a hand-written theme
misses:

- Monaco's theme colours lose alpha, so the comment tone (`#ACB6BF8C` over the
  editor page) is handed over as the blended opaque `#646F73`;
- Monaco's defaults for bracket pairs and indentation guides are its own
  gold/magenta/blue, so both are set to palette colours explicitly.

The gutter's ink is set in CSS as well (`.monaco-editor .line-numbers`): the
generated theme alone does not win that element.

Regenerate after touching the script:
`node scripts/build-ayu-monokai.mjs`.

## Light theme

Ayu Monokai is a dark theme; the light palette is derived on the same roles
(paper, ink, and the accents darkened for the light surface). Roles that have no
light equivalent keep their names, so nothing in the app branches on the theme.

## Checking it

- `node --test lib/ayu-palette.test.mjs` — the structure: role tokens declared
  in both themes and painted, no literals in the Prism stylesheet, the requested
  palette present verbatim, the Monaco theme generated and drawn from the
  vendored theme, the editor surface Monaco paints equal to the surface CSS
  paints.
- `node e2e/ayu-theme.mjs` (in `npm run test:e2e`) — the picture. It bundles
  `e2e/ayu-theme.fixture.jsx` (esbuild) with the real app stylesheets, mounts the
  real `FileViewer` in preview / source / Monaco modes for Markdown, TypeScript,
  JSON, CSS and HTML, measures the ink a browser paints, and writes screenshots
  and a report to `test-results/e2e-theme/`.

```
app/native-theme.css                      palette blocks + .markdown-body + the file panel's scope
lib/code-theme.ts                         calmCodeTheme, markdownCodeTheme
lib/editor/ayu-monokai.ts                 generated Monaco theme
scripts/build-ayu-monokai.mjs             the generator
vendor/ayu-monokai/Ayu Monokai-color-theme.json  the vendored theme (license: public/THIRD_PARTY_NOTICES.txt)
components/FileViewer.tsx                 CodeReadView picks the Markdown sheet; the diff rows paint by class
components/MermaidBlock.tsx               CodeBlock, the fenced block in chat and the preview
lib/ayu-palette.test.mjs                  the palette as a system
e2e/ayu-theme.mjs / e2e/ayu-theme.fixture.jsx  the palette as a picture
```
