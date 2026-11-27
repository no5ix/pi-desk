import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
/**
 * The header's Background Tasks card, measured in a browser.
 *
 * Two reports from the user, both measurable:
 * - the chip in the title row wore the accent plate while work ran, so it read as highlighted
 *   (as pressed) before it was ever clicked. The plate belongs to the card that is open and to
 *   the pointer, and to nothing else;
 * - clicking it opened an empty rounded rectangle: the card's two pages are stacked with
 *   `position: absolute`, so its box had nothing in flow, and the rule that handed the card the
 *   shell's height box also dropped its floor to zero. The menu's surface therefore painted a
 *   500px strip about 18px tall, with a head, a filter row, six rows and a log all invisible.
 *
 * The claims are therefore geometry, on the app's real CSS, the real chip, the real card and
 * the shell's own placement function:
 * - closed, the chip has no wash at all, running tasks and an unseen failure included;
 * - open, the chip wears the plate;
 * - open, the card is a box with the head, the filters and real rows inside it, capped to the
 *   viewport and floored at the monitor's own height;
 * - a task's page keeps that box: its head, rows of detail and the log tail all inside it;
 * - on a phone the same box is centred under the header and stays inside the screen.
 *
 * The pass that restores the two rules that made the empty rectangle (the floor at zero, the two
 * absolute pages) expects the measurement to see the collapse, so the assertions cannot pass by
 * being blind.
 */
const out = "test-results/background-tasks-card";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/background-tasks-card.fixture.jsx"],
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

const SESSION = "session-1";
const START = Date.now() - 120_000;
function task(id, status, extra = {}) {
  const running = status === "running";
  return {
    task: {
      id,
      name: extra.name ?? "",
      command: extra.command ?? `npm run test:${id}`,
      description: "Runs the suite in a child process and reports the tail.",
      status,
      outputPath: `/tmp/pi-tasks/${id}.log`,
      cwd: "/Users/lynx/Documents/github/pi-desk",
      startTime: START - (extra.ago ?? 0),
      endTime: running ? undefined : Date.now() - 5_000,
      exitCode: running ? null : status === "completed" ? 0 : 1,
      pid: 42_000 + Number(id.replace(/\D/g, "")),
      bytesWritten: 42_000,
      isAgent: extra.isAgent === true,
      surviveReload: false,
      notified: !running,
      notifyOnCompletion: true,
      triggerOnCompletion: true,
    },
    kind: extra.isAgent ? "agent-shell" : "shell",
    seen: extra.seen !== false,
    canRerun: !running,
    canReadResult: !running,
    truncatedFields: [],
  };
}
const TASKS = [
  task("1", "running", { command: "npm run test:e2e", name: "Browser suite", isAgent: true, seen: false }),
  task("2", "running", { ago: 80_000, command: "node scripts/measure-fork-drift.mjs" }),
  task("3", "failed", { ago: 900_000, command: "node e2e/agents-panel-card.mjs", name: "Agents card" }),
  task("4", "completed", { ago: 1_200_000, command: "node --test lib/background-tasks/*.test.mjs" }),
  task("5", "completed", { ago: 1_800_000, command: "node_modules/.bin/tsc --noEmit", name: "Typecheck" }),
  task("6", "killed", { ago: 2_400_000, command: "npm run dev" }),
];
const COUNTS = {
  running: 2, completed: 2, failed: 1, killed: 1,
  unseenCompleted: 0, unseenFailed: 1, unseenKilled: 0, total: TASKS.length,
};
const ZERO_COUNTS = {
  running: 0, completed: 0, failed: 0, killed: 0,
  unseenCompleted: 0, unseenFailed: 0, unseenKilled: 0, total: 0,
};

/** The fork's dark palette: the theme the report was written in. */
const DARK = () => {
  document.documentElement.setAttribute("data-theme", "dark");
  document.documentElement.classList.add("dark");
};

