import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

/**
 * The header's task monitor, as it renders.
 *
 * The button and the card are rendered for real (server-rendered React, the app's own i18n), so
 * what is asserted is the markup a user gets: the badge is a number only when the extension can
 * answer, its absence is a state, the card is a dialog with the app's menu surface, and every
 * word comes from the message catalog. The wiring in `AppShell` and the rules in the hook are
 * asserted on the source, because they are the parts a browser test cannot see working: the
 * placement is shared with the other header cards (`lib/top-panel-placement.test.mjs` pins the
 * geometry) and the hook's cleanup is about what happens after a component is gone.
 */
const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider, useI18n } = await jiti.import("@/hooks/useI18n");
const { TopbarBackgroundTasks } = await jiti.import("./TopbarBackgroundTasks.tsx");
const { BackgroundTasksPanel } = await jiti.import("./BackgroundTasksPanel.tsx");

function renderButton(props) {
  const Host = () => {
    const { t: translate } = useI18n();
    return React.createElement(TopbarBackgroundTasks, {
      running: 0,
      unseenFailed: 0,
      unseenKilled: 0,
      unseenCompleted: 0,
      available: true,
      open: false,
      onToggle() {},
      translate,
      ...props,
    });
  };
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(Host)));
}

function renderPanel(props = {}) {
  const Host = () => {
    const { t: translate } = useI18n();
    return React.createElement(BackgroundTasksPanel, {
      sessionId: "session-1",
      open: true,
      onClose() {},
      translate,
      ...props,
    });
  };
  return renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(Host)));
}

test("the header's button is one control that names what it opens, and says it is a card", () => {
  const html = renderButton({ running: 2, unseenFailed: 1 });
  assert.match(html, /<button[^>]*data-background-tasks-button=""/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /class="native-toolbar-button app-topbar-tasks is-running"/);
  // The tooltip and the accessible name are the same sentence: the state, in the card's order.
  const label = /aria-label="([^"]*)"/.exec(html)?.[1] ?? "";
  assert.match(label, /Background Tasks/);
  assert.match(label, /2 running/);
  assert.match(label, /1 failed/);
  assert.equal(/title="([^"]*)"/.exec(html)?.[1], label);
});

test("the badge is the extension's number, and nothing is worn when there is nothing to report", () => {
  const bare = renderButton({});
  assert.ok(!bare.includes("app-topbar-tasks-count"), "no running tasks: no number");
  assert.ok(!bare.includes("app-topbar-tasks-failed"), "no unseen failure: no dot");
  assert.ok(!bare.includes("is-running"), "an idle header is not tinted as busy");

  const running = renderButton({ running: 7 });
  assert.match(running, /class="app-topbar-tasks-count"[^>]*>7</);

  // A count that does not fit is a wall of digits on a 16px glyph: the cap is the app's rule.
  assert.match(renderButton({ running: 99 }), />99</);
  assert.match(renderButton({ running: 150 }), />99\+</);

  // A killed task is unseen failure too, and its dot shares the mark with a failed one.
  assert.match(renderButton({ unseenKilled: 1 }), /app-topbar-tasks-failed/);
  assert.match(renderButton({ unseenCompleted: 2 }), /2 done/);
});

test("a badge on a panel that can read nothing is a claim, so it is not worn", () => {
  const html = renderButton({ available: false, running: 5, unseenFailed: 3 });
  assert.ok(!html.includes("app-topbar-tasks-count"));
  assert.ok(!html.includes("app-topbar-tasks-failed"));
  // The tooltip is the bare title: no numbers the panel cannot back up.
  assert.match(/aria-label="([^"]*)"/.exec(html)?.[1] ?? "", /^Background Tasks$/);
});

test("the open button reads as the card it owns", () => {
  const html = renderButton({ open: true, running: 1 });
  assert.match(html, /app-topbar-tasks is-open is-running/);
  assert.match(html, /aria-expanded="true"/);
});

