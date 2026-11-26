import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { webkit } from "playwright";

const out = "test-results/composer-keyboard-probe";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/composer-keyboard.fixture.jsx"],
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
  .map((p) => readFile(p, "utf8")))).map((t) => t.replace(/^@import[^;]*;/gm, "")).join("\n");

const server = createServer((req, res) => {
  if (req.url.startsWith("/fixture.js")) { res.setHeader("Content-Type", "text/javascript"); res.end(js); return; }
  if (req.url === "/styles.css") { res.setHeader("Content-Type", "text/css"); res.end(css); return; }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});
const port = await new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));

const KEYBOARD = 336;

const init = (keyboard) => {
  const layout = window.innerHeight;
  const state = { height: null, offsetTop: 0 };
  const real = window.visualViewport;
  const proxy = {
    get width() { return real.width; },
    get height() { return state.height ?? real.height; },
    get offsetTop() { return state.offsetTop; },
    get offsetLeft() { return 0; },
    get scale() { return real.scale; },
    addEventListener: (t, l, o) => real.addEventListener(t, l, o),
    removeEventListener: (t, l, o) => real.removeEventListener(t, l, o),
    dispatchEvent: (e) => real.dispatchEvent(e),
  };
  Object.defineProperty(window, "visualViewport", { configurable: true, get: () => proxy });
  Object.defineProperty(window, "innerHeight", { configurable: true, get: () => layout });
  window.__kb = {
    info: { layout, keyboard, realH: real.height, realW: real.width, realScale: real.scale, vvProxyInstalled: window.visualViewport === proxy },
    get height() { return state.height; },
    open() { state.height = layout - keyboard; real.dispatchEvent(new Event("resize")); },
    close() { state.height = null; state.offsetTop = 0; real.dispatchEvent(new Event("resize")); },
    setOffset(v) { state.offsetTop = v; real.dispatchEvent(new Event("resize")); real.dispatchEvent(new Event("scroll")); },
  };
};

const measure = () => {
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { y: Math.round(b.y), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) };
  };
  const ta = document.querySelector(".chat-input-textarea");
  const ae = document.activeElement;
  const ancestors = [];
  for (let el = ta; el && el !== document.documentElement; el = el.parentElement) {
    const s = getComputedStyle(el);
    ancestors.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(/\s+/).filter(Boolean).join(".")}`.slice(0, 70)
      + ` display=${s.display} vis=${s.visibility} ovf=${s.overflow} h=${Math.round(el.getBoundingClientRect().height)}`);
  }
  const sc = document.querySelector(".chat-scroll-container");
  return {
    active: ae ? `${ae.tagName.toLowerCase()}.${(ae.className || "").toString().split(/\s+/)[0]}` : null,
    kbAttr: document.documentElement.dataset.keyboardOpen ?? null,
    appVh: document.documentElement.style.getPropertyValue("--app-viewport-height") || null,
    vvHeight: window.visualViewport.height,
    vvOffsetTop: window.visualViewport.offsetTop,
    scrollY: window.scrollY,
    docScrollTop: document.documentElement.scrollTop,
    bodyScrollTop: document.body.scrollTop,
    docScrollHeight: document.documentElement.scrollHeight,
    docClientHeight: document.documentElement.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
    shellScrollHeight: document.querySelector(".app-shell")?.scrollHeight ?? null,
    shell: rect(document.querySelector(".app-shell")),
    chat: rect(document.querySelector(".chat-window")),
    block: rect(document.querySelector(".chat-composer")?.parentElement?.parentElement),
    card: rect(document.querySelector(".chat-composer")),
    ta: rect(ta),
    scScrollTop: sc ? sc.scrollTop : null,
    ancestors,
  };
};

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
page.on("console", (m) => console.log("  [console]", m.type(), m.text().slice(0, 120)));
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));
await page.addInitScript(init, KEYBOARD);

for (const page_ of ["empty", "chat"]) {
  for (const standalone of [false, true]) {
    console.log(`\n===== page=${page_} standalone=${standalone} =====`);
    await page.goto(`http://127.0.0.1:${port}/?page=${page_}${standalone ? "&standalone=1" : ""}`);
    await page.waitForSelector(".chat-input-textarea");
    await page.waitForTimeout(200);
    console.log("init:", JSON.stringify(await page.evaluate(() => ({ info: window.__kb.info, kbH: window.__kb.height, vvH: window.visualViewport.height, scale: window.visualViewport.scale, iw: window.innerWidth, ih: window.innerHeight, scrollW: document.documentElement.scrollWidth }))));
    console.log("rest:", JSON.stringify(await page.evaluate(measure), null, 1));
    // The keyboard: focus the field, then the visual viewport shrinks.
    await page.evaluate(() => document.querySelector(".chat-input-textarea").focus());
    await page.evaluate(() => window.__kb.open());
    for (const t of [0, 60, 200, 500, 900]) {
      await page.waitForTimeout(t === 0 ? 0 : t === 60 ? 60 : t === 200 ? 140 : t === 500 ? 300 : 400);
      const m = await page.evaluate(measure);
      console.log(`t=${t} active=${m.active} kb=${m.kbAttr} vh=${m.appVh} vvH=${m.vvHeight} vvTop=${m.vvOffsetTop} scrollY=${m.scrollY} docTop=${m.docScrollTop} scTop=${m.scScrollTop} docSH=${m.docScrollHeight}/${m.docClientHeight} ta=${JSON.stringify(m.ta)} card=${JSON.stringify(m.card)} shell=${JSON.stringify(m.shell)}`);
    }
    const m = await page.evaluate(measure);
    console.log("ancestors:\n " + m.ancestors.join("\n "));
    await page.screenshot({ path: `${out}/${page_}-${standalone ? "standalone" : "tab"}.png` });
  }
}
await browser.close();
server.close();
console.log("\nprobe done");
