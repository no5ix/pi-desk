import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
import { checkComposerGeometry } from './composer-geometry.mjs';

/**
 * The composer's per-device copies, as rows (the outbox's surface, a read-only row).
 *
 * Pinned here, live: the rows are the other devices' copies in device order
 * (mac, then iPhone), each marked by the **browser** that typed it — Safari's
 * compass and Chrome's wheel, not a `mac-content-copy` slug — and **one button
 * each: no edit, no delete**, because no device edits or deletes another's
 * content. The slug is not printed, but it is not lost: the row's tooltip and its
 * accessible name carry `mac-content-copy · Safari`. Clicking a row prepends
 * that copy, image included, before what is typed here, and the row stays. At a
 * phone's width the mark is visible where the outbox's queue glyph hides, and the
 * dock joins the composer the way the outbox does.
 */
const dir = 'test-results/composer-device-copies';
await mkdir(dir, { recursive: true });
await build({ entryPoints: ['e2e/composer-device-copies.fixture.jsx'], bundle: true, platform: 'browser', format: 'iife', outfile: dir + '/fixture.js', define: { 'process.env': '{"NODE_ENV":"production"}' }, jsx: 'automatic', logLevel: 'warning' });
const css = (await Promise.all(['app/globals.css', 'app/settings.css', 'app/native-theme.css'].map(path => readFile(path, 'utf8')))).map(css => css.replace(/^@import[^;]*;/gm, '')).join('\n');
const js = await readFile(dir + '/fixture.js');
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://fixture').pathname;
  response.setHeader('Content-Type', path === '/fixture.js' ? 'text/javascript' : path === '/style.css' ? 'text/css' : 'text/html');
  response.end(path === '/fixture.js' ? js : path === '/style.css' ? css : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
/** The strokes `ComposerDeviceCopies` draws per browser mark, in order. */
const GLYPHS = {
  safari: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M8 16l2 -6l6 -2l-2 6l-6 2'],
  chrome: [
    'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0',
    'M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
    'M12 9h8.4',
    'M14.6 13.5l-4.2 7.3',
    'M9.4 13.5l-4.2 -7.3',
  ],
};
/** All of a row's strokes, the way the mark is drawn: one `<path>` per stroke. */
const strokesOf = locator => locator.evaluateAll(rows => rows.map(row => [...row.querySelectorAll('.composer-copy-glyph path')].map(path => path.getAttribute('d'))));
let browser;
try {
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const theme of ['light', 'dark']) for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 760 }, hasTouch: width === 390, isMobile: width === 390, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('pi-locale', 'zh-CN'));
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    await page.goto(base);
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    const rows = page.locator('.composer-copy-row');
    await rows.first().waitFor();
    const editor = page.locator('textarea');

    assert.equal(await rows.count(), 2, 'one row per other device');
    assert.equal(await page.locator('.composer-copy-name').count(), 0, 'no `mac-content-copy` text is printed: the mark carries it');
    assert.deepEqual(await page.locator('.composer-copy-text').allInnerTexts(), ['在 macbook 上打的提示词', '在 iphone 上打的一段话'],
      'the copy is the row\'s text, the mac\'s above the iPhone\'s');
    assert.deepEqual(await strokesOf(rows), [GLYPHS.safari, GLYPHS.chrome],
      'the marks are Safari and Chrome — the browsers that typed the copies');
    assert.equal(await page.locator('.composer-outbox-actions').count(), 0, 'a copy row has no action column');
    assert.deepEqual(await rows.evaluateAll(rows => rows.map(row => row.querySelectorAll('button').length)), [1, 1],
      'one action per row: no edit, no delete, no send');
    assert.match(await rows.first().innerText(), /1 个附件过大未同步/, 'a copy that lost attachments says so');
    assert.match(await rows.first().locator('button').getAttribute('aria-label'), /^添加到我的消息: mac-content-copy · Safari$/, 'the row names its action, its owner and its browser');
    assert.match(await rows.first().locator('button').getAttribute('title'), /^mac-content-copy · Safari · 在 macbook 上打的提示词$/, 'the tooltip keeps the device name the mark cannot show');

    await checkComposerGeometry(page);
    const dock = await page.locator('.composer-device-copies').evaluate(el => {
      const box = el.getBoundingClientRect(), card = el.nextElementSibling.getBoundingClientRect();
      return { left: box.left, right: box.right, bottom: box.bottom, cardTop: card.top, viewport: innerWidth };
    });
    assert.ok(dock.left >= 0 && dock.right <= dock.viewport, JSON.stringify(dock));
    assert.ok(dock.bottom - dock.cardTop >= 10 && dock.bottom - dock.cardTop <= 14, 'the copies dock to the composer card, as the outbox does');
    const mark = await rows.first().locator('.composer-outbox-mark').boundingBox();
    assert.ok(mark.width >= 12, `the device glyph is drawn, even at ${width}px where the outbox hides its queue mark`);

    await editor.fill('我自己的内容');
    const reads = await page.evaluate(() => window.__copiesCalls.filter(call => call.method === 'GET').length);
    assert.ok(reads >= 1, 'the composer read the other devices from the server');
    await rows.first().locator('button').click();
    const joined = await editor.inputValue();
    assert.ok(joined.startsWith('在 macbook 上打的提示词\n\n我自己的内容'), JSON.stringify(joined), 'the copy is prepended before what is typed here');
    assert.equal(await rows.count(), 2, 'the row stays: the copy belongs to the device that typed it');
    assert.equal(await page.locator('.chat-input-shell img[alt=""]').count(), 1, 'the copy travels with its attachment');
    // This device's own copy is written, with what the pick added to it.
    await page.waitForFunction(() => window.__copiesCalls.some(call => call.method === 'PUT'
      && /^device-/.test(call.body.deviceId)
      && call.body.value.includes('我自己的内容') && call.body.images.length === 1),
    undefined, { timeout: 4000 });
    const pushed = await page.evaluate(() => window.__copiesCalls.filter(call => call.method === 'PUT' && call.body.value.includes('我自己的内容')).at(-1).body);
    assert.ok(pushed.label && /^[a-z-]+$/.test(pushed.label), JSON.stringify(pushed.label), 'this device writes under its own slug');
    assert.ok(['desktop', 'phone', 'tablet', 'other'].includes(pushed.kind), JSON.stringify(pushed));
    // The headless Chromium this runs in reports Chrome, and Chrome is what its
    // row's mark will be on the other devices.
    assert.ok(['safari', 'chrome', 'edge', 'firefox', 'opera', 'other'].includes(pushed.browser), JSON.stringify(pushed.browser), 'this device writes the browser its row is marked with');
    // The token the store handed back comes along on the next write, so this device
    // keeps ownership of its own record.
    await editor.fill(joined + '，继续写');
    await page.waitForFunction(() => window.__copiesCalls.some(call => call.method === 'PUT'
      && call.body.token === 'tok-e2e' && call.body.value.includes('继续写')),
    undefined, { timeout: 4000 });

    await page.screenshot({ path: `${dir}/${theme}-${width}.png` });
    await page.locator('.chat-input-shell').screenshot({ path: `${dir}/${theme}-${width}-composer.png` });
    assert.deepEqual(errors, [], 'no page errors');
    await page.close();
  }
  console.log(`composer device copies: ${['light', 'dark'].map(t => `${t} 1280/390`).join(', ')} — two read-only rows marked Safari and Chrome, prepend with attachments, passed`);
} finally {
  await browser?.close();
  server.close();
}
