import assert from "node:assert/strict";
import { chromium } from "playwright";

// The three features on the running app: the sidebar's search (its label, its title filter, and
// the prompt search a query falls into), the session row menu's "Insert into chat" (the composer's
// own `#` rule), and a New Session draft — its text *and* its attachments — that survives a
// reload. It drives the dev server (npm run dev, port 30141) with the machine's own sessions, so
// it reads the state it is about to assert on instead of shipping fixtures of it.
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

/**
 * A word that a session *prompt* says and no session title carries — the query the tree cannot
 * answer. The prompts come from the app's own calendar reader, which is the reader the prompt
 * search runs on, so the phrase is one that search can find.
 */
async function findPromptWord() {
  const now = Date.now();
  // The calendar route refuses a range wider than 50 days; four weeks is plenty of the machine's
  // own history to find a phrase in.
  const from = now - 28 * 24 * 60 * 60 * 1000;
  const [calendar, list] = await page.evaluate(async ([f, t]) => {
    const cal = await fetch(`/api/calendar?from=${f}&to=${t}`).then((res) => res.json());
    const sessions = await fetch("/api/sessions").then((res) => res.json());
    return [cal, sessions];
  }, [from, now]);
  const sessions = (list.sessions ?? []).filter((session) => session.relation?.kind !== "side");
  const titles = sessions.map((session) => `${session.name ?? ""} ${session.firstMessage ?? ""}`.toLowerCase());
  const listed = new Set(sessions.map((session) => session.id));
  for (const [sessionId, prompts] of Object.entries(calendar.prompts ?? {})) {
    if (!listed.has(sessionId)) continue;
    // The first prompt is the one the tree already sees; a later one is the case the box owes.
    for (const prompt of (prompts ?? []).slice(1)) {
      const words = String(prompt.text ?? "").slice(0, 280).split(/[^A-Za-z0-9_-]+/);
      for (const word of words) {
        if (word.length < 8) continue;
        const needle = word.toLowerCase();
        if (titles.some((title) => title.includes(needle))) continue;
        return { word: needle, sessionId };
      }
    }
  }
  return null;
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
  // The first row is a pin, a running session, a one-letter name — anything. Take the first row
  // long enough to give a fragment that is not a single keystroke.
  const target = allTitles.map((text) => text.trim()).find((text) => text.length > 8) ?? allTitles[0].trim();
  assert.ok(target.length > 2, `a row has a title to search for (got ${JSON.stringify(target)})`);

  const fragment = target.slice(0, Math.min(8, target.length)).toLowerCase();
  await searchInput().fill(fragment);
  await page.waitForTimeout(250);
  const hits = (await sessionTitles().allInnerTexts()).map((text) => text.trim());
  assert.ok(hits.length >= 1, `a title fragment matches at least one session: ${JSON.stringify(fragment)}`);
  assert.ok(hits.every((text) => text.length > 0), `every row a search keeps is a row of the list (${JSON.stringify(hits)})`);
  assert.ok(hits.some((text) => text.toLowerCase().includes(fragment)), "the fragment's own session is listed");

  await searchInput().fill(fragment.toUpperCase());
  await page.waitForTimeout(200);
  const upperHits = (await sessionTitles().allInnerTexts()).map((text) => text.trim());
  assert.deepEqual(upperHits, hits, "the search is case-insensitive: the same rows for the same query in caps");
  // A query the tree answers keeps the tree: the box does not trade matching rows for a results
  // list, and one keystroke never triggers a scan.
  await searchInput().fill(fragment);
  await page.waitForTimeout(1200);
  assert.ok((await sessionTitles().count()) >= 1, "the rows the query matches stay in the tree");
  assert.equal(await searchResults().count(), 0, "a query the tree answers does not open the results list");

  await searchInput().fill("zzq-no-such-session-zzq");
  await page.waitForTimeout(200);
  assert.equal(await sessionTitles().count(), 0, "a query that matches nothing keeps nothing");
  await clearSearch();
  assert.equal((await sessionTitles().count()) >= allTitles.length, true, "clearing the search restores the list");

  // A phrase only a prompt says: the tree has nothing, and the box settles into the prompt search
  // for it — the half of "Search titles/prompts…" the tree cannot keep.
  const probe = await findPromptWord();
  assert.ok(probe, "the machine's sessions have a prompt word no title carries");

  // The prompt search reads session files and keeps what it read; the first pass over a cold
  // machine is bounded, so warm that cache through the same route the box uses, and check the
  // server finds the session before asking the browser to.
  let serverHits = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await page.evaluate(async (word) => {
      const data = await fetch(`/api/sessions/search?q=${encodeURIComponent(word)}&scope=prompts`).then((res) => res.json());
      return { ids: (data.results ?? []).map((entry) => entry.session.id), truncated: data.truncated };
    }, probe.word);
    serverHits = response.ids;
    if (serverHits.includes(probe.sessionId)) break;
  }
  assert.ok(
    serverHits.includes(probe.sessionId),
    `the prompt search finds the session that said ${JSON.stringify(probe.word)}`,
  );

  await searchInput().fill(probe.word);
  await page.waitForTimeout(200);
  assert.equal(await sessionTitles().count(), 0, `the tree has no row for a word only a prompt says (${probe.word})`);
  let rows = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.waitForTimeout(500);
    rows = (await searchResults().allInnerTexts()).map((text) => text.toLowerCase());
    if (rows.some((text) => text.includes(probe.word))) break;
  }
  assert.ok(
    rows.some((text) => text.includes(probe.word)),
    `the box finds the session that said ${JSON.stringify(probe.word)} (${JSON.stringify(rows.slice(0, 2))})`,
  );
  await searchInput().press("Escape");
  await page.waitForTimeout(300);
  assert.ok((await sessionTitles().count()) > 0, "Escape comes back to the tree");
  await clearSearch();

  // --- C. "Insert into chat" from the row menu, into the composer that is open
  await sessionTitles().first().click();
  const composer = page.locator(".chat-input-textarea");
  await composer.waitFor({ timeout: 20_000 });
  await composer.fill("typed before the menu: ");
  await page.waitForTimeout(600);

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
      // The composer's own `#` rule over the session's own record — not the row's text, which the
      // sidebar truncates with an ellipsis. The row menu must produce what a palette pick writes:
      // the name, else the first prompt in full (newlines to spaces, `"` to `'`), quoted when it
      // has spaces.
      const candidateTitle = (await candidate.innerText()).trim().replace(/…$/, "");
      const sessions = await page.evaluate(async () => {
        const data = await fetch("/api/sessions").then((res) => res.json());
        return (data.sessions ?? []).map((session) => ({
          id: session.id,
          name: session.name,
          firstMessage: session.firstMessage,
        }));
      });
      const probe = candidateTitle.slice(0, 20);
      const session = sessions.find((candidate2) =>
        `${candidate2.name ?? ""}`.trim()
          ? candidate2.name.replace(/\s+/g, " ").startsWith(probe)
          : (candidate2.firstMessage ?? "").replace(/\s+/g, " ").startsWith(probe));
      assert.ok(session, `the row's session is in the app's own list (${JSON.stringify(candidateTitle)})`);
      const label = ((session.name?.trim() ? session.name : session.firstMessage.replace(/\n/g, " ").trim())
        || session.id.slice(0, 12)).replace(/"/g, "'");
      const expected = /[\s"']/.test(label) ? `#"${label}"` : `#${label}`;
      // The count is taken with the menu open, when the session's own messages have long arrived:
      // the only thing that may add a message is a send.
      const messagesBefore = await page.locator(".message-user, [data-message-role=\"user\"]").count();
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
  // The new session's composer remounts under its own draft key while the page settles, and a
  // file handed to an input that is on its way out is dropped. Give it the beat, then retry. The
  // composer's own shell owns the input and the thumbnails, so the attach is scoped to it: a
  // session's composer left in the DOM must not be the one that receives the file.
  await page.waitForTimeout(700);
  const shell = page.locator(".chat-input-shell").last();
  const composerShells = await page.locator(".chat-input-shell").count();
  let attached = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await shell.locator('input[type="file"]').first().setInputFiles({ name: "e2e-shot.png", mimeType: "image/png", buffer: PNG });
    attached = await shell.locator("[data-image-gallery] img").count();
    if (attached > 0) break;
    await page.waitForTimeout(1000);
  }
  if (attached === 0) console.log(`[debug] composer shells: ${composerShells}`);
  await shell.locator("[data-image-gallery] img").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(900); // the store's 300ms debounce, with room
  await page.reload({ waitUntil: "domcontentloaded" });
  await composer.waitFor({ timeout: 20_000 });
  const restored = await composer.inputValue();
  assert.equal(restored, draft, `the New Session draft came back after a reload (got ${JSON.stringify(restored)})`);
  // The text is localStorage's; the picture is the byte store's, so it lands a beat later.
  await page.locator(".chat-input-shell").last().locator("[data-image-gallery] img").first().waitFor({ timeout: 10_000 });
  assert.equal(await page.locator(".chat-input-shell").last().locator("[data-image-gallery] img").count(), 1, "the screenshot survived the reload with its prompt");

  // The reload gave the prompt and the picture back; clearing both must clear the durable copy,
  // so the next reload offers nothing the user has already thrown away. The box the user is typing
  // in is the one whose thumbnails are counted, and the click is its own remove control.
  const thumbsIn = (index) => page.locator(".chat-input-shell").nth(index).locator("[data-image-gallery] img");
  const shells = await page.locator(".chat-input-shell").count();
  let liveShell = -1;
  for (let index = 0; index < shells; index += 1) {
    if ((await thumbsIn(index).count()) > 0) {
      liveShell = index;
      break;
    }
  }
  assert.ok(liveShell >= 0, "the reloaded prompt is attached to a composer the page can see");
  await composer.fill("");
  // The remove control is the sibling of the thumbnail's wrapper, not of the image node itself.
  await page.locator(".chat-input-shell").nth(liveShell).getByRole("button", { name: /Remove image|移除/i }).first().click();
  await page.waitForTimeout(1200);
  assert.equal(await thumbsIn(liveShell).count(), 0, "the composer the user removed the screenshot from shows none");
  await page.reload({ waitUntil: "domcontentloaded" });
  await composer.waitFor({ timeout: 20000 });
  const cleared = await composer.inputValue();
  assert.equal(cleared, "", `a cleared New Session draft does not come back (got ${JSON.stringify(cleared)})`);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator("[data-image-gallery] img").count(), 0, "nor does a screenshot the user removed, on any composer");

  console.log("e2e/search-draft-insert: ok");
} finally {
  await browser.close();
}