function json(res, body, status = 200) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
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
    if (url.pathname === "/api/background-tasks/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`data: ${JSON.stringify({ type: "hello", counts: COUNTS })}\n\n`);
      return;
    }
    if (url.pathname === "/api/background-tasks/task") {
      const view = TASKS.find((item) => item.task.id === url.searchParams.get("taskId")) ?? null;
      if (url.searchParams.get("type") === "logs") {
        const text = Array.from({ length: 120 }, (_, i) => `step ${String(i + 1).padStart(3, "0")} · npm run test · ok`).join("\n");
        json(res, {
          ok: true, text, path: view?.task.outputPath ?? "/tmp/pi-tasks/log",
          totalBytes: text.length, bytesRead: text.length, bytesWritten: text.length,
          truncated: false, windowStart: 0, windowEnd: text.length,
        });
        return;
      }
      json(res, { ok: true, result: { task: view }, activationId: "act-1", revision: 1, observedAt: Date.now() });
      return;
    }
    if (url.pathname === "/api/background-tasks" && req.method === "POST") {
      json(res, { ok: true, activationId: "act-1", revision: 2, observedAt: Date.now() });
      return;
    }
    if (url.pathname === "/api/background-tasks") {
      const limit = Number(url.searchParams.get("limit") ?? "0");
      const idle = url.searchParams.get("session") === "session-idle";
      json(res, {
        state: "ready",
        available: true,
        tasks: idle ? [] : (limit === 1 ? TASKS.slice(0, 1) : TASKS),
        counts: idle ? ZERO_COUNTS : COUNTS,
        sessions: idle
          ? [{ sessionId: "session-idle", cwd: "/Users/lynx/Documents/github/pi-desk", state: "ready", counts: ZERO_COUNTS, primary: true }]
          : [{ sessionId: SESSION, cwd: "/Users/lynx/Documents/github/pi-desk", state: "ready", counts: COUNTS, primary: true }],
        sessionNames: { [SESSION]: "Fix the task card", "session-idle": "Nothing running" },
        observedAt: Date.now(),
        activationId: "act-1",
        revision: 1,
        nextCursors: {},
      });
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const MEASURE = () => {
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  const alpha = (color) => {
    const direct = /rgba?\(([^)]*)\)/.exec(color);
    if (!direct) return color === "transparent" ? 0 : 1;
    const parts = direct[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return parts.length >= 4 ? parts[3] : 1;
  };
  const inside = (item, outer) => item.top >= outer.top - 1 && item.bottom <= outer.bottom + 1
    && item.left >= outer.left - 1 && item.right <= outer.right + 1;
  const chip = document.querySelector("[data-background-tasks-button]");
  const panel = document.querySelector("[data-background-tasks-panel]");
  const layer = document.querySelector(".top-panel-card");
  const all = (selector) => [...panel.querySelectorAll(selector)];
  const list = panel.querySelector(".bg-tasks-list");
  const rows = all(".bg-tasks-row").map((row) => ({
    box: box(row),
    text: row.querySelector(".bg-tasks-row-title")?.textContent ?? "",
    id: row.getAttribute("data-task-id") ?? "",
  }));
  const visibleRows = rows.filter((row) => list && inside(row.box, box(list)));
  const detail = panel.querySelector(".bg-tasks-detail");
  const log = panel.querySelector(".bg-tasks-log");
  const back = panel.querySelector(".bg-tasks-back");
  const pageBox = (selector) => {
    const el = panel.querySelector(selector);
    return el ? box(el) : null;
  };
  const panelBox = panel ? box(panel) : null;
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    chip: chip ? {
      box: box(chip),
      backgroundAlpha: alpha(getComputedStyle(chip).backgroundColor),
      open: chip.classList.contains("is-open"),
      running: chip.classList.contains("is-running"),
      failed: chip.classList.contains("has-failed"),
    } : null,
    panel: panel ? {
      box: panelBox,
      page: panel.dataset.page,
      layerHeight: box(layer).height,
      listPage: pageBox(".bg-tasks-page.is-list"),
      head: pageBox(".bg-tasks-head"),
      title: (panel.querySelector(".bg-tasks-title")?.textContent ?? "").trim(),
      filters: pageBox(".bg-tasks-filters"),
      list: list ? { box: box(list), clientHeight: list.clientHeight, scrollHeight: list.scrollHeight, overflow: getComputedStyle(list).overflowY } : null,
      rows,
      visibleRows,
      headInside: inside(pageBox(".bg-tasks-head"), panelBox),
      filtersInside: pageBox(".bg-tasks-filters") ? inside(pageBox(".bg-tasks-filters"), panelBox) : false,
      visibleRowsInside: visibleRows.length > 0 && visibleRows.every((row) => inside(row.box, panelBox)),
      detail: detail ? { box: box(detail), rows: all(".bg-tasks-detail-row").length, inside: inside(box(detail), panelBox) } : null,
      log: log ? { box: box(log), clientHeight: log.clientHeight, text: (log.textContent ?? "").trim().slice(0, 40) } : null,
      back: back ? { box: box(back), inside: inside(box(back), panelBox) } : null,
      empty: (() => {
        const el = panel.querySelector(".bg-tasks-empty");
        return el ? { box: box(el), inside: inside(box(el), panelBox), text: (el.textContent ?? "").trim() } : null;
      })(),
    } : null,
  };
};

