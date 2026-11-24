import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

// Real memoized MessageView, updated in place like optimistic -> SSE -> history.
// No model/API calls and no writes to the user's sessions.
const out = "test-results/user-image-display";
await mkdir(out, { recursive: true });
await build({ entryPoints: ["e2e/user-image-display.fixture.tsx"], bundle: true, platform: "browser", format: "iife", outfile: `${out}/fixture.js`, define: { "process.env.NODE_ENV": '"production"' }, jsx: "automatic", logLevel: "warning" });
const js = await readFile(`${out}/fixture.js`);
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"].map((p) => readFile(p, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");
const server = createServer((req, res) => {
  if (req.url?.startsWith("/api/")) { res.setHeader("Content-Type", "application/json"); res.end("{}"); return; }
  res.setHeader("Content-Type", req.url === "/fixture.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html; charset=utf-8");
  res.end(req.url === "/fixture.js" ? js : req.url === "/style.css" ? css : '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
try {
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const bubble = page.locator(".message-user-bubble");
  await bubble.waitFor();
  for (const action of [null, "Deliver normalized event", "Load history"]) {
    if (action) await page.getByRole("button", { name: action, exact: true }).click();
    assert.equal((await bubble.textContent()).trim(), "describe");
    assert.equal(await bubble.locator("img").count(), 1);
  }
  const composer = page.locator("textarea").first();
  const edit = page.getByTitle("Edit from here — branches within this session", { exact: true });
  await composer.fill("existing draft");
  await edit.click({ force: true });
  assert.equal(await page.locator("#admitted").textContent(), "blocked");
  assert.equal(await composer.inputValue(), "existing draft");
  assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).count(), 0);
  await composer.fill("");
  await edit.click({ force: true });
  assert.equal(await page.locator("#admitted").textContent(), "accepted");
  assert.equal(await composer.inputValue(), "describe");
  // Cancel keeps restored input/attachments. Clearing only text must still
  // reject another restoration while the restored image remains attached.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await composer.fill("");
  await edit.click({ force: true });
  assert.equal(await page.locator("#admitted").textContent(), "blocked");
  // The card has no "clear" button. The attachment carries its own remove control, the
  // text is selected and deleted, and history-edit mode is left through Cancel.
  const removeImage = page.getByRole("button", { name: "Remove image", exact: true });
  assert.equal(await removeImage.count(), 1, "the attached image names its own remove control");
  await removeImage.click();
  await edit.click({ force: true });
  assert.equal(await page.locator("#admitted").textContent(), "accepted");
  // Emptying the composer is the text's own delete plus the attachment's ×; leaving
  // history-edit mode is Cancel's job, and it keeps what the composer holds.
  await composer.fill("");
  await removeImage.click();
  assert.equal(await composer.inputValue(), "");
  assert.equal(await removeImage.count(), 0, "the image is gone");
  // The fixture stacks a bare composer under a message bubble with no app shell around
  // it, so the bubble paints over the short composer's row; the edit links in this
  // file are clicked the same way.
  await page.getByRole("button", { name: "Cancel", exact: true }).click({ force: true });
  assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).count(), 0,
    "Cancel is the way out of history-edit mode");
  assert.equal(await composer.inputValue(), "", "and it leaves the composer as it was");
  await edit.click({ force: true });
  const draft = JSON.parse(await page.locator("#draft").textContent());
  assert.equal(draft.content[0].text, "describe");
  assert.equal(draft.content[1].type, "image");
  assert.match(await page.locator("#stored").textContent(), /Multiply coordinates/);
  await page.getByRole("button", { name: "Resend edit", exact: true }).click();
  assert.equal((await bubble.textContent()).trim(), "describe");
  assert.deepEqual(errors, []);
  console.log("PASS: live MessageView optimistic/delivered/history/edit/resend, attachments preserved, stored input untouched");
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
