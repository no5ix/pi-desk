import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium, webkit } from "playwright";

/**
 * The turn's "Edited N files" card: a header that is a band, and a collapse that moves.
 *
 * The card used to end at a header that was the first row of its own table — same fill,
 * same hairline — and its rows were added to and removed from the DOM on the click, so
 * the file list blinked in and out with no motion at all. The header now carries a plate
 * of its own (a step above the card's surface, which is a 48% wash under the transcript),
 * and the list stays mounted while `grid-template-rows: 0fr → 1fr` animates it.
 *
 * Why that mechanism, measured: `interpolate-size: allow-keywords` and `calc-size()` are
 * the newer way to animate a height to `auto`, and they are Chromium-only — on this app's
 * desktop runtime (WKWebView) and on a phone the card would jump. So the transition is
 * measured on **both** engines here, mid-flight: a sample taken while the card folds has
 * to be strictly between the open height and nothing.
 *
 * The claims:
 *
 *  · the header's plate is not the rows' plate, and it is the stronger of the two
 *    (measured alpha, in both themes) — the header reads as the control, not as row one;
 *  · folding and unfolding animate the list's height, on Chromium and on WebKit;
 *  · the rows fade with the track, so a collapse is one move, not rows snapping;
 *  · folded, the rows are `inert`: clipped away and out of the tab order;
 *  · `prefers-reduced-motion: reduce` reaches the same two end states with no motion;
 *  · the card's end states are the ones the user reads: header-only folded, all rows open.
 */
const out = "test-results/turn-files-animation";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/turn-files-animation.fixture.jsx"],
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
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
  if (req.url.startsWith("/api/files/")) {
    // The card asks whether each file still exists. Answer "it does", so no row is
    // drawn in the removed state (dimmed and struck through) for the fixture's sake.
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ type: "meta", exists: true, size: 1234, mtime: Date.now() }));
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

/** `color-mix()` comes back from both engines as `color(srgb r g b / a)`; read the alpha
 *  from after the slash and fall back to the legacy `rgba()` fourth part. */
function alphaOf(value) {
  const text = String(value);
  if (text.includes("/")) {
    const tail = text.slice(text.lastIndexOf("/") + 1).replace(/\).*$/, "").trim();
    const alpha = tail.endsWith("%") ? parseFloat(tail) / 100 : parseFloat(tail);
    if (Number.isFinite(alpha)) return alpha;
  }
  const parts = text.replace(/^rgba?\(|\)$/g, "").split(/[\s,]+/).map(Number);
  return parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1;
}

const READ = () => {
  const list = document.querySelector(".turn-files-list");
  const header = document.querySelector(".turn-files-header");
  const row = document.querySelector(".turn-files-row");
  const card = document.querySelector(".turn-files-card");
  const styles = (node) => getComputedStyle(node);
  const track = styles(list).gridTemplateRows;
  return {
    expanded: header.getAttribute("aria-expanded"),
    // `0fr`/`1fr` while settled, a length (e.g. "148.4px") while the track animates.
    track,
    animating: list.getAnimations().map((animation) => `${animation.constructor.name}:${animation.transitionProperty ?? animation.animationName}`),
    listHeight: +list.getBoundingClientRect().height.toFixed(1),
    cardHeight: +card.getBoundingClientRect().height.toFixed(1),
    headerHeight: +header.getBoundingClientRect().height.toFixed(1),
    headerBackground: styles(header).backgroundColor,
    rowBackground: styles(row).backgroundColor,
    rowOpacity: Number(styles(row).opacity),
    rows: document.querySelectorAll(".turn-files-row").length,
    inert: list.hasAttribute("inert"),
    // A folded list must not be reachable by keyboard; an open one must be.
    rowFocusable: (() => {
      row.focus();
      return document.activeElement === row;
    })(),
  };
};

/** Wait for the card's own transitions to settle, so an end state is measured as an end
 *  state (a mid-flight sample is what the motion assertions want, and it is taken apart). */
const settle = (page) => page.waitForFunction(() => {
  const list = document.querySelector(".turn-files-list");
  return list.getAnimations().every((animation) => animation.playState === "finished" || animation.playState === "idle");
}, { timeout: 4000 });