const server = await serve();
const port = server.address().port;
const browser = await chromium.launch();
const failures = [];
function check(name, ok, detail) {
  if (ok) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures.push(`${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  console.log(`  FAIL ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.addStyleTag({ content: ":root { --dur-fast: 0ms; --dur-base: 0ms; }" });
  // The user's report is a dark window, and the fork's dark palette is the one that makes the
  // chip's plate and the card's surface visible: measure there.
  await page.evaluate(DARK);
  await page.waitForSelector("[data-background-tasks-button]");
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/chip-closed-dark.png`, clip: { x: 0, y: 0, width: 560, height: 140 } });

  // --- 1. The chip: a pill, not a plate, until it is opened.
  const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  check("the measurement runs in the app's dark palette", scheme === "dark", scheme);
  const closedChip = await page.evaluate(() => {
    const chip = document.querySelector("[data-background-tasks-button]");
    const probeColor = (token) => {
      const probe = document.createElement("span");
      probe.style.color = `var(${token})`;
      probe.style.display = "none";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    return {
      background: getComputedStyle(chip).backgroundColor,
      running: chip.classList.contains("is-running"),
      failed: chip.classList.contains("has-failed"),
      open: chip.classList.contains("is-open"),
      chipColor: getComputedStyle(chip).color,
      headColor: getComputedStyle(chip.querySelector(".bg-tasks-head-mark")).color,
      markColor: chip.querySelector(".bg-tasks-chip-mark")
        ? getComputedStyle(chip.querySelector(".bg-tasks-chip-mark")).color : null,
      countColor: getComputedStyle(chip.querySelector(".bg-tasks-chip-count")).color,
      accent: probeColor("--accent"),
      success: probeColor("--success"),
      warning: probeColor("--warning"),
      muted: probeColor("--text-muted"),
    };
  });
  check("the chip is closed, and running work plus an unseen failure are reported",
    closedChip.running && closedChip.failed && !closedChip.open, closedChip);
  check("closed, the chip wears no plate: nothing is highlighted before the click",
    closedChip.background === "rgba(0, 0, 0, 0)", closedChip.background);
  check("closed, the number is the row's ink: the state is in the head, not in the pill",
    closedChip.countColor === closedChip.chipColor && closedChip.countColor === closedChip.muted
    && closedChip.countColor !== closedChip.accent, closedChip);
  check("closed, the head says what is happening: green breathes, the failure marks in warning",
    closedChip.headColor === closedChip.warning && closedChip.markColor === closedChip.warning
    && closedChip.warning !== closedChip.accent, closedChip);

  // --- 2. The card: a box with the monitor in it.
  await page.locator("[data-background-tasks-button]").click();
  await page.waitForSelector("[data-background-tasks-panel] .bg-tasks-row", { timeout: 5_000 });
  await page.waitForTimeout(150);
  let m = await page.evaluate(MEASURE);
  const panel = m.panel;
  check("the card opens under the chip", m.chip.open && m.chip.backgroundAlpha > 0, m.chip);
  check("the card is a box, not a strip: it is at least the monitor's floor",
    panel.box.height >= 224, panel.box);
  check("the card's head is inside it and names itself",
    panel.headInside && panel.title === "Background Tasks", panel);
  check("the filter row is inside the card", panel.filtersInside, panel.filters);
  check("the list is a real scrolling box, not a zero-height slot",
    panel.list && panel.list.clientHeight >= 100 && panel.list.overflow === "auto", panel.list);
  check("the rows are real rows — a row is a row's height",
    panel.rows.length === 6 && panel.rows.every((row) => row.box.height >= 30), panel.rows.map((r) => r.box.height));
  check("the visible rows are inside the card, and the task's name is on screen",
    panel.visibleRows.length >= 3 && panel.visibleRowsInside
    && panel.visibleRows.some((row) => row.text.includes("Browser suite")), panel.visibleRows.map((r) => [r.text, r.box]));
  check("the card stays inside the viewport",
    panel.box.bottom <= m.viewport.height - 9 && panel.box.top > 0, panel.box);
  check("the card keeps the width the shell placed it at",
    Math.abs(panel.box.width - 500) <= 1, panel.box.width);
  await page.screenshot({ path: `${out}/card-dark.png` });

  // --- 3. A task's page keeps the same box.
  await page.locator(".bg-tasks-row").first().click();
  await page.waitForSelector(".bg-tasks-detail", { timeout: 5_000 });
  await page.waitForTimeout(220);
  m = await page.evaluate(MEASURE);
  const detailPanel = m.panel;
  check("a task opens its page inside the same card, at the same height",
    detailPanel.page === "detail" && Math.abs(detailPanel.box.height - panel.box.height) <= 2,
    { page: detailPanel.page, was: panel.box.height, now: detailPanel.box.height });
  check("the detail block, its rows and the log are inside the card",
    detailPanel.detail?.inside && detailPanel.detail.rows >= 3
    && detailPanel.log && detailPanel.log.box.bottom <= detailPanel.box.bottom + 1, detailPanel);
  check("the log tail is a box with the log in it",
    detailPanel.log.clientHeight >= 40 && detailPanel.log.text.includes("step"), detailPanel.log);
  check("the back control sits in the card's upper-left corner",
    detailPanel.back?.inside
    && Math.abs(detailPanel.back.box.top - detailPanel.box.top) < 60
    && Math.abs(detailPanel.back.box.left - detailPanel.box.left) < 40, detailPanel.back);
  check("the list page keeps the card's height for the way back",
    detailPanel.listPage
    && detailPanel.listPage.height >= detailPanel.box.height - 40
    && detailPanel.listPage.height >= 224,
    { listPage: detailPanel.listPage?.height, panel: detailPanel.box.height });
  await page.screenshot({ path: `${out}/detail-dark.png` });

  // --- 4. The old rules, put back: the measurement must see the empty rectangle.
  const broken = await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "restore-the-bug";
    style.textContent = [
      // The floor the card lost, and both pages out of flow: the box has nothing in it.
      ".bg-tasks-panel { min-height: 0 !important; }",
      ".bg-tasks-page { position: absolute !important; inset: 0 !important; }",
    ].join("\n");
    document.head.append(style);
    const panel = document.querySelector("[data-background-tasks-panel]");
    const r = panel.getBoundingClientRect();
    return { height: r.height, width: r.width };
  });
  check("with the floor at zero and both pages absolute the box collapses to a strip",
    broken.height < 100, broken);
  check("and the width is unchanged: only the height carries the bug",
    Math.abs(broken.width - 500) <= 1, broken);
  await page.evaluate(() => document.getElementById("restore-the-bug")?.remove());
  const restored = await page.evaluate(() => document.querySelector("[data-background-tasks-panel]").getBoundingClientRect().height);
  check("taking the injected rules away restores the box", restored >= 224, restored);

  // --- 5. A phone: the same box, centred, inside the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(220);
  m = await page.evaluate(MEASURE);
  const phone = m.panel;
  check("on a phone the card is a box too, and the screen contains it",
    phone.box.height >= 224 && phone.box.bottom <= m.viewport.height - 9
    && phone.box.width <= m.viewport.width, phone.box);
  check("on a phone the card centres under the header",
    Math.abs((phone.box.left + phone.box.right) / 2 - m.viewport.width / 2) <= 2, phone.box);

  // --- 6. Closing puts the plate back on the chip and the card away.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(120);
  await page.locator("[data-background-tasks-button]").click();
  await page.waitForTimeout(400);
  const afterClose = await page.evaluate(() => {
    const chip = document.querySelector("[data-background-tasks-button]");
    return {
      open: chip.classList.contains("is-open"),
      alpha: /rgba?\(([^)]*)\)/.exec(getComputedStyle(chip).backgroundColor)?.[3],
      panel: document.querySelector(".top-panel-card")?.getBoundingClientRect().height ?? null,
    };
  });
  check("closing takes the plate off the chip", afterClose.open === false, afterClose);
  check("closing takes the card away", afterClose.panel === null, afterClose);

  // --- 7. A conversation with nothing to show: the card is a box that says so, not a strip.
  const idle = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await idle.goto(`http://127.0.0.1:${port}/?session=session-idle`);
  await idle.addStyleTag({ content: ":root { --dur-fast: 0ms; --dur-base: 0ms; }" });
  await idle.evaluate(DARK);
  await idle.waitForSelector("[data-background-tasks-button]");
  await idle.locator("[data-background-tasks-button]").click();
  await idle.waitForSelector("[data-background-tasks-panel] .bg-tasks-empty", { timeout: 5_000 });
  await idle.waitForTimeout(150);
  const idleM = await idle.evaluate(MEASURE);
  check("with no tasks the card is still a box, not a strip",
    idleM.panel.box.height >= 224, idleM.panel.box);
  check("and it says there is nothing, in the box, under its head and filters",
    idleM.panel.empty?.inside && idleM.panel.filtersInside && idleM.panel.rows.length === 0
    && idleM.panel.empty.text.length > 0, idleM.panel.empty);
  await idle.screenshot({ path: `${out}/idle-dark.png` });
  await idle.close();

  check("the page reported no console error", errors.length === 0, errors.slice(0, 3));
} finally {
  await browser.close();
  server.close();
}

if (failures.length > 0) {
  console.error(`\n${String(failures.length)} check(s) failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nBackground Tasks card: the chip is a pill until it opens, and the card is a box with a monitor in it.");
