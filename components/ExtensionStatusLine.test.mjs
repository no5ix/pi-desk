import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ExtensionStatusList, visibleExtensionStatuses } = await jiti.import("./ExtensionStatusLine.tsx");

const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindowSource = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");

test("orders statuses by key and drops the ones with nothing to show", () => {
  assert.deepEqual(
    visibleExtensionStatuses([
      { key: "b", text: "tokens\n 12k" },
      { key: "a", text: "git main" },
      { key: "c", text: "\u001b[2m \u001b[0m" },
    ]).map((status) => status.text),
    ["git main", "tokens\n 12k"],
    "key order like Pi's footer; a status that is blank after stripping ANSI gets no row",
  );
});

test("renders one row per status, colored, with the plain text as tooltip", () => {
  const html = renderToStaticMarkup(React.createElement(ExtensionStatusList, {
    statuses: [
      { key: "lsp", text: "\u001b[32mLSP ready\u001b[0m" },
      { key: "blank", text: "   " },
    ],
  }));
  assert.match(html, /class="session-stats-status-list"/);
  assert.match(html, /class="session-stats-status-row"[^>]*title="LSP ready"/);
  assert.match(html, /<span style="color:rgb\(0,187,0\)">LSP ready<\/span>/, "the extension's own color survives");
  assert.ok(!html.includes("blank"), "a status with no visible text has no row");
});

test("renders nothing when every status is blank", () => {
  const html = renderToStaticMarkup(React.createElement(ExtensionStatusList, { statuses: [{ key: "a", text: "  " }] }));
  assert.equal(html, "");
});

test("ctx.ui.setStatus reaches the Session stats card, not the composer's shelf", () => {
  // The hook must apply setStatus requests and every get_state snapshot; the component
  // was once removed and the state left dangling, so statuses were silently dropped.
  assert.match(hookSource, /case "setStatus":\s*setExtensionStatuses\(/);
  assert.match(hookSource, /\.extensionStatuses !== undefined\) setExtensionStatuses\(/);
  // ChatWindow keeps no status strip of its own: it lifts the statuses to the header
  // and clears them as it unmounts, so a session switch never shows the old ones.
  assert.match(chatWindowSource, /onExtensionStatusesChange\?\.\(extensionStatuses\)/);
  assert.match(chatWindowSource, /onExtensionStatusesChange\?\.\(\[\]\)/);
  assert.doesNotMatch(chatWindowSource, /ExtensionStatusLine|hasExtensionStatus/);
  // The strip under the composer stays for the widgets that need a control there.
  assert.match(chatWindowSource, /className="extension-status-shelf has-widgets"/);
  // The header renders the statuses as a section of the Session stats card, and a card
  // with only statuses is still openable from the More menu.
  assert.match(appShellSource, /<ExtensionStatusList statuses=\{extensionStatuses\} \/>/);
  assert.match(appShellSource, /className="session-stats-extensions"/);
  assert.match(appShellSource, /const sessionPanelHasContent = Boolean\(sessionStats\) \|\| Boolean\(contextUsage\) \|\| extensionStatusLines\.length > 0;/);
  assert.match(appShellSource, /disabled=\{!sessionPanelHasContent\}/);
  // The rows are styled by the fork's stylesheet: the card's mono caption, and wrapping
  // so a multi-line status is not clipped the way the 17px strip clipped it.
  assert.match(cssSource, /\.session-stats-status-list \{[\s\S]*?font-family: var\(--font-mono\);/);
  assert.match(cssSource, /\.session-stats-status-list \.session-stats-status-row \{\s*min-width: 0;\s*white-space: pre-wrap;/);
});

test("follows a session an extension command moved to", async () => {
  const forkEventsSource = await readFile(new URL("../hooks/useForkAgentEvents.ts", import.meta.url), "utf8");
  assert.match(forkEventsSource, /case "session_replaced":[\s\S]*?onSessionForked\?\.\(event\.sessionId\)/);
});
