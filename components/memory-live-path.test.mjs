import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Sentinels for the client half of the memory phases (5, 6, 7).
 *
 * These are the wiring facts the browser depends on and that no runtime unit
 * test can reach without a DOM: the reducer must keep `messages` and `entryIds`
 * parallel, must copy the wire's deferral marker onto the message a card reads,
 * and must clear per-connection delta state when a stream restarts. A merge
 * that drops one of these leaves a page that renders a *plausible* transcript —
 * a collapsed card that never loads, a tool card stuck on a stale frame — which
 * is exactly the class of regression a source sentinel is for.
 */

const reducer = readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const messageView = readFileSync(new URL("./MessageView.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const eventsRoute = readFileSync(new URL("../app/api/agent/[id]/events/route.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const stream = readFileSync(new URL("../lib/agent-event-stream.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");

function block(source, startMarker, label) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `${label}: marker ${JSON.stringify(startMarker)} is gone`);
  return source.slice(start);
}

// ── Phase 5: the live append path is the deferred projection, not the transcript

test("the page asks for the deferred live projection and for deltas", () => {
  assert.match(reducer, /new EventSource\([^]*events\?toolUpdates=delta/,
    "the EventSource must ask for delta tool updates; the server default stays the old contract");
  assert.match(reducer, /pendingEntryIdsRef/, "the live entry ids the stream names are queued here");
  assert.match(reducer, /event\.entryId/, "message_end carries the entry id the collapsed card fetches from");
  assert.match(reducer, /deferredContent/, "the wire says a message is a projection; the page must not overwrite it");
});

test("the wire's truncation marker reaches the message a card renders", () => {
  const end = block(reducer, 'case "message_end"', "message_end handler");
  assert.match(end, /payloadTruncated/,
    "a shortened value must not render as complete: the marker rides onto the message");
  assert.match(messageView, /PayloadCutNote/,
    "one component says what fell off, and both the tool card and the reply use it");
  assert.match(messageView, /<PayloadCutNote\s+marker=\{payloadCut\}/, "the tool card shows it");
  assert.match(messageView, /message\.payloadTruncated && \(\s*<PayloadCutNote/, "the reply shows it");
  assert.match(messageView, /contentUrl/,
    "the card offers the entry's full text, which the session file keeps");
});

test("messages and entryIds stay the same length, on every append", () => {
  // The pairing is the whole contract of the collapsed card: entryIds[i] is the
  // session entry of messages[i]. The effect that aligns them is the mechanism.
  assert.match(reducer, /setEntryIds/, "entryIds are state, aligned with messages by an effect");
  assert.match(reducer, /entryIdsRef/, "the alignment effect reads the current ids through a ref");
  const effect = block(reducer, "const deficit = messages.length - entryIds.length;", "entry id alignment");
  assert.match(effect, /setEntryIds/, "the queued ids are written into entryIds");
});

// ── Phase 6: collapsed content is given back, and the loaded window is a window

test("collapsing a card releases the heavyweight content it was showing", () => {
  assert.match(messageView, /shouldReleaseOnCollapse/,
    "the release rule is imported; a collapse of a big card drops its content");
  const thinking = block(messageView, "export function ThinkingBlock", "ThinkingBlock");
  assert.match(thinking, /shouldReleaseOnCollapse\(content\)/, "a collapsed thinking card drops the reasoning it fetched");
  assert.match(thinking, /setContent\(null\)/, "the fetched text goes back to the fetchable state, not a copy");
  const bash = block(messageView, "function BashExecutionView", "BashExecutionView");
  assert.match(bash, /shouldReleaseOnCollapse\(fullOutput\)/, "a collapsed bash card drops the full output it loaded");
  const card = block(messageView, "function ToolCallBlock", "ToolCallBlock");
  assert.match(card, /shouldReleaseOnCollapse\(cappedFull\)/, "a collapsed card drops a payload-capped text it loaded");
});

test("the thinking cache is bounded in bytes, not in entries alone", () => {
  assert.match(messageView, /RetainedTextCache/, "the shared byte-bounded cache is what the thinking card uses");
  assert.doesNotMatch(messageView, /const thinkingContentCache = new Map/,
    "a plain Map cache of thinking strings is the unbounded growth Phase 6 removes");
  assert.match(messageView, /announceContentPressure|registerContentCache|createContentCache/,
    "the cache is registered with the pressure system that tells the page what is retained");
});

test("the loaded window is bounded by the navigation cap, on both sides", () => {
  // ChatWindow: the rendered window follows the loaded count, so that growth is
  // the ratchet; it is clamped here.
  assert.match(chatWindow, /Math\.min\(MAX_NAVIGATED_LOADED_MESSAGES, Math\.max\(current, messages\.length\)\)/,
    "the rendered window must not follow the loaded count past the navigation bound");
  assert.match(chatWindow, /loadedWindow/, "the page hands the retention policy its live window size");
  const trim = block(reducer, "trimLoadedWindow(messages, entryIds", "loaded window trim effect");
  assert.match(trim, /setHistoryCursor\(trimmed\.oldestEntryId\)/,
    "the earlier-messages cursor follows the window, or paging re-requests the same page");
  assert.match(trim, /setHasEarlierMessages/, "the sentinel follows the server, not the cap");
});

// ── Phase 7: deltas are reconstructed, and a restart clears the baselines

test("delta frames are reconstructed, and a restart drops the baselines", () => {
  assert.match(reducer, /applyToolUpdateDelta/, "the page rebuilds a delta into the frame the card renders");
  const connected = block(reducer, 'case "connected"', "connected handler");
  assert.match(connected, /toolUpdateStatesRef\.current\.(clear|delete)\(|toolUpdateStatesRef\.current = new Map/,
    "a fresh stream has no baselines: a delta for a call the page never saw must not be spliced");
  const end = block(reducer, 'case "agent_end"', "agent_end handler");
  assert.match(end, /toolUpdateStatesRef\.current\.(clear|delete)\(|toolUpdateStatesRef\.current = new Map/,
    "the end of a run closes every tool call: their reconstructions are worthless from here");
});

test("the stream's switches are wired from the query string", () => {
  assert.match(eventsRoute, /toolUpdates/, "the route reads the delta switch");
  assert.match(eventsRoute, /deltaToolUpdates/, "and passes it to the stream");
  assert.match(eventsRoute, /liveDefer/, "and the deferral switch");
  // The budget is the server's to set: a browser cannot ask for a bigger frame.
  assert.doesNotMatch(eventsRoute, /maxEventPayloadBytes:\s*Number\(query/,
    "the payload budget must not come from the query string");
  assert.match(stream, /resolveMaxEventPayloadBytes\(process\.env\.PI_WEB_MAX_EVENT_PAYLOAD_BYTES\)/,
    "the stream resolves the per-event budget from the environment");
});
