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

test("a live run puts the breathing head in the disc; a bare turn keeps the square", () => {
  // The header and the Agents panel said "a subagent is working" while the composer,
  // the one control the user reaches for, answered with the same square it shows for a
  // plain turn. The disc now wears the app's running head and breathes with the
  // header's bucket; the action, its name and the tooltip stay Stop.
  const runs = render({
    onSend() {},
    onAbort() {},
    onAbortSubagents() {},
    isStreaming: true,
    subagentsRunning: true,
  });
  assert.match(runs, /data-action="stop"/, "still the Stop control");
  assert.match(runs, /aria-label="Stop agent"/, "named the same to a screen reader");
  assert.match(runs, /<svg class="agent-status-icon--pulse" width="17" height="17" viewBox="0 0 24 24"[^>]*stroke-width="2.1"/,
    "the header's running head, at disc size and with a stroke that survives the filled button");
  assert.ok(!runs.includes('<rect x="3.5"'), "the square is gone while a run is live");

  const turn = render({ onSend() {}, onAbort() {}, isStreaming: true });
  assert.match(turn, /data-action="stop"/, "a turn is still stoppable");
  assert.match(turn, /<rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/,
    "with no run under it, the square stays");
  assert.ok(!turn.includes("agent-status-icon--pulse"), "and nothing breathes that is not running");
});

test("Stop stops the turn when there is one, and the runs when the session is idle", () => {
  // A running turn's Stop already cascades to the children it waits on
  // (lib/subagent-runtime.ts aborts the wait with the parent's signal); only an idle
  // session needs the per-run route the Agents panel uses.
  assert.match(chatInput, /const showStop = \(isStreaming \|\| Boolean\(subagentsRunning\) \|\| backgroundTasksRunning > 0\) && !canQueueStreamingMessage;/,
    "a draft in the card keeps the arrow (queue into a run, send into an idle session)");
  // The order is the meaning: a running turn owns the disc, its Stop cascades to the runs it
  // waits on; a session idle with subagent runs stops those; a session idle with background
  // shell tasks stops the tasks, which is the only work the composer can act on then.
  assert.match(chatInput, /if \(isStreaming\) onAbort\(\);[\s\S]*?else if \(subagentsRunning\) onAbortSubagents\?\.\(\);\n\s*else onAbortBackgroundTasks\?\.\(\);/);
  assert.match(chatInput, /onClick=\{showStop \? stopRuns :/, "the disc routes by state");
  assert.match(chatInput, /backgroundTasksRunning > 0 && !isStreaming && !subagentsRunning\s*\?\s*t\("backgroundTasks\.stopRunning"/,
    "the disc says what it is stopping");
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
