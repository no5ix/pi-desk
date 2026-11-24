import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * Scrolling up in a long session must not move the reader.
 *
 * The chat lazy-loads: the sentinel at the top of the list asks for an older
 * page, the page is prepended, and the viewport has to stay on the row the user
 * is reading. Two mechanisms used to fight over that: the browser's own
 * `overflow-anchor: auto`, and a saved `scrollHeight - scrollTop` distance
 * applied after the list grew. The distance is only exact while the content
 * above is final — a prepended page arrives before deferred code highlighting,
 * images, and a Mermaid render have grown it — and the browser anchors the same
 * prepend on top of it, so scrolling up landed the view on a row nobody pointed
 * at. The fix is one mechanism that owns the position: the row the viewport
 * stands on, measured before the fetch, re-attached in a layout effect, and
 * re-applied while the content above keeps growing.
 *
 * Measured over three pages, with rows growing after they land, plus a control
 * pass (`?broken=1`) that turns the re-attach off and must show the jump.
 */
const out = "test-results/chat-scroll-anchor";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/chat-scroll-anchor.fixture.jsx"],
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
  .map((p) => readFile(p, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");

const source = await readFile("components/ChatWindow.tsx", "utf8");
const fixtureSource = await readFile("e2e/chat-scroll-anchor.fixture.jsx", "utf8");
if (!/\.chat-scroll-container \{[^}]*overflow-anchor:\s*none;/s.test(css)) {
  throw new Error("the chat scroller must turn the browser's anchoring off in app/native-theme.css");
}
// The fixture mirrors the component. If one of these drifts, the measurement is
// describing a shape the app no longer has.
for (const marker of [
  'className="chat-scroll-container"',
  "pickScrollAnchor",
  "scrollTopForAnchor",
  "CHAT_SCROLL_ANCHOR_WINDOW_MS",
  "useLayoutEffect",
  "new ResizeObserver",
  "data-entry-id",
  "IntersectionObserver",
]) {
  assert.ok(fixtureSource.includes(marker), `the fixture no longer mirrors ChatWindow: ${marker} is missing`);
}
assert.ok(fixtureSource.indexOf("captureAnchor(container);") < fixtureSource.indexOf("setRows((current) =>"),
  "the fixture must record the anchor before the older page is prepended");
// And the app must keep doing what the fixture mirrors.
for (const marker of [
  "captureScrollAnchor(container);",
  "applyScrollAnchor(container)",
  "new ResizeObserver(() => applyScrollAnchor(container))",
]) {
  assert.ok(source.includes(marker), `ChatWindow no longer does this: ${marker}`);
}
assert.ok(source.indexOf("captureScrollAnchor(container);") < source.indexOf("loadContext(sid, activeLeafId, oldestId)"),
  "the anchor is the view before the page arrives: recording it after the fetch measures the moved viewport");

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
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const server = await serve(css);
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();

/** Scroll to the very top (the sentinel's trigger) and report the row standing there. */
const SCROLL_TO_TOP = () => {
  const container = document.querySelector(".chat-scroll-container");
  container.scrollTop = 0;
  // The anchor the app records is the row standing at the top of the window when
  // the sentinel triggers — at the top, not at wherever the user was a moment
  // before — so the probe reads the row after the scroll has landed.
  const box = container.getBoundingClientRect();
  const row = [...container.querySelectorAll("[data-entry-id]")]
    .map((el) => ({
      id: el.getAttribute("data-entry-id"),
      top: el.getBoundingClientRect().top - box.top,
      bottom: el.getBoundingClientRect().bottom - box.top,
    }))
    .find((r) => r.bottom > 2 && r.top < container.clientHeight - 2);
  return { id: row.id, top: Math.round(row.top), rows: container.querySelectorAll("[data-entry-id]").length, height: container.scrollHeight };
};

const MEASURE = (id) => {
  const container = document.querySelector(".chat-scroll-container");
  const box = container.getBoundingClientRect();
  const el = container.querySelector(`[data-entry-id="${id}"]`);
  return {
    top: el ? Math.round(el.getBoundingClientRect().top - box.top) : null,
    scrollTop: Math.round(container.scrollTop),
    rows: container.querySelectorAll("[data-entry-id]").length,
    height: container.scrollHeight,
  };
};

const fails = [];
const check = (ok, message) => {
  if (!ok) fails.push(message);
};

async function pages(caseName, query, { expectStable, settle = 900 }) {
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  await page.goto(`${BASE}/?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".chat-scroll-container [data-entry-id]");
  await page.waitForTimeout(400);

  const steps = [];
  for (let i = 0; i < 3; i += 1) {
    const before = await page.evaluate(SCROLL_TO_TOP);
    await page.waitForTimeout(settle);
    const after = await page.evaluate(MEASURE, before.id);
    steps.push({ before, after, shift: after.top - before.top, added: after.rows - before.rows });
  }
  await page.screenshot({ path: `${out}/${caseName}.png` });

  for (const step of steps) {
    console.log(`${caseName}: anchor ${step.before.id} top ${step.before.top} -> ${step.after.top} `
      + `(shift ${step.shift}px) | scrollTop -> ${step.after.scrollTop} | rows ${step.before.rows} -> ${step.after.rows} `
      + `| height ${step.before.height} -> ${step.after.height}`);
  }
  const shifted = steps.map((s) => Math.abs(s.shift));
  if (expectStable) {
    check(steps.every((s) => s.added > 0), `${caseName}: no page was prepended, the check measured nothing`);
    check(shifted.every((d) => d <= 2), `${caseName}: the row the user was reading moved ${Math.max(...shifted)}px (expected within 2px)`);
    check(steps.every((s) => s.after.scrollTop > 0), `${caseName}: the viewport ended at the top of the list, not on the anchored row`);
  } else {
    const loaded = steps.filter((s) => s.added > 0);
    check(loaded.length > 0, `${caseName}: the control pass prepended nothing, it measured nothing`);
    check(loaded.every((s) => Math.abs(s.shift) > 300),
      `${caseName}: the control pass should throw the view on a prepend, moved ${loaded.map((s) => s.shift).join(", ")}`);
  }
  await page.close();
  return steps;
}

const fixed = await pages("anchored", "grow=1", { expectStable: true });
const broken = await pages("broken", "grow=1&broken=1", { expectStable: false });
await pages("no-growth", "", { expectStable: true });
// The window has to outlast the growth. Measured live, a 600ms window left 90px
// of drift on a page whose content grew around the second mark (Prism, an image's
// intrinsic size), because the anchor expired before the content did.
const late = await pages("late-growth", "grow=1&growDelay=900", { expectStable: true, settle: 1400 });
const lateShort = await pages("late-window-600", "grow=1&growDelay=900&windowMs=600", {
  expectStable: false,
  settle: 1400,
});

// The rule the app ships, as a browser reads it.
const probe = await browser.newPage({ viewport: { width: 900, height: 760 } });
await probe.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
const anchorMode = await probe.evaluate(async () => {
  const cssText = await (await fetch("/styles.css")).text();
  const style = document.createElement("style");
  style.textContent = cssText;
  document.head.append(style);
  const el = document.createElement("div");
  el.className = "chat-scroll-container";
  el.style.cssText = "height:200px;overflow:scroll";
  el.innerHTML = '<div style="height:1200px"></div>';
  document.body.append(el);
  return getComputedStyle(el).overflowAnchor;
});
check(anchorMode === "none", `the chat scroller's overflow-anchor is ${anchorMode}, expected none`);
await probe.close();

await browser.close();
server.close();

if (fails.length) {
  for (const f of fails) console.log("FAIL:", f);
  process.exit(1);
}
const maxShift = (steps) => Math.max(...steps.map((step) => Math.abs(step.shift)));
console.log(
  `PASS: a prepended page keeps the reader on the row they were reading (max shift `
  + `${maxShift(fixed)}px over 3 pages, ${maxShift(late)}px when the content above grows 900ms later — `
  + `without the re-attach the same pages throw the view ${maxShift(broken)}px away, and a 600ms anchor window ${maxShift(lateShort)}px away)`,
);
