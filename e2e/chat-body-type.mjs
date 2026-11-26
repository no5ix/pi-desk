import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The type a compaction's summary and a subagent's report are set in.
 *
 * Both are bodies of prose the user reads, so they carry the final report's type — the
 * app's UI face, its character spacing, its leading — at the thinking card's size.
 * Upstream set a report in a 13px terminal face on 1.32 leading (pi's TUI aligns an
 * extension's text in columns), the fork cut it to 11px, and a compaction inherited the
 * 14px reply body: one card came out as terminal output, the other as a bigger copy of
 * the conversation.
 *
 * The claims are measurable in the real components:
 *
 *  · both card bodies are the thinking card's `font-size` (12px), not 11px and not 14px;
 *  · both are the reply's `font-family`, `letter-spacing` and `line-height` ratio,
 *    measured against the same page's `.markdown-body` prose — not a name match;
 *  · a chip of inline code inside them is mono and sized to the 12px prose around it,
 *    so a chip cannot tower over its own sentence;
 *  · a fenced block inside a card keeps the mono face at the fence's own size;
 *  · the compaction's intro line is the same size as the summary under it (one body),
 *    while the card's title stays the bigger heading;
 *  · the old build (the 11px mono rule and the 14px compaction body restored) measures
 *    the bug, so a green run here is a run that measured something.
 */
const out = "test-results/chat-body-type";
await mkdir(out, { recursive: true });

// The pre-fix state, restored as an esbuild / stylesheet control. Every anchor throws
// if the source moved, so the control cannot silently measure the new build.
const OLD_RULE = ".markdown-custom-message {\n  font-size: calc(11px + var(--chat-font-size-offset, 0px));\n  font-weight: var(--fw-regular);\n  line-height: 1.5;\n}";
const NEW_RULE_RE = /\.markdown-custom-message,\n\.markdown-compaction-message \{[\s\S]*?\n\}/;
const NEW_WRAPPER_RE = /<div\n          className="compaction-card-body"\n          style=\{\{\n            padding: "11px 13px 12px",[\s\S]*?\}\}\n        >/;
const NEW_INTRO = '{ marginTop: 3, marginBottom: 10, color: "var(--text)" }';

const oldBuild = {
  name: "restore-the-old-type",
  setup(b) {
    b.onLoad({ filter: /MessageView\.tsx$/ }, async (args) => {
      const text = await readFile(args.path, "utf8");
      if (!NEW_WRAPPER_RE.test(text)) throw new Error(`the old-build control lost the compaction body in ${args.path}`);
      if (!text.includes(NEW_INTRO)) throw new Error(`the old-build control lost the compaction intro in ${args.path}`);
      return {
        contents: text
          .replace(NEW_WRAPPER_RE, '<div className="compaction-card-body" style={{ padding: "11px 13px 12px" }}>')
          .replace(NEW_INTRO, `${NEW_INTRO.slice(0, -2)}, fontSize: "calc(14px + var(--chat-font-size-offset, 0px))", lineHeight: 1.5 }`),
        loader: "tsx",
      };
    });
  },
};

await build({
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  entryPoints: ["e2e/chat-body-type.fixture.jsx"],
  outfile: `${out}/fixture.js`,
});
await build({
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  entryPoints: ["e2e/chat-body-type.fixture.jsx"],
  outfile: `${out}/old-build.js`,
  plugins: [oldBuild],
});

const sheets = {
  "styles.css": (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
    .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n"),
};
const theme = sheets["styles.css"];
if (!NEW_RULE_RE.test(theme)) throw new Error("the stylesheet lost the shared type rule the control replaces");
sheets["old-styles.css"] = theme.replace(NEW_RULE_RE, OLD_RULE);

const bundles = {
  "fixture.js": await readFile(`${out}/fixture.js`),
  "old-build.js": await readFile(`${out}/old-build.js`),
  ...sheets,
};

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = url.pathname.slice(1);
  if (bundles[file]) {
    res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "text/javascript");
    res.end(bundles[file]);
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/${url.searchParams.get("css") || "styles.css"}"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/${url.searchParams.get("bundle") || "fixture.js"}"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

/**
 * Read the computed type of every body the eye compares.
 *
 * `getComputedStyle` reports `line-height` in px, so the ratio to the element's own
 * font-size is the number that says "this leading"; `letter-spacing` is `normal` on the
 * reply's prose, which is the value the cards have to match.
 */
const READ = () => {
  const type = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      size: cs.fontSize,
      family: cs.fontFamily,
      spacing: cs.letterSpacing,
      leading: cs.lineHeight,
      ratio: Math.round((parseFloat(cs.lineHeight) / parseFloat(cs.fontSize)) * 100) / 100,
      mono: cs.fontFamily.includes("monospace"),
    };
  };
  const inCase = (name, selector) => type(document.querySelector(`section[data-case="${name}"] ${selector}`));
  const summary = document.querySelector('section[data-case="compaction"] .markdown-compaction-message');
  const cardBody = summary?.parentElement ?? null;
  return {
    report: type(document.querySelector('section[data-case="report"] .markdown-body p')),
    reportCode: type(document.querySelector('section[data-case="report"] .markdown-body .markdown-inline-code')),
    thinking: type(document.querySelector('section[data-case="thinking"] .thinking-card > div')),
    compaction: inCase("compaction", ".markdown-compaction-message"),
    compactionItem: inCase("compaction", ".markdown-compaction-message li"),
    compactionIntro: type(cardBody?.children[1]),
    compactionTitle: type(cardBody?.children[0]),
    compactionCode: inCase("compaction", ".markdown-compaction-message .markdown-inline-code"),
    compactionFence: inCase("compaction", ".markdown-compaction-message .markdown-code-block pre"),
    subagent: inCase("subagent", ".markdown-custom-message"),
    subagentItem: inCase("subagent", ".markdown-custom-message li"),
    subagentCode: inCase("subagent", ".markdown-custom-message .markdown-inline-code"),
    subagentFence: inCase("subagent", ".markdown-custom-message .markdown-code-block pre"),
  };
};