for (const [engine, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await browserType.launch();
  for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(base);
    await page.waitForSelector(".turn-files-card");
    if (theme === "dark") {
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await page.waitForTimeout(80);
    }

    const open = await page.evaluate(READ);
    assert.equal(open.expanded, "true", `${engine}/${theme}: a finished turn's card starts open`);
    assert.equal(open.rows, 5, `${engine}/${theme}: all five rows render while open (${open.rows})`);
    assert.equal(open.inert, false, `${engine}/${theme}: open rows are reachable`);
    assert.equal(open.rowFocusable, true, `${engine}/${theme}: and focusable`);
    assert.ok(open.listHeight > 0, `${engine}/${theme}: the open list takes its rows' height (${open.listHeight}px, track ${open.track})`);

    // The header is a band, not the first row of the table.
    const headerAlpha = alphaOf(open.headerBackground);
    const rowAlpha = alphaOf(open.rowBackground);
    assert.ok(headerAlpha > 0, `${engine}/${theme}: the header carries a plate (${open.headerBackground})`);
    assert.ok(headerAlpha > rowAlpha,
      `${engine}/${theme}: the header's plate is stronger than the rows' (${open.headerBackground} over ${open.rowBackground})`);

    // Fold: sample the track mid-flight, then measure the end state.
    await page.click(".turn-files-header");
    await page.waitForTimeout(60);
    const folding = await page.evaluate(READ);
    assert.ok(folding.animating.some((name) => name === "CSSTransition:grid-template-rows"),
      `${engine}/${theme}: a fold is a real height transition (${folding.animating.join(", ")})`);
    assert.ok(folding.listHeight > 0 && folding.listHeight < open.listHeight,
      `${engine}/${theme}: the list is between its heights mid-fold (${folding.listHeight}px of ${open.listHeight}px, track ${folding.track})`);
    assert.ok(folding.rowOpacity < 1, `${engine}/${theme}: the rows fade with the track (${folding.rowOpacity})`);

    await settle(page);
    const folded = await page.evaluate(READ);
    assert.equal(folded.expanded, "false", `${engine}/${theme}: the header says folded`);
    assert.equal(folded.listHeight, 0, `${engine}/${theme}: the folded list takes no height (${folded.listHeight}px, track ${folded.track})`);
    assert.equal(folded.inert, true, `${engine}/${theme}: a folded list leaves the tab order`);
    assert.equal(folded.rowFocusable, false, `${engine}/${theme}: and its rows cannot be focused`);
    assert.ok(Math.abs(folded.cardHeight - folded.headerHeight) <= 2,
      `${engine}/${theme}: folded, the card is its header (${folded.cardHeight}px vs ${folded.headerHeight}px, plus the card's hairlines)`);;
    assert.ok(folded.cardHeight < open.cardHeight, `${engine}/${theme}: folding takes the card's height away`);

    // Unfold, and the end state is the open one again.
    await page.click(".turn-files-header");
    await page.waitForTimeout(60);
    const unfolding = await page.evaluate(READ);
    assert.ok(unfolding.animating.some((name) => name === "CSSTransition:grid-template-rows"),
      `${engine}/${theme}: an unfold animates the same way (${unfolding.animating.join(", ")})`);
    assert.ok(unfolding.listHeight > 0 && unfolding.listHeight < open.listHeight,
      `${engine}/${theme}: the list is between its heights mid-unfold (${unfolding.listHeight}px of ${open.listHeight}px, track ${unfolding.track})`);
    await settle(page);
    const reopened = await page.evaluate(READ);
    assert.equal(reopened.listHeight, open.listHeight, `${engine}/${theme}: the reopened list is the height it started at`);
    assert.equal(reopened.rowOpacity, 1, `${engine}/${theme}: the rows end visible (${reopened.rowOpacity})`);
    assert.equal(reopened.inert, false, `${engine}/${theme}: reopened rows are reachable again`);
    assert.deepEqual(errors, [], `${engine}/${theme}: the fixture runs clean (${errors.join("; ")})`);

    if (engine === "chromium") {
      const card = await page.locator(".turn-files-card");
      await page.click(".turn-files-header");
      await settle(page);
      await card.screenshot({ path: `${out}/${theme}-folded.png` });
      await page.click(".turn-files-header");
      await settle(page);
      await card.screenshot({ path: `${out}/${theme}-open.png` });
    }
    await page.close();
  }

  // Reduced motion: the same two end states, with no height transition at all.
  const calm = await browser.newPage({ viewport: { width: 900, height: 700 }, reducedMotion: "reduce" });
  await calm.goto(base);
  await calm.waitForSelector(".turn-files-list");
  await calm.click(".turn-files-header");
  const calmFolding = await calm.evaluate(READ);
  assert.deepEqual(calmFolding.animating.filter((name) => name === "CSSTransition:grid-template-rows"), [],
    `reduced motion: nothing animates the height (${calmFolding.animating.join(", ")})`);
  await calm.waitForTimeout(120);
  const calmFolded = await calm.evaluate(READ);
  assert.equal(calmFolded.listHeight, 0, `reduced motion: the folded list is still gone (${calmFolded.listHeight}px)`);
  assert.equal(calmFolded.inert, true, "reduced motion: and still out of the tab order");
  await calm.click(".turn-files-header");
  await calm.waitForTimeout(120);
  const calmOpen = await calm.evaluate(READ);
  assert.ok(calmOpen.listHeight > 0, `reduced motion: opening shows the rows at once (${calmOpen.listHeight}px)`);
  assert.equal(calmOpen.rowOpacity, 1, `reduced motion: the rows are visible, not left faded (${calmOpen.rowOpacity})`);
  await calm.close();
  await browser.close();
}

server.close();
console.log(`PASS: ${out} — the header is a band, and the file list folds and unfolds as one animated height on both engines`);
