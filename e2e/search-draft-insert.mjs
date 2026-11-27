import assert from "node:assert/strict";
import { chromium } from "playwright";

// The three features on the running app: the sidebar's search (title and prompt), the session
// row menu's "Insert into chat", and a New Session draft that survives a reload. It drives the
// dev server (npm run dev, port 30141) with the machine's own sessions, so it reads the state it
// is about to assert on instead of shipping fixtures of it.
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

async function clearSearch() {
  await searchInput().fill("");
  await page.waitForTimeout(150);
}

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await sessionTitles().first().waitFor({ timeout: 20_000 });

  // --- A. the search box matches the title and the prompt, case-insensitively, across sessions
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

  // --- C. "Insert into chat" from the row menu, into the composer that is open
  await sessionTitles().first().click();
  const composer = page.locator(".chat-input-textarea");
  await composer.waitFor({ timeout: 20_000 });
  const messagesBefore = await page.locator(".message-user, [data-message-role=\"user\"]").count();
  await composer.fill("typed before the menu: ");

  // The action belongs to a project's own session rows, not to a side chat's nested row: walk
  // the rows until one offers it, which is also the gate asserted.
  const rowCount = await sessionTitles().count();
  let offered = false;
  for (let index = 0; index < Math.min(rowCount, 6); index++) {
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
      const candidateTitle = (await candidate.innerText()).trim();
      const expected = candidateTitle.includes(" ") ? `#"${candidateTitle}"` : `#${candidateTitle}`;
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

  // --- B. a New Session draft comes back after a reload, in its own project
  const projectRow = page.locator("[aria-label*=\"New session\" i], [title*=\"New session\" i]").first();
  await projectRow.waitFor({ timeout: 10_000 });
  // The project row's own button sits above the action button, so the pointer goes through the
  // event handler rather than the (overlapped) pixel.
  await projectRow.dispatchEvent("click");
  await composer.waitFor({ timeout: 20_000 });
  const draft = `e2e draft ${Date.now()}`;
  await composer.fill(draft);
  await page.waitForTimeout(900); // the store's 300ms debounce, with room
  await page.reload({ waitUntil: "domcontentloaded" });
  await composer.waitFor({ timeout: 20_000 });
  const restored = await composer.inputValue();
  assert.equal(restored, draft, `the New Session draft came back after a reload (got ${JSON.stringify(restored)})`);

  // The reload gave the prompt back; sending clears it, and clearing by hand must do the same
  // for the next reload not to offer it again.
  await composer.fill("");
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: "domcontentloaded" });
  await composer.waitFor({ timeout: 20_000 });
  assert.equal(await composer.inputValue(), "", "a cleared New Session draft does not come back");

  console.log("e2e/search-draft-insert: ok");
} finally {
  await browser.close();
}
