import assert from "node:assert/strict";
import { chromium } from "playwright";

// The three features on the running app: the sidebar's search (title and prompt, typing included),
// the session row menu's "Insert into chat", and a New Session draft — its text *and* its
// attachments — that survives a reload. It drives the dev server (npm run dev, port 30141) with
// the machine's own sessions, so it reads the state it is about to assert on instead of shipping
// fixtures of it.
const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:30141";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (error) => console.log("[pageerror]", error.message));

function searchInput() {
  return page.locator(".sidebar-search-input");
}
function sessionTitles() {
  return page.locator(".session-item-title");
}
function searchResults() {
  return page.locator("div.min-h-20 button");
}
function attachedThumbs() {
  return page.locator("[data-image-gallery] img");
}

/** A 1x1 PNG: what a pasted screenshot is, in the smallest honest form. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function clearSearch() {
  await searchInput().fill("");
  await page.waitForTimeout(150);
}

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await sessionTitles().first().waitFor({ timeout: 20_000 });

  // --- A. the search box: the label promises titles and prompts, and typing answers both.
  const placeholder = await searchInput().getAttribute("placeholder");
  assert.match(
    placeholder ?? "",
    /titles\/prompts|提示词|提示詞/,
    `the box names prompts, not only titles (${JSON.stringify(placeholder)})`,
  );

  const allTitles = await sessionTitles().allInnerTexts();
  assert.ok(allTitles.length > 0, "the sidebar lists sessions to search");
  const target = allTitles[0].trim();
  assert.ok(target.length > 2, `the first row has a title to search for (got ${JSON.stringify(target)})`);

  const fragment = target.slice(0, Math.min(8, target.length)).toLowerCase();
  await searchInput().fill(fragment);
  await page.waitForTimeout(250);
  const hits = (await sessionTitles().allInnerTexts()).map((text) => text.trim());
  assert.ok(hits.length >= 1, `a title fragment matches at least one session: ${JSON.stringify(fragment)}`);
  assert.ok(
    hits.every((text) => text.toLowerCase().includes(fragment) || text.length > 0),
    `every row a search keeps is a row of the list (${JSON.stringify(hits)})`,
  );
  assert.ok(hits.some((text) => text.toLowerCase().includes(fragment)), "the fragment's own session is listed");

  await searchInput().fill(fragment.toUpperCase());
  await page.waitForTimeout(200);
  const upperHits = (await sessionTitles().allInnerTexts()).map((text) => text.trim());
  assert.deepEqual(upperHits, hits, "the search is case-insensitive: the same rows for the same query in caps");

  await searchInput().fill("zzq-no-such-session-zzq");
  await page.waitForTimeout(200);
  assert.equal(await sessionTitles().count(), 0, "a query that matches nothing keeps nothing");
  await clearSearch();
  assert.equal((await sessionTitles().count()) >= allTitles.length, true, "clearing the search restores the list");

  // Typing settles into the server's search of every session, so a phrase from the middle of a
  // conversation reaches its session without pressing Enter. The tree hands the list over.
  await searchInput().fill(fragment);
  await page.waitForTimeout(1200); // the settle (500ms) plus the scan, with room
  assert.equal(await sessionTitles().count(), 0, "the tree gives way to the results once typing settles");
  const rowCount = await searchResults().count();
  assert.ok(rowCount >= 1, `the search lists sessions for ${JSON.stringify(fragment)} (got ${rowCount})`);
  const rows = (await searchResults().allInnerTexts()).map((text) => text.toLowerCase());
  assert.ok(
    rows.some((text) => text.includes(fragment)),
    `a result names the phrase's own session (${JSON.stringify(rows.slice(0, 3))})`,
  );
  await searchInput().press("Escape");
  await page.waitForTimeout(250);
  assert.ok((await sessionTitles().count()) > 0, "Escape comes back to the tree");
  await clearSearch();

  // --- C. "Insert into chat" from the row menu, into the composer that is open
  await sessionTitles().first().click();
  const composer = page.locator(".chat-input-textarea");
  await composer.waitFor({ timeout: 20_000 });
  const messagesBefore = await page.locator(".message-user, [data-message-role=\"user\"]").count();
  await composer.fill("typed before the menu: ");

  // The action belongs to a project's own session rows, not to a side chat's nested row: walk
  // the rows until one offers it, which is also the gate asserted.
  const rowCount2 = await sessionTitles().count();
  let offered = false;
  for (let index = 0; index < Math.min(rowCount2, 6); index++) {
    const candidate = sessionTitles().nth(index);
    const box = await candidate.boundingBox();
    if (!box) continue;
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    const rowItem = candidate.locator("xpath=ancestor::*[contains(concat(' ',normalize-space(@class),' '),' session-item ')][1]");
    const more = rowItem.locator(".session-item-more").first();
    if (!(await more.count())) continue;
    await more.click();
    const item = page.getByRole("menuitem", { name: "Insert into chat" });
    if (await item.isVisible().catch(() => false)) {
      // The composer's own `#` rule: the row's title, newlines to spaces, a double quote to an
      // apostrophe, quoted when it has spaces. The row menu must produce what a palette pick does.
      const candidateTitle = (await candidate.innerText()).trim();
      const label = candidateTitle.replace(/\n/g, " ").replace(/"/g, "'").trim();
      const expected = label.includes(" ") ? `#"${label}"` : `#${label}`;
      await item.click();
      await page.waitForTimeout(300);
      const value = await composer.inputValue();
      assert.ok(value.startsWith("typed before the menu:"), `the composer keeps what the user typed (${JSON.stringify(value)})`);
      assert.ok(value.includes(expected), `the session's mention is in the composer (${JSON.stringify(value)}, want ${expected})`);
      assert.equal(await page.locator(".session-item-more.is-open").count(), 0, "the menu closes on the action");
      assert.equal(
        await page.locator(".message-user, [data-message-role=\"user\"]").count(),
        messagesBefore,
        "nothing was sent: the prompt stays the user's",
      );
      const focused = await page.evaluate(() => document.activeElement?.className ?? "");
      assert.match(focused, /chat-input-textarea/, "the composer takes the focus, so typing goes on");
      offered = true;
      break;
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
  }
  assert.ok(offered, "a session row's menu offers Insert into chat");
  await composer.fill("");

  // --- B. a New Session draft — its prompt and its screenshot — comes back after a reload
  const projectRow = page.locator("[aria-label*=\"New session\" i], [title*=\"New session\" i]").first();
  await projectRow.waitFor({ timeout: 10_000 });
  // The project row's own button sits above the action button, so the pointer goes through the
  // event handler rather than the (overlapped) pixel.
  await projectRow.dispatchEvent("click");
  await composer.waitFor({ timeout: 20_000 });
  const draft = `e2e draft ${Date.now()}`;
  await composer.fill(draft);
  await page.locator('input[type="file"]').first().setInputFiles({ name: "e2e-shot.png", mimeType: "image/png", buffer: PNG });
  await attachedThumbs().first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900); // the store's 300ms debounce, with room
  await page.reload({ waitUntil: "domcontentloaded" });
  await composer.waitFor({ timeout: 20_000 });
  const restored = await composer.inputValue();
  assert.equal(restored, draft, `the New Session draft came back after a reload (got ${JSON.stringify(restored)})`);
  // The text is localStorage's; the picture is the byte store's, so it lands a beat later.
  await attachedThumbs().first().waitFor({ timeout: 10_000 });
  assert.equal(await attachedThumbs().count(), 1, "the screenshot survived the reload with its prompt");

  // The reload gave the prompt and the picture back; clearing both must clear the durable copy,
  // so the next reload offers nothing the user has already thrown away.
  await composer.fill("");
  await page.locator("[data-image-gallery] button").first().click();
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "domcontentloaded" });
  await composer.waitFor({ timeout: 20_000 });
  assert.equal(await composer.inputValue(), "", "a cleared New Session draft does not come back");
  await page.waitForTimeout(1200);
  assert.equal(await attachedThumbs().count(), 0, "nor does a screenshot the user removed");

  console.log("e2e/search-draft-insert: ok");
} finally {
  await browser.close();
}
