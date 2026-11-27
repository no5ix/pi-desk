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
const { TopbarBackgroundTasksButton } = await jiti.import("./TopbarBackgroundTasksButton.tsx");
const { BackgroundTasksPanel } = await jiti.import("./BackgroundTasksPanel.tsx");

function renderButton(props) {
  const Host = () => {
    const { t: translate } = useI18n();
    return React.createElement(TopbarBackgroundTasksButton, {
      running: 0,
      unseenFailed: 0,
      title: translate("backgroundTasks.title"),
      tasksOpen: false,
      onToggle() {},
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
  // A chip of the row under the title (project, branch, subagents, clock), wearing that row's
  // pill class — the subagent counts' own — so it is the same control at the same size, and not
  // a box control of the actions row.
  assert.match(html, /class="app-topbar-subagents bg-tasks-chip is-running has-failed"/);
  assert.ok(!html.includes("native-toolbar-button"), "the chip is not a toolbar box");
  // The tooltip and the accessible name name the card the chip opens. The numbers are in the
  // chip itself (the running count, the failure mark), read at a glance; the name is stable.
  const label = /aria-label="([^"]*)"/.exec(html)?.[1] ?? "";
  assert.match(label, /Background Tasks/);
  assert.equal(/title="([^"]*)"/.exec(html)?.[1], label);
});

test("the chip wears the extension's numbers, and nothing is worn when there is nothing to report", () => {
  const bare = renderButton({});
  // The count is always the number the extension reported for this conversation; a conversation
  // with nothing running reports zero, and the chip shows zero with no busy tint and no warning.
  assert.match(bare, /class="bg-tasks-chip-count">0</);
  // The chip is a glyph and a number, never a sentence. Its row carries the project, the branch,
  // the subagent counts and the clock, and the counts there wear no word of their own; the word is
  // what runs out first at a narrow window. The card's name is in the tooltip and the label.
  assert.ok(!bare.includes("bg-tasks-chip-label"), "the chip wears no word");
  assert.ok(!/>Tasks</.test(bare), "no 'Tasks' text in the chip");
  assert.ok(!bare.includes("is-running"), "an idle chip is not tinted as busy");
  assert.ok(!bare.includes("has-failed"), "no unseen failure: no mark");
  assert.ok(!bare.includes("bg-tasks-chip-mark"), "no unseen failure: no glyph");
  assert.ok(bare.includes("is-idle"), "the idle chip is the dim one");

  const running = renderButton({ running: 7 });
  assert.match(running, /class="bg-tasks-chip-count">7</);
  assert.match(running, /is-running/);

  // A task that failed and was never read keeps its mark, in warning, until it is opened.
  const failed = renderButton({ unseenFailed: 2 });
  assert.match(failed, /has-failed/);
  assert.match(failed, /class="bg-tasks-chip-mark"/);
});

test("a chip with nothing to report says nothing: no entry in the index, no marks", () => {
  // The numbers come from the extensions' own frames, per conversation. A conversation the
  // extension is not answering for has no entry, so the chip shows the plain zero and no marks:
  // a badge the app cannot back up is a claim, and the app never makes one.
  const html = renderButton({ running: 0, unseenFailed: 0 });
  assert.ok(!html.includes("has-failed"));
  assert.ok(!html.includes("is-running"));
  assert.match(/aria-label="([^"]*)"/.exec(html)?.[1] ?? "", /^Background Tasks$/);
});

test("the open chip reads as the card it owns", () => {
  const html = renderButton({ tasksOpen: true, running: 1 });
  assert.match(html, /app-topbar-subagents bg-tasks-chip is-running is-open/);
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
    "backgroundTasks.stopAllConfirm", "backgroundTasks.logFollowing",
    "backgroundTasks.detail", "backgroundTasks.detailPick"]) {
    assert.ok(source.includes(`"${key}"`), `the card renders ${key}`);
  }
});

