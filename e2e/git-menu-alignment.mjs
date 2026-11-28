import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

/**
 * The Git panel's branch and commit menus, measured in a browser.
 *
 * Each row's kebab sits at the row's right edge. A menu placed from the button
 * opens under that kebab: in a 380px panel it lands in the middle of the list,
 * over the rows it is not about, and against a panel's edge it is pushed further
 * off the row than the row is wide. The rule is that the menu opens at the row's
 * left edge, and that a menu wider than the space to the right is pulled back
 * into the window without crossing to the row's right.
 *
 * That is layout, so it is measured: the real menu components, the real
 * stylesheets, one click per row, three panel widths. The run's last pass serves
 * the fixture with the placement computed from the button — what the code did
 * before — and expects the menu's left to sit far right of the row's, so the
 * check can see the bug it was written for.
 */
const out = "test-results/git-menu-alignment";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/git-menu-alignment.fixture.jsx"],
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

function serve() {
  const server = createServer((req, res) => {
    if (req.url === "/fixture.js") {
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
    res.end(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Click one row's kebab. The menu is React state, so the caller waits for it. */
function clickRow(rowIndex) {
  const rows = Array.from(document.querySelectorAll(".git-branch-row, .git-log-row"));
  rows[rowIndex]?.querySelector(".git-row-menu-button")?.click();
}

/** Where the menu landed, in the page's pixels. */
function measureRow(rowIndex) {
  const rows = Array.from(document.querySelectorAll(".git-branch-row, .git-log-row"));
  const row = rows[rowIndex];
  if (!row) return { missing: true, reason: "no such row" };
  const rowBox = row.getBoundingClientRect();
  const menu = document.querySelector(".git-menu");
  if (!menu) return { missing: true, reason: "no menu opened" };
  const menuBox = menu.getBoundingClientRect();
  const buttonBox = row.querySelector(".git-row-menu-button").getBoundingClientRect();
  // The rows of the menu: a menu about a row reads as a list, so its labels start
  // at the row's own left inset. Centred labels turn a menu into a column of
  // headlines whose left edges mean nothing, and a wide menu makes it worse: the
  // reader cannot run the eye down the list to compare items.
  const itemRows = Array.from(menu.querySelectorAll(".git-menu-item")).map((item) => {
    const itemBox = item.getBoundingClientRect();
    const label = item.querySelector(".git-menu-label") ?? item;
    const labelBox = label.getBoundingClientRect();
    const style = getComputedStyle(item);
    const inset = labelBox.left - itemBox.left;
    // The row's own content edge: the box the label sits in, past its border and
    // its padding (a menu row wears a 2px transparent border for its focus ring).
    const contentLeft = (item.clientLeft || 0) + (Number.parseFloat(style.paddingLeft) || 0);
    const contentWidth = item.clientWidth
      - (Number.parseFloat(style.paddingLeft) || 0) - (Number.parseFloat(style.paddingRight) || 0);
    return {
      label: (label.textContent ?? "").trim().slice(0, 40),
      textAlign: style.textAlign,
      inset,
      contentLeft,
      fill: labelBox.width - contentWidth,
    };
  });
  return {
    kind: row.classList.contains("git-branch-row") ? "branch" : "commit",
    rowLeft: rowBox.left,
    rowWidth: rowBox.width,
    buttonLeft: buttonBox.left,
    menuLeft: menuBox.left,
    menuRight: menuBox.right,
    menuWidth: menuBox.width,
    items: menu.querySelectorAll(".git-menu-item").length,
    separators: menu.querySelectorAll(".app-menu-separator").length,
    innerWidth: window.innerWidth,
    itemRows,
  };
}

const server = await serve();
const port = server.address().port;
const browser = await chromium.launch();
const failures = [];
/** Set when the centred pass reproduces the old centred labels, so the check is known to measure them. */
let centredSeen = false;
const rowIndexes = [0, 1, 2, 3, 4];
const MENU_MARGIN = 8;

const cases = [
  { label: "panel 380px", query: "width=380", viewport: { width: 900, height: 720 } },
  { label: "panel 320px flush to the window's right edge", query: "width=320&edge=flush", viewport: { width: 900, height: 720 } },
  // A window no wider than the panel: the menu cannot open at the row's left edge
  // and stay inside, so the clamp is the answer, and the clamp must not cross to
  // the row's right.
  { label: "window 340px, panel 320px flush right", query: "width=320&edge=flush", viewport: { width: 340, height: 720 } },
];

for (const spec of cases) {
  for (const rowIndex of rowIndexes) {
    const page = await browser.newPage({ viewport: spec.viewport });
    await page.goto(`http://127.0.0.1:${port}/?${spec.query}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".git-branch-row .git-row-menu-button", { timeout: 15000 });
    await page.evaluate(clickRow, rowIndex);
    await page.waitForSelector(".git-menu", { timeout: 3000 }).catch(() => {});
    // The menu pops in on a transform, so its first box is a scaled box. Measure
    // the settled one.
    await page.waitForTimeout(320);
    const measure = await page.evaluate(measureRow, rowIndex);
    await page.close();
    if (measure.missing) {
      failures.push(`${spec.label} row ${rowIndex}: ${measure.reason}`);
      continue;
    }
    if (measure.items !== 3 || measure.separators !== 1) {
      failures.push(`${spec.label} row ${rowIndex}: the menu carries ${measure.items} items and ${measure.separators} separators, expected 3 and 1`);
    }
    // The menu's left is the row's left, pulled in to the window's margin when
    // the row starts inside it.
    const expectedLeft = Math.max(MENU_MARGIN, measure.rowLeft);
    const offRow = measure.menuLeft - expectedLeft;
    if (Math.abs(offRow) > 1.5) {
      failures.push(`${spec.label} ${measure.kind} row ${rowIndex}: the menu opens ${offRow.toFixed(1)}px off the row's left edge (row ${measure.rowLeft.toFixed(1)}, menu ${measure.menuLeft.toFixed(1)}, expected ${expectedLeft.toFixed(1)}, the kebab is at ${measure.buttonLeft.toFixed(1)}, the row is ${measure.rowWidth.toFixed(0)}px wide)`);
    }
    if (measure.menuRight > measure.innerWidth - 7.5) {
      failures.push(`${spec.label} ${measure.kind} row ${rowIndex}: the menu runs past the window (right ${measure.menuRight.toFixed(1)}, window ${measure.innerWidth})`);
    }
    if (measure.menuLeft < 7.5) {
      failures.push(`${spec.label} ${measure.kind} row ${rowIndex}: the menu left the window's margin (${measure.menuLeft.toFixed(1)})`);
    }
    // The labels are left-aligned: every label box starts at its row's content
    // edge and fills it, so the text of every row begins at the same x.
    for (const item of measure.itemRows) {
      if (item.textAlign !== "left" && item.textAlign !== "start") {
        failures.push(`${spec.label} ${measure.kind} row ${rowIndex}: the “${item.label}” row is ${item.textAlign}-aligned, not left`);
      }
      const offInset = item.inset - item.contentLeft;
      if (Math.abs(offInset) > 1.5) {
        failures.push(`${spec.label} ${measure.kind} row ${rowIndex}: the “${item.label}” label starts ${offInset.toFixed(1)}px off the row's content edge (label ${item.inset.toFixed(1)} from the row's border box, content edge ${item.contentLeft.toFixed(1)})`);
      }
      if (Math.abs(item.fill) > 1.5) {
        failures.push(`${spec.label} ${measure.kind} row ${rowIndex}: the “${item.label}” label is ${item.fill.toFixed(1)}px off the row's content width — the text is centred in the row, not flush left`);
      }
    }
  }
}

// The check must be able to see the bug it was written for: the placement
// computed from the kebab, not from the row.
{
  const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
  const notes = [];
  page.on("pageerror", (e) => notes.push(`[pageerror] ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") notes.push(`[error] ${m.text().slice(0, 200)}`); });
  await page.goto(`http://127.0.0.1:${port}/?width=380&unfixed=1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".git-branch-row .git-row-menu-button", { timeout: 15000 });
  const off = await (async () => {
    await page.evaluate(clickRow, 1);
    await page.waitForSelector(".git-menu", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(320);
    return page.evaluate(() => {
      const row = document.querySelectorAll(".git-branch-row, .git-log-row")[1];
      const menu = document.querySelector(".git-menu");
      if (!menu) {
        return { off: NaN, dom: document.querySelector("#root")?.innerHTML.slice(0, 400) };
      }
      return { off: menu.getBoundingClientRect().left - row.getBoundingClientRect().left };
    });
  })();
  await page.close();
  if (Number.isNaN(off.off)) {
    failures.push(`the un-fixed flow opened no menu. dom: ${off.dom}\n  ${notes.slice(0, 3).join("\n  ")}`);
  } else if (!(off.off > 20)) {
    failures.push(`the un-fixed flow measures only ${off.off.toFixed(1)}px off the row: the check cannot see the bug it is for`);
  }
}

// The check must see the alignment bug too: the same menu with centred labels.
{
  const page = await browser.newPage({ viewport: { width: 900, height: 720 } });
  await page.goto(`http://127.0.0.1:${port}/?width=380`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".git-branch-row .git-row-menu-button", { timeout: 15000 });
  await page.evaluate(() => {
    const style = document.createElement("style");
    // What the menu looked like before the labels were given their own left edge:
    // a centred column of headlines inside a wide box.
    style.textContent = ".git-menu .git-menu-item { justify-content: center; text-align: center; } .git-menu .git-menu-label { flex: 0 1 auto; }";
    document.head.append(style);
  });
  await page.evaluate(clickRow, 1);
  await page.waitForSelector(".git-menu", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(320);
  const centred = await page.evaluate(() => {
    const menu = document.querySelector(".git-menu");
    if (!menu) return { missing: true };
    const item = menu.querySelector(".git-menu-item");
    const label = item.querySelector(".git-menu-label") ?? item;
    const style = getComputedStyle(item);
    const contentLeft = (item.clientLeft || 0) + (Number.parseFloat(style.paddingLeft) || 0);
    return {
      textAlign: getComputedStyle(item).textAlign,
      inset: label.getBoundingClientRect().left - item.getBoundingClientRect().left,
      contentLeft,
    };
  });
  await page.close();
  if (centred.missing) {
    failures.push("the centred pass opened no menu: the probe cannot see the alignment bug it is for");
  } else if (centred.textAlign === "center" || Math.abs(centred.inset - centred.contentLeft) > 1.5) {
    centredSeen = true;
  } else {
    failures.push(`the centred pass measures textAlign ${centred.textAlign} and an inset ${centred.inset.toFixed(1)} at the content edge ${centred.contentLeft.toFixed(1)}: the probe cannot see the centring it is for`);
  }
}

await browser.close();
server.close();

if (failures.length) {
  console.error("FAILURES:\n  " + failures.join("\n  "));
  process.exit(1);
}
if (!centredSeen) {
  console.error("the centred pass never reproduced the centred labels");
  process.exit(1);
}
console.log("e2e/git-menu-alignment.mjs: every branch and commit menu opens at its row's left edge, inside the window, with its labels left-aligned, and the probe sees the kebab-anchored placement");
