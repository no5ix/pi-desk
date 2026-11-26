import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium, webkit } from "playwright";

/**
 * The composer's corner, measured.
 *
 * The ask: the corner is not part of the resting card. A one-line prompt is a one-row card;
 * the second line — typed or wrapped — raises the corner in the card's UPPER-RIGHT, the text
 * keeps a gutter for it, and the same mark turned around is the way back. What the
 * screenshots cannot say, and this measures:
 *
 *  - a resting card (empty, and one line of text) has no corner at all;
 *  - the corner is a real target (36px for a finger, 26px for a pointer), in the card's own
 *    upper-RIGHT corner, and the text stops short of it — the first line is never typed
 *    under it;
 *  - expanding takes the height the collapsed card caps at 200px, the card stays inside the
 *    shell, the row stays a row, and Send keeps the card's bottom-right arc;
 *  - with the phone's keyboard up, the editor is sized by the room above the keyboard AND
 *    never falls back under the collapsed box it grew out of (the phone's report: the card
 *    "changes back" when the keyboard pops out);
 *  - collapsing gives the collapsed box back. The composer sizes its textarea inline, and
 *    the fold has to out-inline it — the regression this pins is a collapsed card that kept
 *    the 340px editor it had grown.
 *
 * The fixture mirrors the composer and the overlay it floats in (including the line
 * measurement that gates the corner); both mirrors are asserted against the sources, so a
 * fixture that drifts measures nothing.
 */
const out = "test-results/composer-expand";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/composer-expand.fixture.jsx"],
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