test("a task opens as its own page, with the back control in the card's upper-left corner", () => {
  const html = renderPanel();
  // The card carries its page, and the two pages are stacked in one box that clips.
  assert.match(html, /class="bg-tasks-panel app-menu"[^>]*data-page="list"/);
  assert.match(html, /class="bg-tasks-pages"[^>]*data-page="list"/);
  assert.match(html, /class="bg-tasks-page is-list"/);
  assert.match(html, /class="bg-tasks-page is-detail"[^>]*inert=""/);
  // The detail page's head is the Settings dialog's navigation on this card's surface: back to
  // the list in the upper-left corner, the task's name in the middle, the card's close at the
  // right end. A row that opened a block *below* the list pushed the list out of the card.
  assert.match(html, /class="bg-tasks-head bg-tasks-detail-bar"/);
  assert.match(html, /class="bg-tasks-back"/);
  assert.match(html, /class="bg-tasks-title bg-tasks-page-title"/);
  // The back control names where it goes, and shows it: a chevron and the card's own name, in
  // the upper-left corner, where the Settings dialog's back control is.
  assert.match(html, /class="bg-tasks-back"><svg[\s\S]*?<path d="m15 18-6-6 6-6"/);
  assert.match(html, /class="bg-tasks-back"[\s\S]*?<span>Background Tasks<\/span>/);
  // The panel shows one conversation's tasks, so a conversation label inside it is the row's
  // own name repeated: the session list and the "Started in" row are gone.
  assert.ok(!html.includes("bg-tasks-sessions"), "no conversation list in the card");
  assert.ok(!html.includes("bg-tasks-session"), "no conversation labels in the card");
  const source = readFileSync(new URL("./BackgroundTasksPanel.tsx", import.meta.url), "utf8");
  assert.ok(!source.includes("backgroundTasks.detail.startedIn"), "no 'Started in' row");
  assert.match(source, /listenForStackedDialogEscape/, "Escape goes back to the list first");
  assert.match(source, /inert=\{page !== "list"\}/, "the slid-out list is out of the tab order");
  const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8");
  assert.match(css, /\.bg-tasks-pages\[data-page="detail"\] \.bg-tasks-page\.is-list\s*\{\s*transform: translateX\(-100%\);/);
  assert.match(css, /\.bg-tasks-pages\[data-page="list"\] \.bg-tasks-page\.is-detail\s*\{\s*transform: translateX\(100%\);/);
  assert.match(css, /max-height: var\(--top-panel-max-height, 100%\);/, "the card is as tall as the Agents card's box, handed down by the shell");
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

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("a row opens the task's own page, with a back control in its upper-left corner", () => {
  const source = read("./BackgroundTasksPanel.tsx");
  // One track, two pages, slid sideways: the list keeps its place and the detail comes in from
  // the right. An inline detail under a row is what this replaced.
  assert.match(source, /className="bg-tasks-pages"/);
  assert.match(source, /className="bg-tasks-page is-list"/);
  assert.match(source, /className="bg-tasks-page is-detail"/);
  assert.match(source, /data-page=\{page\}/);
  // The row opens the page; the back control returns, and the hidden page is inert so its
  // controls are not in the tab order behind the visible one.
  assert.match(source, /onClick=\{\(\) => openTask\(id\)\}/);
  assert.match(source, /className="bg-tasks-back"/);
  assert.match(source, /inert=\{page !== "detail"\}/);
  // Escape goes back to the list before it closes the card, through the app's stacked rule.
  assert.match(source, /listenForStackedDialogEscape\(document, \(\) => setPage\("list"\)\)/);
  // The detail page's bar carries the task's actions; the bar's title is the section's word, so
  // a name the extension built from a long prompt is clipped in its own head, not in the bar.
  const detailBar = source.slice(source.indexOf('className="bg-tasks-head bg-tasks-detail-bar"'), source.indexOf('className="bg-tasks-head bg-tasks-detail-bar"') + 1800);
  assert.match(detailBar, /translate\("backgroundTasks\.detail"\)/);
  assert.ok(!detailBar.includes("backgroundTaskTitle"), "the bar does not print the task's long name");
  assert.match(detailBar, /translate\("backgroundTasks\.stop"\)/);
  assert.match(detailBar, /translate\("backgroundTasks\.rerun"\)/);
});

test("the card lists one conversation's tasks, and says nothing about the project's other conversations", () => {
  const source = read("./BackgroundTasksPanel.tsx");
  // The card is a monitor of this conversation's registry. A "Started in" footer, a session list
  // or a "this project" switcher would make it a project dashboard again.
  assert.ok(!source.includes("detail.startedIn"));
  assert.ok(!source.includes("bg-tasks-sessions"));
  assert.ok(!source.includes("otherSessions"));
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const catalog = read(`../lib/i18n/messages/${locale}.ts`);
    assert.ok(!catalog.includes('"backgroundTasks.detail.startedIn"'), `${locale} keeps the sibling-conversation label`);
    assert.ok(!catalog.includes('"backgroundTasks.otherSessions"'), `${locale} keeps the sibling-conversation count`);
  }
  // Stop-all names the conversation's running set, in every language.
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const catalog = read(`../lib/i18n/messages/${locale}.ts`);
    for (const key of ["stopAllConfirm", "stopAllHint", "detail", "detail.back", "stopRunning", "stopFailed", "rowRunning"]) {
      assert.ok(catalog.includes(`"backgroundTasks.${key}"`), `${locale} is missing backgroundTasks.${key}`);
    }
  }
});

test("the card is as tall as the Agents card's box, and the task title is one clipped line", () => {
  const css = read("../app/native-theme.css");
  const shell = read("./AppShell.tsx");
  // The shell hands the wrapper's limit down; the card fills that box, as the Agents card does.
  assert.match(shell, /"--top-panel-max-height"/);
  assert.match(css, /\.bg-tasks-panel \{[\s\S]{0,1200}?max-height: var\(--top-panel-max-height, 100%\);/);
  // No height of the card's own: a list capped at 60vh made a monitor of three rows a tooltip.
  assert.ok(!/\.bg-tasks-list \{[^}]*max-height: min\(60vh/.test(css), "the list carries its own cap again");
  // The name the extension built from a long prompt is one line, clipped with an ellipsis, in
  // the row and in the detail head alike.
  assert.match(css, /\.bg-tasks-row-title \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.bg-tasks-detail-title \{[^}]*text-overflow: ellipsis/);
});

test("the extension's running counts drive the composer's disc and the sidebar's row", () => {
  const shell = read("./AppShell.tsx");
  const chatInput = read("./ChatInput.tsx");
  const chatWindow = read("./ChatWindow.tsx");
  const sidebar = read("./SessionSidebar.tsx");
  const hook = read("../hooks/useBackgroundTasksRunning.ts");
  // The shell reads the app-wide index and hands the conversation's number to the composer, and
  // the whole map to the sidebar's rows through the context.
  assert.match(shell, /useBackgroundTasksRunning\(\)/);
  assert.match(shell, /backgroundTasksRunning=\{bgTasksRunning\.runningIn\(selectedSessionId\)\}/);
  assert.match(shell, /<BackgroundTasksRunningProvider running=\{bgTasksRunning\.runningBySession\}>/);
  // An idle session with running tasks is a stop, not a send arrow, and Escape stops the same
  // work the disc stops.
  assert.match(chatInput, /showStop = \(isStreaming \|\| Boolean\(subagentsRunning\) \|\| backgroundTasksRunning > 0\)/);
  assert.match(chatInput, /else if \(subagentsRunning\) onAbortSubagents\?\.\(\);\s*\n\s*else onAbortBackgroundTasks\?\.\(\);/);
  assert.match(chatWindow, /action: "stop-all", allRunning: true/);
  assert.match(chatWindow, /backgroundTasksRunning > 0 \? handleAbortBackgroundTasks : null/);
  // The row's mark asks for its own conversation only.
  assert.match(sidebar, /useBackgroundTasksRunningFor\(session\.id\)/);
  assert.match(sidebar, /className="session-item-bg-tasks"/);
  // The feed is one shared stream per browser plus a first paint, and it is closed on unmount.
  assert.match(hook, /openSharedEventStreamHandle/);
  assert.match(hook, /name: BACKGROUND_TASKS_RUNNING_STREAM_NAME/);
  assert.match(hook, /stream\.stop\(\)/);
});

test("a finished background task leaves no card in the chat", () => {
  const view = read("./MessageView.tsx");
  assert.match(view, /isBackgroundTaskNotification/);
  assert.match(view, /if \(isBackgroundTaskNotification\(\(message as CustomMessage\)\.customType\)\) return null;/);
});

test("Stop all is the head's icon in front of Refresh, and it asks in a strip under the head", () => {
  const source = read("./BackgroundTasksPanel.tsx");
  const css = read("../app/native-theme.css");
  // The head's action row is glyphs. A text button there was the widest control in a row of 13px
  // icons and it pushed Refresh off the card at a narrow width.
  const stopAll = source.indexOf('aria-label={translate("backgroundTasks.stopAll")}');
  const refresh = source.indexOf("<RefreshIcon />");
  assert.ok(stopAll > 0, "the head names its Stop all icon");
  assert.ok(stopAll < refresh, "Stop all sits before Refresh");
  assert.match(source, /className="bg-tasks-icon-button is-danger"/);
  // One task, one click; running tasks, a row of them, and a word first.
  assert.match(source, /page === "list" && runningIds\.length > 0/);
  // The ask carries the count and the alert role: what is about to be stopped is said, in words.
  assert.match(source, /className="bg-tasks-confirm" role="alert"/);
  assert.match(source, /translate\("backgroundTasks\.stopAllConfirm", \{ count: runningIds\.length \}\)/);
  assert.ok(!source.includes("bg-tasks-stop-all"), "no text Stop-all is left in the filters row");
  for (const selector of [".bg-tasks-icon-button.is-danger", ".bg-tasks-confirm-text", ".bg-tasks-confirm-actions"]) {
    assert.ok(css.includes(selector), `the card's sheet is missing ${selector}`);
  }
  assert.ok(!css.includes(".bg-tasks-stop-all"), "the sheet has no dead Stop-all text button");
});

test("the chip is a glyph and a number in every locale, and the word is gone from the catalog", () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const catalog = read(`../lib/i18n/messages/${locale}.ts`);
    assert.ok(!catalog.includes('"backgroundTasks.chipLabel"'), `${locale} has no chip word to wear`);
  }
  const css = read("../app/native-theme.css");
  assert.ok(!css.includes(".bg-tasks-chip-label"), "the sheet has no dead chip-word rule");
});

test("a failed task's row wears a warning triangle, and each page is the box that clips", () => {
  const source = read("./BackgroundTasksPanel.tsx");
  const css = read("../app/native-theme.css");
  // A bare exclamation at 11px is a line and a dot of unknown weight. This is the one mark in the
  // row that says "look at this one", and it is the same ⚠ the chip's mark and the header's row use.
  const failed = /if \(status === "failed"\) \{([\s\S]*?)\n  \}/.exec(source)?.[1] ?? "";
  assert.match(failed, /M10\.3 4\.1/, "the failed glyph is a triangle");
  assert.ok(!/bg-tasks-status[\s\S]{0,400}<path d="M12 7v6" \/>/.test(source), "no bare exclamation mark");
  // The pages are stacked in a box that clips, each page exactly the box. One wide track of two
  // pages translated by half its own width left the slid-out page's last pixels inside the card's
  // padding — a strip of the list beside the detail, with a row's Stop control in it — because
  // overflow clips at the padding box, not at the content box.
  const pages = /\.bg-tasks-pages \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(pages, /position: relative/);
  assert.match(pages, /overflow: hidden/);
  const page = /\.bg-tasks-page \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(page, /position: absolute/);
  assert.match(page, /inset: 0/);
  assert.match(page, /overflow: hidden/);
  assert.ok(!css.includes("bg-tasks-track"), "no wide track to leak from");
});

test("a finished background task is announced by the card, and the notice waits for the tasks", () => {
  const gate = read("../lib/background-tasks/completion-gate.ts");
  const rpc = read("../lib/rpc-manager.ts");
  const bridges = read("../lib/background-tasks/bridges.ts");
  const announcer = read("../lib/task-completion-server.ts");
  // A bridge leases at once: the extension publishes a change frame only while a lease is live, so
  // a lazily leased listener never hears anything and the header's chip sits at zero until the card
  // is opened. The subscribe response's counts are the chip's first paint.
  assert.match(bridges, /client\.onCounts\(\(facts\) => applyCounts\(facts\.counts, facts\.observedAt\)\)/);
  assert.match(bridges, /client\.onChanges\(\(frame\) =>/);
  // A run that ends while the conversation's tasks are running is kept, and said when the last one
  // settles: one notice, carrying the real end of the work.
  assert.match(bridges, /if \(counts\.running === 0\) \{[\s\S]*?announceDeferredRunEnd\(sessionId\)/);
  assert.match(bridges, /clearDeferredRunEnd\(sessionId\)/);
  // The turn the extension woke to hand in a result says nothing on any channel; a run the
  // conversation asked for is announced, always.
  assert.match(rpc, /this\.agentRunAnnouncesCompletion = !runWokeByBackgroundTask\(this\.sessionId, this\.localRunRequestedAt\)/);
  assert.match(rpc, /if \(!this\.agentRunAnnouncesCompletion\) \{/);
  assert.match(rpc, /if \(RUN_STARTING_COMMANDS\.has\(type\)\) this\.localRunRequestedAt = Date\.now\(\);/);
  assert.match(gate, /export const COMPLETION_WINDOW_MS/);
  // The announcer refuses a run whose conversation is still working, and gives one notice per
  // session per window: three tasks settling is one finished task to the user, not three rows in
  // Notification Center of the same sentence.
  assert.match(announcer, /if \(env\.backgroundTasksRunning\(sessionId\) > 0\) \{\s*\n\s*deferRunEnd\(request, env\);/);
  assert.match(announcer, /export const COMPLETION_NOTICE_COOLDOWN_MS/);
  assert.match(announcer, /export async function announceDeferredRunEnd/);
  assert.match(announcer, /outcome: \{ \.\.\.pending\.request\.outcome, endedAt: now \}/);
});