const open = async (browser, query) => {
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  page.on("pageerror", (error) => { throw new Error(`the fixture threw: ${error.message}`); });
  await page.goto(`${base}?${query}`);
  await page.waitForSelector('section[data-case="subagent"] .custom-message-header');
  // Both cards open collapsed with their header as the toggle; a body that is not in
  // the DOM has no computed type, so open them the way a reader does.
  await page.click('section[data-case="compaction"] .compaction-card-header');
  await page.click('section[data-case="subagent"] .custom-message-header');
  await page.waitForSelector('section[data-case="subagent"] .markdown-custom-message');
  const read = await page.evaluate(READ);
  await page.close();
  return read;
};

const browser = await chromium.launch();
let read;
let oldRead;
try {
  read = await open(browser, "bundle=fixture.js&css=styles.css");
  oldRead = await open(browser, "bundle=old-build.js&css=old-styles.css");
} finally {
  await browser.close();
}

for (const key of ["report", "thinking", "compaction", "compactionIntro", "subagent", "compactionCode", "subagentCode", "subagentFence", "compactionFence"]) {
  assert.ok(read[key], `the fixture measured ${key} (null means the node is not on the page)`);
}

// The two references the request is measured against.
assert.equal(read.report.size, "14px", `the reply's prose is the 14px body (measured ${read.report.size})`);
assert.equal(read.report.ratio, 1.7, `a reply leads at 1.7 (measured ${read.report.ratio})`);
assert.equal(read.report.spacing, "normal", "a reply tracks nothing");
assert.ok(!read.report.mono, "a reply is set in the app's UI face, not a terminal face");
assert.equal(read.thinking.size, "12px", `the thinking card's body is 12px (measured ${read.thinking.size})`);

for (const [name, body] of [["a compaction's summary", read.compaction], ["a subagent's report", read.subagent]]) {
  assert.equal(body.size, read.thinking.size, `${name} is the thinking card's size (measured ${body.size})`);
  assert.equal(body.family, read.report.family, `${name} is the final report's font type`);
  assert.ok(!body.mono, `${name} is not set in a terminal face`);
  assert.equal(body.spacing, read.report.spacing, `${name} has the final report's character spacing`);
  assert.equal(body.ratio, read.report.ratio, `${name} has the final report's line spacing (measured ${body.ratio})`);
}

// The list rows of each body, measured on their own.
assert.equal(read.compactionItem.size, read.compaction.size, "a compaction bullet is the body's size");
assert.equal(read.subagentItem.size, read.subagent.size, "a report bullet is the body's size");

// A chip of inline code is mono and measured against the prose it sits in.
for (const [name, chip, body] of [["a compaction", read.compactionCode, read.compaction], ["a report", read.subagentCode, read.subagent]]) {
  assert.ok(chip.mono, `${name}'s inline code stays mono`);
  assert.equal(chip.size, body.size, `${name}'s inline code fits the prose around it (chip ${chip.size}, body ${body.size})`);
  assert.notEqual(chip.family, body.family, `${name}'s inline code is the mono face, not the prose face`);
}

// A fenced block inside a card is still a fence: mono, and not the body's type.
for (const [name, fence, body] of [["a compaction", read.compactionFence, read.compaction], ["a report", read.subagentFence, read.subagent]]) {
  assert.ok(fence.mono, `${name}'s fenced block keeps the mono face`);
  assert.notEqual(fence.family, body.family, `${name}'s fence is not set in the prose face`);
}

// The compaction card: one body of prose under a heading that is still a heading.
assert.equal(read.compactionIntro.size, read.compaction.size, "the intro line is the same prose as the summary under it");
assert.ok(parseFloat(read.compactionTitle.size) > parseFloat(read.compaction.size), `the card's title stays the bigger heading (${read.compactionTitle.size} over ${read.compaction.size})`);

// The old build measures the bug, so these numbers are not a tautology.
assert.equal(oldRead.subagent.size, "11px", `the old report was 11px (measured ${oldRead.subagent.size})`);
assert.ok(oldRead.subagent.mono, "the old report was set in a terminal face");
assert.ok(oldRead.subagent.ratio < 1.7, `the old report led tighter than the reply (${oldRead.subagent.ratio})`);
assert.equal(oldRead.compaction.size, "14px", `the old compaction body was the 14px reply body (measured ${oldRead.compaction.size})`);
assert.equal(oldRead.compactionIntro.size, "14px", "the old intro line sized itself above the summary");
assert.notEqual(oldRead.compaction.size, oldRead.thinking.size, "the old compaction body was not the thinking card's size");

server.close();
console.log("chat body type:", JSON.stringify({
  report: read.report,
  thinking: read.thinking,
  compaction: read.compaction,
  compactionCode: read.compactionCode,
  subagent: read.subagent,
  subagentCode: read.subagentCode,
  old: { subagent: oldRead.subagent, compaction: oldRead.compaction },
}, null, 2));
