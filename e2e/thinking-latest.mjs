import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * One thinking card open at a time, in the real component.
 *
 * The conversation's newest thinking is the reasoning behind the answer on screen, so
 * it is open: while it streams, and after it ends with nothing following it. When the
 * next thinking block starts, the previous one closes by itself. "Expand thinking
 * blocks by default" reaches the reply the user is reading — not every thinking card
 * in the file, which is what made a long conversation a wall of open reasoning. A card
 * the user opened by hand is theirs, and the rule stops moving it.
 *
 * The last pass builds the same fixture with the old rule restored (the switch
 * expanding every card) and expects the wall: a check that cannot see the reported bug
 * is not a check.
 */
const out = "test-results/thinking-latest";
await mkdir(out, { recursive: true });
const shared = {
  bundle: true,
  platform: "browser",
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
};
await build({
  ...shared,
  entryPoints: ["e2e/thinking-latest.fixture.jsx"],
  outfile: `${out}/fixture.js`,
});

const OLD_RULE = "expandByDefault || (latestReply && isThinkingExpandedByDefault() && !insideProcessDetails);";
const oldRule = {
  name: "restore-the-old-rule",
  setup(b) {
    b.onLoad({ filter: /MessageView\.tsx$/ }, async (args) => {
      const text = await readFile(args.path, "utf8");
      if (!text.includes(OLD_RULE)) throw new Error(`the old-rule control lost its anchor in ${args.path}`);
      return {
        contents: text.replace(OLD_RULE, "expandByDefault || (isThinkingExpandedByDefault() && !insideProcessDetails);"),
        loader: "tsx",
      };
    });
  },
};
await build({
  ...shared,
  entryPoints: ["e2e/thinking-latest.fixture.jsx"],
  outfile: `${out}/old-rule.js`,
  plugins: [oldRule],
});

const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");
const bundles = {
  "fixture.js": await readFile(`${out}/fixture.js`),
  "old-rule.js": await readFile(`${out}/old-rule.js`),
};

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/fixture.js" || url.pathname === "/old-rule.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(bundles[url.pathname.slice(1)]);
    return;
  }
  if (url.pathname === "/styles.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/${url.searchParams.get("bundle") || "fixture.js"}"></script></body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const READ = () => [...document.querySelectorAll("section[data-turn]")].map((section) => ({
  turn: section.dataset.turn,
  open: [...section.querySelectorAll('[aria-label^="Thinking"]')].map((card) => card.getAttribute("aria-expanded") === "true"),
}));

const openMap = (state) => Object.fromEntries(state.map((row) => [row.turn, row.open.map((o) => (o ? 1 : 0)).join("")]));

async function session(pref, query) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await context.addInitScript((value) => window.localStorage.setItem("pi-thinking-expanded", value), pref);
  const page = await context.newPage();
  await page.goto(`${base}?${query}`);
  await page.waitForSelector('[aria-label^="Thinking"]');
  return { context, page };
}

const browser = await chromium.launch();

// The switch off: exactly one card is open, the conversation's newest.
{
  const { context, page } = await session("false", "newest=2");
  const state = openMap(await page.evaluate(READ));
  assert.deepEqual(state, { 0: "0", 1: "00", 2: "1" },
    `only the newest thinking of the newest reply is open (${JSON.stringify(state)})`);
  await context.close();
}

{
  const { context, page } = await session("false", "newest=1");
  const state = openMap(await page.evaluate(READ));
  assert.deepEqual(state, { 0: "0", 1: "01", 2: "0" },
    `a reply with two thinking blocks opens its last one, not both (${JSON.stringify(state)})`);
  await context.close();
}

// The switch on: it reaches the newest reply, not the file's history.
{
  const { context, page } = await session("true", "newest=1");
  const state = openMap(await page.evaluate(READ));
  assert.deepEqual(state, { 0: "0", 1: "11", 2: "0" },
    `the switch opens the newest reply's thinking (${JSON.stringify(state)})`);
  await context.close();
}

{
  const { context, page } = await session("true", "newest=2");
  const state = openMap(await page.evaluate(READ));
  assert.deepEqual(state, { 0: "0", 1: "00", 2: "1" },
    `the switch never reaches the turns behind the newest one (${JSON.stringify(state)})`);
  await context.close();
}

// Inside a turn's Process details the group keeps its cards folded, except the newest.
{
  const { context, page } = await session("false", "newest=2&group=1");
  const state = openMap(await page.evaluate(READ));
  assert.deepEqual(state, { 0: "0", 1: "00", 2: "1" },
    `the newest block opens through the group's fold; the group's older cards stay shut (${JSON.stringify(state)})`);
  await context.close();
}

{
  const { context, page } = await session("true", "newest=1&group=1");
  const state = openMap(await page.evaluate(READ));
  assert.deepEqual(state, { 0: "0", 1: "01", 2: "0" },
    `the switch does not unfold a group's cards; its newest block opens by position (${JSON.stringify(state)})`);
  await context.close();
}

// The handover: A is open, B starts, A closes on its own.
{
  const { context, page } = await session("false", "newest=1");
  const before = openMap(await page.evaluate(READ));
  assert.deepEqual(before, { 0: "0", 1: "01", 2: "0" }, `A is the newest and is open (${JSON.stringify(before)})`);
  await page.evaluate(() => window.__fixture.render({ newest: 2 }));
  await page.waitForTimeout(150);
  const after = openMap(await page.evaluate(READ));
  assert.deepEqual(after, { 0: "0", 1: "00", 2: "1" },
    `B took over: A closed itself and B is open (${JSON.stringify(after)})`);
  await context.close();
}

// A card the user opened by hand is theirs: the rule stops moving it.
{
  const { context, page } = await session("false", "newest=1");
  await page.click('section[data-turn="0"] [aria-label^="Thinking"]');
  const touched = openMap(await page.evaluate(READ));
  assert.deepEqual(touched, { 0: "1", 1: "01", 2: "0" }, `the click opened an older card (${JSON.stringify(touched)})`);
  await page.evaluate(() => window.__fixture.render({ newest: 2 }));
  await page.waitForTimeout(150);
  const after = openMap(await page.evaluate(READ));
  assert.deepEqual(after, { 0: "1", 1: "00", 2: "1" },
    `the handover left the card the user opened alone (${JSON.stringify(after)})`);
  await context.close();
}

// The control: the old rule (the switch expands every card) is the wall of open
// reasoning the user photographed.
{
  const { context, page } = await session("true", "bundle=old-rule.js&newest=2");
  const state = openMap(await page.evaluate(READ));
  const openCount = Object.values(state).join("").split("").filter((c) => c === "1").length;
  assert.ok(openCount > 2, `the old rule opens every thinking card in the file (${JSON.stringify(state)})`);
  await context.close();
}

await browser.close();
server.close();
console.log("thinking: one card open (the newest), the switch reaches the newest reply, a group keeps its cards folded, A closes itself when B starts, a hand click is respected; the old rule opened every card");
