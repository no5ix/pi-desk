import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * A collapsed thinking card, measured on a phone's width.
 *
 * Two of the phone's screenshots, in one check. The card's glyph stood 10px in from
 * the clock of the finished turn above it (the card's own 10px inset), so the
 * conversation's left edge was ragged; and a thinking that runs on ended in a single
 * `…` drawn by `text-overflow`, which on a mono line reads as the reasoning's own
 * punctuation. The card now carries no left inset, and the cut is named by the three
 * marks the app uses everywhere else, painted over the line's end on the card's fill.
 */
const out = "test-results/thinking-preview";
await mkdir(out, { recursive: true });
await build({
  bundle: true,
  platform: "browser",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
  entryPoints: ["e2e/thinking-preview.fixture.jsx"],
  outfile: `${out}/fixture.js`,
});

const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");
const bundle = await readFile(`${out}/fixture.js`);

const server = createServer((req, res) => {
  if (req.url.startsWith("/fixture.js")) {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundle);
    return;
  }
  if (req.url.startsWith("/styles.css")) {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForSelector(".thinking-card .thinking-preview");

const read = await page.evaluate(() => {
  const box = (el) => {
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, right: Math.round(b.right * 10) / 10 };
  };
  const clock = document.querySelector(".message-turn-duration svg");
  const footer = document.querySelector(".message-assistant-footer");
  const footerInk = footer?.firstElementChild
    ? box(footer.firstElementChild.querySelector("svg") ?? footer.firstElementChild)
    : null;
  const prose = document.querySelector("[data-message-text]");
  const cards = [...document.querySelectorAll(".thinking-card")].map((card) => {
    const preview = card.querySelector(".thinking-preview");
    const glyph = card.querySelector("button svg");
    const after = preview ? getComputedStyle(preview, "::after") : null;
    const style = preview ? getComputedStyle(preview) : null;
    const line = preview ? Math.round(preview.firstElementChild?.getBoundingClientRect().height ?? preview.getBoundingClientRect().height) : 0;
    return {
      glyph: box(glyph),
      cardPadLeft: getComputedStyle(card).paddingLeft,
      preview: preview ? box(preview) : null,
      clipped: preview?.dataset.clipped ?? null,
      display: style?.display,
      whiteSpace: style?.whiteSpace,
      textOverflow: style?.textOverflow,
      scrollWidth: preview?.scrollWidth,
      clientWidth: preview?.clientWidth,
      line,
      afterContent: after?.content,
      afterRight: after ? Number.parseFloat(after.right) : null,
      afterBackground: after?.backgroundColor,
      cardBackground: getComputedStyle(card).backgroundColor,
      afterColor: after?.color,
      textEnd: preview?.textContent.trim().slice(-4),
      dots: card.querySelectorAll(".thinking-preview-dots").length,
      onPlate: !!card.closest(".process-details-content"),
      onPlate: !!card.closest(".process-details-content"),
    };
  });
  // The plate's colour, flattened: what the marks over a thought inside the Process
  // details group must be painted on. A probe element resolves the token to a colour.
  const plateCard = document.querySelector("[data-plate] .thinking-card");
  let plate = null;
  if (plateCard) {
    const host = plateCard.closest(".process-details-content");
    const probe = document.createElement("div");
    probe.style.display = "none";
    probe.style.background = getComputedStyle(plateCard).getPropertyValue("--thinking-cut-surface").trim();
    host.appendChild(probe);
    plate = { surface: getComputedStyle(probe).backgroundColor, hostBackground: getComputedStyle(host).backgroundColor };
    probe.remove();
  }
  return { clock: clock ? box(clock) : null, footerInk, prose: prose ? box(prose) : null, cards, plate, pageBackground: getComputedStyle(document.body).backgroundColor };
});

const [long, short] = read.cards;
assert.ok(read.prose, "the conversation's prose is measured, the column's ink edge");
assert.ok(long, "the long thinking renders a collapsed card");

// 1. The glyph stands on the conversation's ink edge: the same left edge as the prose
//    and the finished turn's row above it (the row with the clock that says how long
//    the turn took). The card's own 10px inset used to push it in.
assert.ok(Math.abs(long.glyph.x - read.prose.x) <= 1,
  `the thinking's glyph is on the prose's edge, not 10px in (glyph x=${long.glyph.x}, prose x=${read.prose.x})`);
assert.ok(long.glyph.x <= read.footerInk.x + 1,
  `and never in from the row above it (glyph x=${long.glyph.x}, row x=${read.footerInk.x})`);
assert.equal(long.cardPadLeft, "0px", "the card carries no left inset of its own");

// 2. The line is cut, and the cut is named by the three marks — painted over the end,
//    on the card's own fill, at the box's right edge.
assert.ok(long.scrollWidth > long.clientWidth, `the long thinking is cut (text ${long.scrollWidth}px in a ${long.clientWidth}px box)`);
assert.equal(long.textOverflow, "clip", "no ellipsis character: the cut is not the text's own punctuation");
assert.equal(long.clipped, "true", "the card knows the line is cut");
assert.equal(long.afterContent, '"•••"', "the marks are the three dots the app uses everywhere else");
assert.ok(long.whiteSpace === "nowrap" && long.line <= Math.round(long.preview.h * 1.2),
  `the collapsed thinking stays on one line (${long.line}px of ${long.preview.h}px)`);
const marksRight = long.preview.right;
assert.ok(Number.isFinite(marksRight), "the marks sit at the box's right edge");
assert.ok(!long.textEnd.includes("…"), `the visible text does not end in an ellipsis (${JSON.stringify(long.textEnd)})`);
assert.equal(long.afterBackground, long.cardBackground, "the marks sit on the card's fill, not a band of their own");

// 3. A thought that ends before the box shows no marks at all.
assert.ok(!short.clipped, `a short thought is not cut, and says so (data-clipped=${short.clipped})`);
assert.equal(short.afterContent, "none", "so nothing is painted over its end");
assert.equal(short.dots, 0, "and no inline marks either: the text ended by itself");

// 4. The usual place for a collapsed thought is the turn's Process details plate, which
//    is translucent. Marks painted in the page's colour cut a light rectangle into it,
//    so the marks carry the plate flattened: opaque, and the plate's own colour.
const channels = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 4).map(Number);
const plateCard = read.cards.find((card) => card.onPlate);
assert.ok(plateCard, "the fixture draws a thought inside the Process details plate");
assert.equal(plateCard.afterContent, '"•••"', "and it is cut the same way");
assert.ok(plateCard.afterBackground, "the marks are painted on a colour");
const markAlpha = channels(plateCard.afterBackground)[3] ?? 1;
assert.ok(markAlpha > 0.99, `the marks are opaque over the line, not translucent (${plateCard.afterBackground})`);
assert.equal(plateCard.afterBackground, read.plate.surface, `the marks carry the plate's colour (${plateCard.afterBackground} vs ${read.plate.surface})`);
const markToPage = Math.max(...channels(plateCard.afterBackground).slice(0, 3).map((v, i) => Math.abs(v - channels(read.pageBackground)[i])));
assert.ok(markToPage >= 2, `the plate is not the page, so the marks are not the page's colour either (Δ${markToPage}: ${plateCard.afterBackground} on ${read.pageBackground})`);

await page.screenshot({ path: `${out}/thinking-collapsed.png`, clip: { x: 0, y: 0, width: 390, height: 420 } });
await context.close();
await browser.close();
server.close();
console.log(`PASS: ${out} — a collapsed thinking's glyph stands on the conversation's ink edge, and its cut line ends with the three marks (${JSON.stringify({ glyph: long.glyph.x, prose: read.prose.x, marks: long.afterContent })})`);