test("the card is a dialog of the app's menu surface, and its controls are named", () => {
  const html = renderPanel();
  // The app's one elevated surface, opened by the header: the surface is not re-declared here.
  assert.match(html, /class="bg-tasks-panel app-menu"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-label="Background Tasks"/);
  assert.match(html, /data-background-tasks-panel=""/);
  // Refresh and close are buttons with names, not glyphs a user has to guess.
  assert.match(html, /aria-label="Refresh"/);
  assert.match(html, /aria-label="Close"/);
  // A card opened before the extension has answered says so. A panel that shows an empty list
  // before the first read would be a panel that says "nothing is running" from no evidence.
  assert.match(html, /class="bg-tasks-state"/);
  assert.match(html, /host interface has not answered yet/);
  const source = readFileSync(new URL("./BackgroundTasksPanel.tsx", import.meta.url), "utf8");
  for (const key of ["backgroundTasks.loading", "backgroundTasks.empty", "backgroundTasks.notInstalled",
    "backgroundTasks.disabled", "backgroundTasks.noSession", "backgroundTasks.notReady",
    "backgroundTasks.stopAllConfirm", "backgroundTasks.logFollowing"]) {
    assert.ok(source.includes(`"${key}"`), `the card renders ${key}`);
  }
});

test("the card's parts are styled by the theme sheet, not by values written in the component", () => {
  const source = readFileSync(new URL("./BackgroundTasksPanel.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8");
  // The fork's rule: reusable classes, and inline style only for a value measured at runtime.
  assert.ok(!/ style=\{/.test(source), "the panel has no inline styles");
  const classes = [...source.matchAll(/className="([^"{]+)"/g)].flatMap((match) => match[1].split(/\s+/));
  const own = classes.filter((name) => name.startsWith("bg-tasks-") || name.startsWith("app-topbar-tasks"));
  assert.ok(own.length > 20, "the panel is styled through classes");
  for (const name of new Set(own)) {
    assert.ok(css.includes(`.${name}`), `.${name} is a rule in app/native-theme.css`);
  }
});

test("the header hosts the card, and the card is not in the side panel", () => {
  const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
  // The card is placed by the shared header placement, at the shared width.
  assert.match(shell, /BACKGROUND_TASKS_PANEL_WIDTH/);
  assert.match(shell, /placeHeaderCard/);
  assert.match(shell, /"tasks"/);
  assert.match(shell, /<TopbarBackgroundTasksButton/);
  assert.match(shell, /<BackgroundTasksPanel/);
  // The button and the card are in the topbar block: the card hangs under the button, so a card
  // rendered in the right panel would be placed by a column it does not belong to.
  const cardIndex = shell.indexOf('className={`top-panel-card');
  const panelIndex = shell.indexOf("<BackgroundTasksPanel");
  const buttonIndex = shell.indexOf("<TopbarBackgroundTasksButton");
  assert.ok(cardIndex > 0, "the header renders one card host");
  // The button is in the topbar's action row and the card is the card host's child, in that
  // order: a card rendered anywhere else is placed by a column it does not belong to.
  assert.ok(buttonIndex > 0 && buttonIndex < cardIndex && cardIndex < panelIndex);
  // The card host renders one panel per header kind; the tasks panel is chosen by that kind, so
  // it is placed by the same placement, at the same top, as the Agents card.
  assert.match(shell.slice(cardIndex, panelIndex + 200), /shownTopPanel === "tasks" && \(\s*<BackgroundTasksPanel/);
  const panelBlock = shell.slice(panelIndex, panelIndex + 700);
  assert.ok(!panelBlock.includes("right-panel"), "the card is not a right-panel child");
});

test("the card closes on Escape and on a click outside, through the header's shared rule", () => {
  const shell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
  const panelSource = readFileSync(new URL("./BackgroundTasksPanel.tsx", import.meta.url), "utf8");
  // One mechanism for every header card: it knows the `tasks` kind, so Escape and outside clicks
  // close it the same way they close the subagents and Agents cards.
  const shared = readFileSync(new URL("../lib/top-panel-placement.ts", import.meta.url), "utf8");
  assert.ok(shared.includes("BACKGROUND_TASKS_PANEL_WIDTH"), "the width the placement uses");
  assert.match(shell, /closeTopPanel|setActiveTopPanel\(null\)|setActiveTopPanel,\s*"tasks"/);
  assert.match(panelSource, /onClose/);
  assert.match(panelSource, /Escape/);
});

test("the client stops listening when the card is closed, and drops a reply that arrived late", () => {
  const hook = readFileSync(new URL("../hooks/useBackgroundTasks.ts", import.meta.url), "utf8");
  // The stream is the live feed; closing the card must close it, not leave it reading forever.
  assert.match(hook, /new EventSource/);
  assert.match(hook, /\.close\(\)/);
  assert.match(hook, /clearTimeout/);
  assert.match(hook, /clearInterval/);
  // A response is checked against the request that is still wanted: a panel that switched
  // conversation must not paint the previous one's tasks.
  assert.match(hook, /snapshotRequestRef|detailRequestRef|logsRequestRef/);
  assert.match(hook, /mountedRef/);
});