const server = createServer((req, res) => {
  if (req.url.startsWith("/fixture.js")) {
    res.setHeader("Content-Type", "text/javascript");
    res.end(js);
    return;
  }
  if (req.url === "/styles.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

// The mirror, against the sources it models.
const chatInput = await readFile("components/ChatInput.tsx", "utf8");
const chatWindow = await readFile("components/ChatWindow.tsx", "utf8");
const themeCss = await readFile("app/native-theme.css", "utf8");
for (const needle of [
  'className={`chat-composer',
  'className="chat-composer-editor"',
  'className="chat-input-textarea"',
  'className="chat-composer-actions"',
  "data-inline={compact ? undefined : \"true\"}",
  "flexDirection: compact ? \"column\" : \"row\",",
  "alignItems: compact ? \"stretch\" : \"flex-end\",",
  "flex: compact ? \"none\" : \"1 1 auto\",",
  "minHeight: compact ? 96 : 24,",
  "maxHeight: 200,",
  'className="chat-composer-expand"',
  "const cornerVisible = !compact && Boolean(onExpandedChange)",
  "(expanded || textLines > COMPOSER_CORNER_MIN_LINES)",
  "{cornerVisible && (",
  "measureComposerTextLines(ta)",
  'data-expanded={expanded ? "true" : "false"}',
  "const from = ta.offsetHeight;",
  "const target = Math.min(ta.scrollHeight, 200);",
  "void ta.offsetHeight;",
]) {
  assert.ok(chatInput.includes(needle), `the composer ships ${needle}; the fixture must mirror it`);
}
assert.ok(chatWindow.includes('className={isEmptyNew ? "relative shrink-0" : "chat-composer-overlay absolute inset-x-0 z-20"}'),
  "the card floats in the overlay; the fixture must mirror it");
for (const needle of [
  ".chat-composer > .chat-composer-expand",
  "top: calc(var(--composer-send-size) / 2 - 5px);",
  "right: calc(var(--composer-send-size) / 2 - 5px);",
  "top: calc(var(--composer-send-size) / 2 - 10px);",
  "right: calc(var(--composer-send-size) / 2 - 10px);",
  "min-height: min(42dvh, 300px) !important",
  "max-height: min(58dvh, 520px) !important",
  "min-height: min(46dvh, 340px) !important",
  "clamp(224px, calc(var(--app-viewport-height, 100dvh) * 0.52), calc(var(--app-viewport-height, 100dvh) * 0.72))",
  "max-height: calc(var(--app-viewport-height, 100dvh) * 0.72) !important",
  "padding-right: 34px",
  "padding-right: 40px",
  "padding-right: 46px",
]) {
  assert.ok(themeCss.includes(needle), `the stylesheet ships ${needle}; the run measures the shipped rule`);
}
// The corner sits in the upper-RIGHT, on Send's line: a stylesheet that moves it back to the
// left, or that reserves the gutter on the wrong side, is what these needles catch.
assert.ok(!/\.chat-composer > \.chat-composer-expand \{[^}]*left:/.test(themeCss),
  "the corner has no left anchor: it is the card's upper-right, on Send's vertical line");

const measure = () => {
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom, top: b.top };
  };
  const card = document.querySelector(".chat-composer");
  const ta = document.querySelector(".chat-input-textarea");
  const corner = document.querySelector(".chat-composer-expand");
  const send = document.querySelector(".composer-send-button");
  const shell = document.querySelector(".app-shell");
  const cs = getComputedStyle(ta);
  return {
    expanded: card.classList.contains("is-expanded"),
    hasExpand: card.classList.contains("has-expand"),
    cornerState: corner ? corner.dataset.expanded : null,
    cornerLabel: corner ? corner.getAttribute("aria-label") : null,
    corner: rect(corner),
    card: rect(card),
    ta: { ...rect(ta), client: ta.clientHeight, scroll: ta.scrollHeight },
    taPadLeft: parseFloat(cs.paddingLeft),
    taPadRight: parseFloat(cs.paddingRight),
    editorDirection: getComputedStyle(document.querySelector(".chat-composer-editor")).flexDirection,
    send: rect(send),
    shell: rect(shell),
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
};

async function shape({ name, engine, viewport, coarse }) {
  const browser = engine === "webkit" ? await webkit.launch() : await chromium.launch();
  const page = await browser.newPage({ ...viewport, isMobile: coarse, hasTouch: coarse, deviceScaleFactor: coarse ? 3 : 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`http://127.0.0.1:${port}/?v=${name}`);
  await page.waitForSelector(".chat-composer");
  const plate = coarse ? 36 : 26;
  // The gutter is the text's `padding-right` in the shape the corner arrives with (stacked):
  // 40px for a pointer, 46px for a finger.
  const gutter = coarse ? 46 : 40;
  const results = [];

  // The resting card: empty, and one line, carry no corner at all.
  const idle = await page.evaluate(measure);
  results.push(["idle", idle]);
  assert.equal(idle.corner, null, `${name}: an empty card shows no corner`);
  assert.equal(idle.hasExpand, false, `${name}: and reserves no gutter for a corner it does not draw`);
  assert.ok(idle.card.h < 260, `${name}: the resting card is a card, not an editor (${Math.round(idle.card.h)}px)`);

  await page.click(".chat-input-textarea");
  await page.keyboard.insertText("One line");
  await page.waitForTimeout(400);
  const oneLine = await page.evaluate(measure);
  results.push(["one line", oneLine]);
  assert.equal(oneLine.corner, null, `${name}: a one-line prompt keeps the corner away`);

  // The second line raises it, in the card's upper-right, with the text clear of it.
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("the second line");
  await page.waitForSelector(".chat-composer-expand");
  await page.waitForTimeout(400);
  const rest = await page.evaluate(measure);
  results.push(["rest", rest]);
  assert.ok(rest.corner, `${name}: a prompt with a second line raises the corner`);
  assert.equal(rest.hasExpand, true, `${name}: and the card reserves the text's gutter`);
  assert.ok(Math.abs(rest.corner.w - rest.corner.h) < 0.6, `${name}: the corner's plate is square`);
  assert.ok(Math.abs(rest.corner.w - plate) < 1, `${name}: the corner's plate is ${plate}px for this pointer (${rest.corner.w})`);
  const cardInsetTop = rest.corner.top - rest.card.top;
  const cardInsetRight = rest.card.right - rest.corner.right;
  assert.ok(cardInsetTop >= 0 && cardInsetTop <= 10, `${name}: the corner sits in the card's top edge (${Math.round(cardInsetTop)}px in)`);
  assert.ok(cardInsetRight >= 0 && cardInsetRight <= 10, `${name}: the corner sits in the card's RIGHT edge (${Math.round(cardInsetRight)}px in)`);
  assert.ok(Math.abs(rest.taPadRight - gutter) < 1, `${name}: the text keeps a ${gutter}px gutter for the corner (${rest.taPadRight})`);
  const textInkRight = rest.ta.right - rest.taPadRight;
  assert.ok(textInkRight <= rest.corner.x + 1,
    `${name}: the text's box stops short of the plate (${Math.round(textInkRight)} before ${Math.round(rest.corner.x)})`);
  assert.ok(rest.card.h < 260, `${name}: a two-line card is still a card (${Math.round(rest.card.h)}px)`);
  assert.equal(rest.cornerState, "false", `${name}: the collapsed corner says collapsed`);
  assert.ok(/Expand/.test(rest.cornerLabel), `${name}: the collapsed corner is labelled for what it does (${rest.cornerLabel})`);

  // The corner goes back when the prompt shrinks to one line.
  await page.fill(".chat-input-textarea", "One line");
  await page.waitForTimeout(400);
  const shrunk = await page.evaluate(measure);
  results.push(["shrunk", shrunk]);
  assert.equal(shrunk.corner, null, `${name}: a prompt that shrinks to one line takes the corner back`);

  await page.fill(".chat-input-textarea", "One line\nand a second line");
  await page.waitForSelector(".chat-composer-expand");
  await page.waitForTimeout(300);
  await page.click(".chat-composer-expand");
  await page.waitForTimeout(500);
  const wide = await page.evaluate(measure);
  results.push(["expanded", wide]);
  assert.equal(wide.expanded, true, `${name}: the card is the tall editor`);
  assert.equal(wide.cornerState, "true", `${name}: the corner turned into the way back`);
  assert.ok(/Collapse/.test(wide.cornerLabel), `${name}: and is labelled for it (${wide.cornerLabel})`);
  assert.ok(wide.ta.h >= 300, `${name}: the editor is a screen of text, not a 200px box (${Math.round(wide.ta.h)}px)`);
  assert.ok(wide.ta.h > rest.ta.h + 200, `${name}: it took the room the collapsed card did not have`);
  assert.equal(wide.editorDirection, "row", `${name}: the card stays one row: the text grows, the controls ride its bottom edge`);
  assert.ok(wide.card.bottom <= wide.shell.bottom + 1, `${name}: the grown card stays inside the shell (${Math.round(wide.card.bottom)} of ${Math.round(wide.shell.bottom)})`);
  assert.ok(wide.send.bottom <= wide.card.bottom + 1 && wide.send.right <= wide.card.right + 1,
    `${name}: Send keeps the card's bottom-right corner while the card grows`);
  assert.ok(wide.corner.top - wide.card.top <= 10 && wide.card.right - wide.corner.right <= 10,
    `${name}: the corner stays in the card's upper-right as the card grows`);
  assert.ok(wide.scrollWidth <= wide.innerWidth, `${name}: nothing runs sideways`);

  // A long prompt: the editor scrolls its own text and never outgrows the screen.
  await page.click(".chat-input-textarea");
  await page.keyboard.insertText(Array.from({ length: 46 }, (_, i) => `Line ${i + 1}: the composer's corner turns the card into an editor tall enough to read a paragraph.`).join("\n"));
  await page.waitForTimeout(400);
  const long = await page.evaluate(measure);
  results.push(["long", long]);
  assert.ok(long.ta.scroll > long.ta.client + 200, `${name}: a long prompt scrolls inside the editor (${long.ta.client} of ${long.ta.scroll})`);
  assert.ok(long.card.h <= long.innerHeight, `${name}: a long prompt never pushes the card past the screen (${Math.round(long.card.h)} of ${long.innerHeight})`);
  assert.ok(long.card.bottom <= long.shell.bottom + 1, `${name}: the card with a long prompt is still inside the shell`);

  // The phone's keyboard: the editor is measured against the room above it.
  if (coarse) {
    const keyboardHeight = 560;
    await page.evaluate((px) => {
      document.documentElement.setAttribute("data-keyboard-open", "true");
      document.documentElement.style.setProperty("--app-viewport-height", `${px}px`);
    }, keyboardHeight);
    await page.waitForTimeout(400);
    const kb = await page.evaluate(measure);
    results.push(["keyboard", kb]);
    assert.ok(kb.ta.h <= keyboardHeight * 0.72 + 2,
      `the editor fits the room above the keyboard (${Math.round(kb.ta.h)} of ${Math.round(keyboardHeight * 0.72)})`);
    assert.ok(kb.ta.h >= Math.max(224, keyboardHeight * 0.52) - 2,
      `and takes it: a tall prompt is typed where the thumb is (${Math.round(kb.ta.h)})`);
    // The phone's report: the keyboard must never size the open editor back under the
    // collapsed card's own 200px box (the 224px floor is what pins it).
    assert.ok(kb.ta.h > 200,
      `the keyboard does not collapse the editor back: ${Math.round(kb.ta.h)}px, over the collapsed box's 200px`);
    assert.ok(kb.card.bottom <= kb.shell.bottom + 1, "the card never stands under the keyboard");
    await page.evaluate(() => {
      document.documentElement.removeAttribute("data-keyboard-open");
      document.documentElement.style.removeProperty("--app-viewport-height");
    });
    await page.waitForTimeout(300);
  }

  // The way back. The composer sizes the textarea inline, so collapsing has to out-inline
  // it; the regression is a collapsed card that kept the editor's height.
  await page.click(".chat-composer-expand");
  await page.waitForTimeout(600);
  const folded = await page.evaluate(measure);
  results.push(["folded", folded]);
  assert.equal(folded.expanded, false, `${name}: the corner folded the card`);
  assert.ok(folded.ta.h <= 202, `${name}: the box is back inside the composer's own 200px cap (${Math.round(folded.ta.h)}px)`);
  // What the fold owes the reader is the card's own chrome back: the band around the
  // text (the row, the card's insets) is the resting card's band, and only the text box
  // carries the prompt it was given.
  const restChrome = rest.card.h - rest.ta.h;
  const foldedChrome = folded.card.h - folded.ta.h;
  assert.ok(Math.abs(foldedChrome - restChrome) <= 40,
    `${name}: the folded card is the resting card plus the text (${Math.round(foldedChrome)} of ${Math.round(restChrome)} chrome)`);

  const brief = results.map(([state, m]) => `${state}: card ${Math.round(m.card.h)} · editor ${Math.round(m.ta.h)} · corner ${m.corner ? `${Math.round(m.corner.w)}@${Math.round(m.corner.top - m.card.top)},${Math.round(m.card.right - m.corner.right)}` : "none"} · gutter ${m.taPadRight}`);
  assert.deepEqual(errors, [], `${name}: no page errors`);
  await page.screenshot({ path: `${out}/${name}-folded.png` });
  await browser.close();
  return brief;
}

for (const brief of [
  await shape({ name: "phone", engine: "webkit", viewport: { viewport: { width: 390, height: 844 } }, coarse: true }),
  await shape({ name: "desktop", engine: "chromium", viewport: { viewport: { width: 1280, height: 900 } }, coarse: false }),
]) {
  console.log(brief.join("\n"));
}
server.close();
console.log("the composer's corner: no corner on a resting card, a plate in the upper-left with the second line, a screen of text, the keyboard's room, and the way back");
