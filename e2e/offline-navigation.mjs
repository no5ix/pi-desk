// The production service worker's navigation policy, against a real production server.
//   PI_WEB_DESKTOP_BUILD=1 node node_modules/next/dist/bin/next build --webpack
//   E2E_SERVER_MODE=start node e2e/offline-navigation.mjs
//
// A browser allows about six open connections to one host over HTTP/1.1, and a page here
// keeps several open on purpose (the open session, running sessions, file watchers,
// terminals). A refresh's document request competes with them, and the worker's navigation
// budget used to answer that queue with the dead-end "Pi Web is offline" page while the
// local server was healthy — the user's "refresh shows offline, refresh again works".
// This drives exactly that: one page saturates the pool, the other refreshes.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createE2EServerEnv } from "../scripts/e2e-server-env.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = join(root, "test-results", "offline-navigation");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

const freePort = async () => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

/** The same extra flags `npm start` passes, read from package.json. */
const keepAliveFlag = /--keepAliveTimeout[= ](\d+)/.exec(pkg.scripts.start ?? "");
function startArgs(port) {
  const args = ["start", "-H", "127.0.0.1", "-p", String(port)];
  if (keepAliveFlag) args.push("--keepAliveTimeout", keepAliveFlag[1]);
  return args;
}

const agentDir = await mkdtemp(join(tmpdir(), "pi-offline-e2e-agent-"));
// A project with files to open, and a session in it: the file tabs of scenario 4 are the
// connections that used to starve a refresh.
const project = join(agentDir, "project");
await mkdir(project, { recursive: true });
const FILE_NAMES = ["notes-1.md", "notes-2.txt", "notes-3.md", "notes-4.md"];
for (const name of FILE_NAMES) {
  await writeFile(join(project, name), `one ${name}\n`);
}
await writeFile(join(project, "notes-2.txt"), "the first line\n");
// The watcher's state is labelled in every viewer, by two different elements: an image,
// audio or document viewer renders the toolbar's `.file-viewer-live-status` (`.is-live`
// while the stream is open); a text viewer shows the same state as a
// `.file-viewer-live-indicator` dot, labelled "Live sync active" (components/FileViewer.tsx).
// So the project holds one 1x1 PNG as well: it is the tab that shows the toolbar badge.
const IMAGE_NAME = "notes.png";
await writeFile(join(project, IMAGE_NAME), Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));
const session = "offline-navigation-project";
const timestamp = "2026-10-27T00:00:00.000Z";
await mkdir(join(agentDir, "sessions/test"), { recursive: true });
await writeFile(join(agentDir, "sessions/test", `${session}.jsonl`), [
  { type: "session", version: 3, id: session, timestamp, cwd: project },
  { type: "session_info", id: "name", parentId: null, timestamp, name: "Offline navigation project" },
  { type: "message", id: "message", parentId: "name", timestamp,
    message: { role: "user", content: "Open the project files" } },
].map((row) => JSON.stringify(row)).join("\n") + "\n");
const env = createE2EServerEnv(process.env, agentDir, "start");
for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_DOWNLOAD_DIR", "APPDATA", "LOCALAPPDATA"]) {
  await mkdir(env[key], { recursive: true });
}
// `next start` reads .next-desktop, the isolated production build (next.config.ts swaps
// distDir), so this never touches a running dev server's .next.
env.PI_WEB_DESKTOP_BUILD = "1";

/** Which document the worker answered with, by title: the two fallback pages, or the app. */
const pageKind = () => {
  const title = document.title;
  if (title.includes("offline")) return "offline";
  if (title.includes("not answering")) return "unavailable";
  return "app";
};

/** The app itself: the shell React renders, not just a title. */
const appIsLoaded = () => Boolean(document.querySelector(".app-shell"));

let server = null;
let logs = [];
let browser = null;
let failed = false;

function startServer(port) {
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), ...startArgs(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => { logs.push(String(data)); });
  child.stderr.on("data", (data) => { logs.push(String(data)); });
  return child;
}

