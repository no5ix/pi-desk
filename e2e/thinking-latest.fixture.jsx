import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../hooks/useI18n";
import { MessageView } from "../components/MessageView";
import { ProcessDetailsContext } from "../components/process-details-context";

/**
 * The thinking cards of a conversation, in a real browser with the real component.
 *
 * The rule is about *position*: one thinking card is open, the newest one. A is open
 * while it streams and stays open when it ends with nothing after it; the moment B
 * starts, A closes and B opens. "Expand thinking blocks by default" reaches the reply
 * the user is reading, not every card in the file — that is what turned a long
 * conversation into a wall of open reasoning. e2e/thinking-latest.mjs drives the
 * states (the switch, the group, the handover, a manual click) and reads the DOM.
 */

const turn = (n, blocks) => ({
  role: "assistant",
  content: blocks,
  model: `fixture-model-${n}`,
  stopReason: "stop",
  timestamp: 1000 + n,
  usage: { input: 10, output: 20 },
});

const TURNS = [
  turn(0, [
    { type: "thinking", thinking: "Turn zero worked out the layout of the sidebar row." },
    { type: "text", text: "first reply" },
  ]),
  turn(1, [
    { type: "thinking", thinking: "Turn one reasoned about the branch menu's height." },
    { type: "text", text: "second reply" },
    { type: "thinking", thinking: "Turn one thought again about the loading rows." },
    { type: "text", text: "second reply, part two" },
  ]),
  turn(2, [
    { type: "thinking", thinking: "Turn two measured the header's widths in Chromium." },
    { type: "text", text: "third reply" },
  ]),
];

function Fixture({ newest, insideGroup }) {
  return (
    <div className="app-shell chat-container" style={{ height: "100dvh", overflow: "auto" }}>
      {TURNS.map((message, index) => (
        <section data-turn={index} key={index}>
          <ProcessDetailsContext.Provider value={insideGroup}>
            <MessageView
              message={message}
              entryId={`entry-${index}`}
              modelNames={{}}
              showTimestamp={false}
              expandLatestThinking={index === newest}
            />
          </ProcessDetailsContext.Provider>
        </section>
      ))}
    </div>
  );
}

const root = createRoot(document.getElementById("root"));
const params = new URLSearchParams(location.search);
const state = {
  newest: Number(params.get("newest") ?? 2),
  insideGroup: params.get("group") === "1",
};
const render = () => root.render(<I18nProvider><Fixture newest={state.newest} insideGroup={state.insideGroup} /></I18nProvider>);
window.__fixture = {
  render(next) {
    Object.assign(state, next);
    render();
  },
};
render();
