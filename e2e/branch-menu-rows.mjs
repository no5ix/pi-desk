import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The composer branch chip's rows, measured in a browser.
 *
 * A remote branch name like `claude/settings-layout-review-8265af` wrapped to
 * three lines inside the row's button, and the `remote` tag — right-aligned in
 * that button — was pushed past its edge and painted over the branch and
 * worktree icons that sit after it. A unit render cannot see that: the overlap
 * is layout, not markup. So this mounts the real panel with the real CSS and
 * asserts, for every row, that the tag's box and the icon boxes do not intersect
 * and that no name is cut.
 *
 * The last pass serves the same fixture with the fix rules removed, and expects
 * to measure the overlap: a check that cannot see the bug it was written for is
 * not a check.
 */
const out = "test-results/branch-menu-rows";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/branch-menu-rows.fixture.jsx"],
  bundle: true,
  platform: "browser",
  outfile: `${out}/fixture.js`,
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const js = await readFile(`${out}/fixture.js`);
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");

function serve(styles) {
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(js);
      return;
    }
    if (req.url === "/styles.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(styles);
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const MEASURE = () => {
  const intersects = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  };
  const rows = [];
  for (const row of document.querySelectorAll(".sidebar-project-context-menu-row--branch")) {
    const button = row.querySelector('button[role="menuitem"]');
    const name = row.querySelector(".sidebar-project-context-menu-branch-name");
    const tag = row.querySelector(".sidebar-project-context-menu-branch-tag");
    const actions = Array.from(row.querySelectorAll(".sidebar-project-context-menu-branch-action")).map(box);
    const tagBox = tag ? box(tag) : null;
    rows.push({
      text: name.textContent,
      name: { ...box(name), scrollWidth: name.scrollWidth, clientWidth: name.clientWidth },
      button: box(button),
      tag: tagBox,
      tagText: tag ? tag.textContent : null,
      actions,
      tagOverIcon: tagBox ? actions.some((a) => intersects(tagBox, a)) : false,
      tagPastButton: tagBox ? tagBox.right > box(button).right + 0.5 : false,
      gapToIcons: tagBox ? actions[0].left - tagBox.right : null,
      menuWidth: document.querySelector(".sidebar-project-context-menu").getBoundingClientRect().width,
    });
  }
  return rows;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 800 } });

const server = await serve(css);
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForSelector(".sidebar-project-context-menu-row--branch");
const rows = await page.evaluate(MEASURE);
server.close();

assert.ok(rows.length >= 6, `every branch row renders (${rows.length})`);
const menuWidth = rows[0].menuWidth;
// 240 is the wide project menu; a scrolled menu reserves the scrollbar.
assert.ok(menuWidth > 225 && menuWidth <= 240, `the chip's menu is the wide project menu (${menuWidth})`);

for (const row of rows) {
  const label = row.text;
  assert.equal(row.actions.length, 2, `${label}: the two action icons`);
  assert.ok(!row.tagOverIcon, `${label}: the "${row.tagText}" tag does not overlap the row's icons`);
  assert.ok(!row.tagPastButton, `${label}: the "${row.tagText}" tag stays inside the row's button`);
  if (row.tag) {
    assert.ok(row.gapToIcons >= 1, `${label}: ${row.gapToIcons.toFixed(1)}px between the tag and the icons`);
  }
  assert.ok(row.name.scrollWidth <= row.name.clientWidth + 1, `${label}: the name is not cut (${row.name.scrollWidth} > ${row.name.clientWidth})`);
  assert.ok(row.button.right <= row.actions[0].left + 0.5, `${label}: the button ends where the icons start`);
}
  // The long names wrap — that is what leaves the tag its room — and a row stays
  // a row: a branch name squeezed to one character per line is unreadable, and
  // a menu of 500px rows is unusable.
  const tall = rows.filter((row) => row.name.height > 90);
  assert.equal(tall.length, 0, `no row is squeezed into a vertical strip (${tall.map((r) => `${r.text.slice(0, 20)}: ${Math.round(r.name.height)}px`).join(", ")})`);
  assert.ok(rows.some((row) => row.name.height > 20), "a long branch name wraps to more than one line");

// The control: without the fix rules, the same measurement sees the overlap.
const unfixed = css
  .replace(/\.sidebar-project-context-menu-branch-name \{[^}]*\}/g, "")
  .replace(/\.sidebar-project-context-menu-branch-tag \{\n((?:[^}]*\n)*?)\}/, ".sidebar-project-context-menu-branch-tag {\n  margin-left: auto;\n  color: var(--text-dim);\n  font-family: var(--font-ui);\n  font-size: var(--fs-micro);\n}")
  .replace(/(\.sidebar-project-context-menu-row--branch > button\[role="menuitem"\] \{)([^}]*?)overflow: hidden;/, "$1$2");
assert.notEqual(unfixed, css, "the control strips the rules the fix added");
const oldServer = await serve(unfixed);
await page.goto(`http://127.0.0.1:${oldServer.address().port}/`);
await page.waitForSelector(".sidebar-project-context-menu-row--branch");
const before = await page.evaluate(MEASURE);
oldServer.close();
assert.ok(before.some((row) => row.tagOverIcon || row.tagPastButton),
  "the check can see the bug: without the rules, a tag lands on the icons");

await browser.close();
console.log(`branch menu: ${rows.length} rows at ${Math.round(menuWidth)}px, rows ${Math.round(Math.max(...rows.map((row) => row.name.height)))}px at the tallest, no tag/icon overlap, no clipped name; the un-fixed CSS overlaps ${before.filter((row) => row.tagOverIcon || row.tagPastButton).length} of ${before.length} rows`);