async function waitForServer(origin, child, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`the server exited:\n${logs.join("")}`);
    try {
      if ((await fetch(`${origin}/api/sessions`, { signal: AbortSignal.timeout(2_000) })).ok) return;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) throw new Error(`the server did not answer:\n${logs.join("")}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

const waitForKind = async (page, kinds, what, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const kind = await page.evaluate(pageKind).catch(() => "detached");
    if (kinds.includes(kind)) return kind;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}, the page is "${kind}"`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

/**
 * Take the browser's HTTP/1.1 socket pool for this origin. The pool is shared by every tab
 * in the context, so this is the same pressure several open tabs, file watchers and
 * terminals put on a refresh. Eight streams on top of the page's own two: six sockets, the
 * rest queued behind them.
 */
const saturate = async (page, count) => {
  await page.evaluate((n) => {
    window.__hog = Array.from({ length: n }, () => new EventSource("/api/agent/running/events"));
  }, count);
  await page.waitForFunction(() => {
    const open = window.__hog.filter((source) => source.readyState === EventSource.OPEN).length;
    const queued = window.__hog.filter((source) => source.readyState === EventSource.CONNECTING).length;
    return open >= 4 && queued >= 2;
  }, null, { timeout: 30_000 });
};

const release = async (page) => {
  await page.evaluate(() => {
    (window.__hog ?? []).forEach((source) => source.close());
    window.__hog = [];
  });
};

const step = (name) => console.log(`  ✓ ${name}`);

let port;
try {
  await mkdir(artifacts, { recursive: true });
  port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  server = startServer(port);
  await waitForServer(origin, server);
  step(`production server on ${port} (${startArgs(port).join(" ")})`);

  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);

  // The worker is registered by the page's own load handler, and claims the tab.
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 30_000 });
  await page.waitForFunction(appIsLoaded, null, { timeout: 30_000 });
  step("the production page is controlled by the service worker");

  // 1. A starved refresh. The browser's six HTTP/1.1 connections to this origin are all
  // held by another tab's streams, so this tab's document request queues: the server is
  // healthy, the page cannot reach it.
  const hog = await context.newPage();
  await hog.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await saturate(hog, 8);
  const starvedAt = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  const starvedKind = await page.evaluate(pageKind);
  const starvedMs = Date.now() - starvedAt;
  assert.notEqual(starvedKind, "app", "a refresh with every connection taken cannot load the app");
  assert.notEqual(starvedKind, "offline", "a starved refresh must not claim the server is offline");
  assert.equal(starvedKind, "unavailable", `a starved refresh shows the "not answering" page, got "${starvedKind}"`);
  step(`a starved refresh shows the "not answering" page after ${Math.round(starvedMs / 1000)}s`);

  // ... and heals itself once a connection frees, with no second refresh.
  await release(hog);
  assert.equal(
    await waitForKind(page, ["app"], "the page to reload itself once the server is reachable again"),
    "app",
    "the page reloads itself when a connection frees",
  );
  await page.waitForFunction(appIsLoaded, null, { timeout: 30_000 });
  step("the page reloads itself when the server answers again");

  // 2. The server is really gone: the offline page must be instant, not after the budget,
  // and the page must come back by itself when the server returns.
  server.kill("SIGKILL");
  await once(server, "exit");
  const downAt = Date.now();
  await page.reload({ waitUntil: "domcontentloaded" });
  const downKind = await page.evaluate(pageKind);
  const downMs = Date.now() - downAt;
  assert.equal(downKind, "offline", `a dead server shows the offline page, got "${downKind}"`);
  assert.ok(downMs < 5_000, `a refused port answers in about a second, took ${downMs}ms`);
  step(`the offline page appears in ${downMs}ms with the server killed`);

  server = startServer(port);
  await waitForServer(origin, server);
  assert.equal(await waitForKind(page, ["app"], "the page to reload itself once the server is back"), "app");
  await page.waitForFunction(appIsLoaded, null, { timeout: 30_000 });
  step("the page reloads itself when the server comes back, with no user action");

  // 3. Refreshes spaced across the server's keep-alive window. The browser reuses an idle
  // socket the server retires at the same moment, and a five-second server window makes
  // that a refused request the worker answers with a fallback page; the window must be
  // wider than the browser's reuse window. The load-bearing assert is the flag itself
  // (scripts/prod-server-flags.test.mjs); this sweep is the smoke check around it.
  assert.ok(keepAliveFlag, "npm start must raise --keepAliveTimeout above the browser's socket reuse window");
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5_200));
    await page.reload({ waitUntil: "domcontentloaded" });
    const kind = await page.evaluate(pageKind);
    assert.equal(kind, "app", `refresh ${i + 1} of the keep-alive sweep, got "${kind}"`);
    await page.waitForFunction(appIsLoaded, null, { timeout: 30_000 });
  }
  step("six refreshes spaced across the keep-alive window all load the app");

  // The tab that held the pool is done: the scenarios below measure the page's own demand.
  await hog.close();

  // 4. Open file tabs must not spend the pool: four files open, one file-watch connection
  // on the server, and a write to one of them still reloads that file's viewer.
  //
  // The panel's geometry is read here, and at 1280px it sits on a knife edge: its width
  // lands just under FILE_TREE_AUTO_COLLAPSE_WIDTH (540px, components/AppShell.tsx), so
  // opening a file auto-collapses the tree, and bringing the tree back squeezes the viewer
  // to 240px — where `.file-viewer-path { min-width: 0 }` (app/native-theme.css, imported
  // last) collapses a markdown toolbar's path to zero width. 1440px keeps the panel above
  // the threshold, so the scenarios below measure connections, not flex arithmetic.
  await page.setViewportSize({ width: 1440, height: 900 });
  const watchRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/files/")) return;
    const type = url.searchParams.get("type");
    if (type === "watch" || type === "watch-all") watchRequests.push(type);
  });

  /**
   * Open one file from the explorer, and wait until its viewer is the panel's live one.
   *
   * Neither signal is a `?type=read` response: an image viewer is an `<img>` whose URL is
   * byte-identical on a re-open, and Chromium answers that from its renderer's memory
   * cache — no request leaves (`Cache-Control: no-cache` bounds the server's staleness,
   * not the browser's memory), so a response wait for it hangs on a second pass over the
   * same file in one document.
   */
  const openFileFromTree = async (filePath) => {
    // The explorer lives in the panel's own column; the panel's toggle is the topbar's
    // button on a desktop and the floating `.right-panel-toggle-button` on a phone, and
    // both are labelled "Show workspace" (components/AppShell.tsx).
    const panel = page.locator("#file-panel");
    if (!(await panel.evaluate((element) => element.classList.contains("right-panel-open")))) {
      await page.locator('button[aria-label="Show workspace"]').first().click();
      await panel.waitFor({ state: "visible" });
    }
    // The file list starts hidden while the panel is a bare preview surface, and a panel
    // narrower than 540px steps it aside as soon as a viewer is shown
    // (FILE_TREE_AUTO_COLLAPSE_WIDTH): the toggle brings it back for the next file.
    const treeToggle = page.locator(".file-tree-toggle");
    await treeToggle.waitFor();
    if (await treeToggle.getAttribute("aria-pressed") !== "true") await treeToggle.click();
    // A file row and the name inside it share the `title={node.fullPath}`; the row is first.
    const row = page.getByTitle(filePath, { exact: true }).first();
    await row.waitFor({ state: "visible" });
    // The tab strip says this file is the panel's active tab (`title={tab.filePath}` with
    // `aria-selected`, components/TabBar.tsx), and the viewer's live control says the
    // shared stream's `connected` frame reached it: `.file-viewer-live-status` in the
    // image/audio/document toolbar, the `aria-label="Live sync active"` dot in the text
    // toolbar (components/FileViewer.tsx). Every open tab stays mounted with the panel and
    // has the same badge, so the badge search keeps only visible matches.
    const activeTab = page.locator(`[role="tab"][title="${filePath}" i][aria-selected="true"]`);
    const live = page
      .locator('.file-viewer-live-status.is-live, [aria-label="Live sync active"]')
      .locator("visible=true");
    await row.click();
    await activeTab.first().waitFor({ state: "visible", timeout: 20_000 });
    await live.first().waitFor({ timeout: 20_000 });
  };

  /** The project's files as open tabs, the last one the image (the tab that stays shown). */
  const openProjectFiles = async () => {
    for (const name of [...FILE_NAMES, IMAGE_NAME]) {
      await openFileFromTree(join(project, name));
    }
  };

  await page.goto(`${origin}/?session=${session}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(appIsLoaded, null, { timeout: 30_000 });
  await openProjectFiles();
  // The active tab is the image, the viewer that draws the toolbar's live badge: the shared
  // file-watch stream (`/api/files/watch-all?type=watch-all&paths=[…]`,
  // lib/file-watch-channel.ts) is open and its `connected` frame reached the viewers.
  await page
    .locator('.file-viewer-live-status.is-live, [aria-label="Live sync active"]')
    .locator("visible=true")
    .first()
    .waitFor({ timeout: 20_000 });
  const snapshot = await (await fetch(`${origin}/api/agent/debug`, { signal: AbortSignal.timeout(10_000) })).json();
  assert.equal(snapshot.server.fileWatches, 1, `open files, one connection: ${JSON.stringify(snapshot.server.pages)}`);
  assert.equal(watchRequests.filter((type) => type === "watch").length, 0, "no viewer opens a stream of its own");
  assert.ok(watchRequests.includes("watch-all"), "the page opens the fan-in stream");
  step("four open text tabs and an image tab share one file-watch connection");

  // Show notes-2.txt (its viewer is the only one mounted) and change it: the marker can
  // only reach the screen through the shared stream's change frame, and the badge above is
  // the text viewer's copy of the live dot.
  await openFileFromTree(join(project, "notes-2.txt"));
  const marker = `written at ${Date.now()}`;
  await writeFile(join(project, "notes-2.txt"), `the first line\n${marker}\n`);
  await page.getByText(marker).first().waitFor({ timeout: 20_000 });
  step("a change to one watched file reaches its viewer over the shared stream");

  // 5. The same page, saturated again: with the watchers on one connection, the refresh
  // gets a socket and the app loads. This is the user's report, fixed at its cause.
  for (let i = 0; i < 3; i++) {
    // Only the desktop shell reopens file tabs after a reload (hooks/useDesktopWorkspaceTabs.ts),
    // so they are opened again here: every refresh below is taken while the session's stream
    // and the file watchers' stream hold connections.
    await openProjectFiles();
    await page.reload({ waitUntil: "domcontentloaded" });
    assert.equal(await page.evaluate(pageKind), "app", `refresh ${i + 1} with four files open, got "${await page.evaluate(pageKind)}"`);
    await page.waitForFunction(appIsLoaded, null, { timeout: 30_000 });
  }
  step("three refreshes with four file tabs, a session and the keep-alive streams open all load the app");

  // 6. A second tab of the same browser shares what is the same for every tab. The running
  // set is browser chrome, so the tabs elect one leader over `pi-web:running-sessions`
  // (lib/running-sessions-stream.ts, lib/scheduled-tasks/shared-stream.ts) and the second
  // tab spends no connection on it — the fan-out to a tab that does not lead is what
  // lib/scheduled-tasks/shared-stream.test.mjs and the shared file-watch stream above cover.
  const secondTab = await context.newPage();
  const runningStreams = [];
  secondTab.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/agent/running/events") runningStreams.push(request.url());
  });
  await secondTab.goto(`${origin}/?session=${session}`, { waitUntil: "domcontentloaded" });
  await secondTab.waitForFunction(appIsLoaded, null, { timeout: 30_000 });
  await secondTab.waitForTimeout(2_000);
  assert.equal(await secondTab.evaluate(pageKind), "app", "the second tab loads the app");
  assert.equal(
    runningStreams.length,
    0,
    `the first tab leads the running-sessions stream; this tab opened ${runningStreams.length}`,
  );
  step("a second tab shares the running-sessions stream");

  await secondTab.close();
  await hog.close();
  await page.close();
} catch (error) {
  failed = true;
  if (browser) {
    const [page] = browser.contexts().flatMap((context) => context.pages());
    if (page) {
      await page.screenshot({ path: join(artifacts, "failure.png"), fullPage: true }).catch(() => {});
      console.log(`  page: ${page.url()} kind: ${await page.evaluate(pageKind).catch(() => "detached")}`);
    }
  }
  console.log(logs.slice(-40).join(""));
  throw error;
} finally {
  server?.kill("SIGKILL");
  await browser?.close();
  await rm(agentDir, { recursive: true, force: true });
  if (failed) console.log("FAIL offline-navigation");
  else console.log("PASS offline-navigation");
}
