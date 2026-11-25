import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

// A background subagent keeps working after the main turn ends. The header counted it
// (`[robot] ↻1`) and the Agents panel had a Stop, while the composer answered an empty
// card with a send arrow: the one control the user needed was ten pixels away in a panel.
// The disc covers the family's live runs — the arrow returns the moment the card holds a
// draft, because a prompt is then the thing the composer is for.
const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { ChatInput } = await jiti.import("./ChatInput.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const chatInput = await read("./ChatInput.tsx");
const chatWindow = await read("./ChatWindow.tsx");
const appShell = await read("./AppShell.tsx");

const render = (props) => renderToStaticMarkup(
  React.createElement(I18nProvider, null, React.createElement(ChatInput, props)),
);

test("a live subagent run turns the composer's disc into Stop", () => {
  const html = render({
    onSend() {},
    onAbort() {},
    onAbortSubagents() {},
    isStreaming: false,
    subagentsRunning: true,
  });
  assert.match(html, /data-action="stop"/, "the disc is Stop, not the send arrow");
  assert.match(html, /aria-label="Stop agent"/, "and it says so to a screen reader");
  assert.ok(!/data-action="send"/.test(html), "no send affordance beside a run");
});

test("an idle composer with no live run keeps the send arrow", () => {
  const html = render({ onSend() {}, onAbort() {}, isStreaming: false });
  assert.match(html, /data-action="send"/);
  assert.match(html, /aria-label="Send"/);
});

test("Stop stops the turn when there is one, and the runs when the session is idle", () => {
  // A running turn's Stop already cascades to the children it waits on
  // (lib/subagent-runtime.ts aborts the wait with the parent's signal); only an idle
  // session needs the per-run route the Agents panel uses.
  assert.match(chatInput, /const showStop = \(isStreaming \|\| Boolean\(subagentsRunning\)\) && !canQueueStreamingMessage;/,
    "a draft in the card keeps the arrow (queue into a run, send into an idle session)");
  assert.match(chatInput, /if \(isStreaming\) onAbort\(\);\n\s*else onAbortSubagents\?\.\(\);/);
  assert.match(chatInput, /onClick=\{showStop \? stopRuns :/, "the disc routes by state");
});

test("the shell hands the family's live runs to the main composer, and Stop uses the panel's route", () => {
  assert.match(appShell, /runningSubagentIds=\{runningSubagentIds\}/, "the main chat is the one composer that gets them");
  assert.match(appShell, /if \(relation\?\.kind !== "subagent"\) continue;/,
    "a side chat is a conversation the user drives, never a run to stop");
  assert.match(appShell, /runningSessionIds\.has\(member\.id\) \|\| relation\.status === "running" \|\| relation\.status === "queued"/,
    "the live set answers first; the file's status covers a run the stream has not reported");
  assert.match(chatWindow, /subagentsRunning=\{subagentsRunning\}\n\s*onAbortSubagents=\{handleAbortSubagents\}/);
  assert.match(chatWindow, /fetch\(`\/api\/subagents\/\$\{encodeURIComponent\(id\)\}`/,
    "the same endpoint the Agents panel's Stop calls");
  assert.match(chatWindow, /body: JSON\.stringify\(\{ action: "abort" \}\)/);
});

test("the failure is said, not swallowed", async () => {
  const stop = chatWindow.slice(chatWindow.indexOf("const handleAbortSubagents = useCallback"));
  const body = stop.slice(0, stop.indexOf("}, [addNotice, t]);"));
  assert.equal(body.split('t("chat.stopSubagentsFailed")').length - 1, 2, "an HTTP refusal and a dead fetch both notify");
  const plugins = await read("../lib/i18n/locale-plugins.ts");
  assert.equal(plugins.split('"chat.stopSubagentsFailed"').length - 1, 3, "the key carries all three locales");
});
