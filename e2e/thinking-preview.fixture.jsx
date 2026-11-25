import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../hooks/useI18n";
import { MessageView } from "../components/MessageView";

/**
 * The collapsed thinking cards of a conversation, in a real browser with the real
 * component, at a phone's width.
 *
 * Two things are measured here and nowhere else. The card's glyph: a turn's finished
 * footer carries a clock, and the thinking row beneath it used to start 10px further
 * in, so the conversation's left edge was ragged. And the cut line: a collapsed
 * thinking that runs on ended in a single `…` drawn by `text-overflow`, which on a
 * mono line reads as the text's own punctuation; the app's own mark for "this goes
 * on" is the three dots, painted over the cut.
 *
 * e2e/thinking-preview.mjs reads the DOM. The long thinking is a paragraph of real
 * words so the line breaks the way a model's reasoning does, and the short one is the
 * case where the text ends before the box: the card must then show nothing at all.
 */

const LONG_THINKING = `The phone's composer is a column, and the row under it is a flex row: the attach button, the controls, the side-chat bubble, Send. The controls are the row's only filler, so a rule that hides them under the keyboard takes the filler away, and every control packs to the left. The measurement is the sentence: at 390px Send sat at x=130 of a card that ends at 366. The fix is not a second rule that pushes Send back to the corner — the corner is a consequence of the strip's presence, and the strip is where the model, the reasoning and the tools live. A phone's keyboard leaves the row room; the row keeps what it has, so nothing moves when the keyboard opens.`;

const SHORT_THINKING = "A short thought, ended before the box.";

const turn = (n, blocks) => ({
  role: "assistant",
  content: blocks,
  model: "fixture-model",
  stopReason: "stop",
  timestamp: 1000 + n,
  usage: { input: 10, output: 20 },
});

const TURNS = [
  turn(0, [{ type: "text", text: "the reply whose footer carries the clock" }]),
  turn(1, [{ type: "thinking", thinking: LONG_THINKING }, { type: "text", text: "the reply under a long thought" }]),
  turn(2, [{ type: "thinking", thinking: SHORT_THINKING }, { type: "text", text: "the reply under a short one" }]),
];

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <div className="app-shell chat-container" style={{ height: "100dvh", overflow: "auto" }}>
      <div className="chat-content" style={{ padding: "12px" }}>
        <div className="markdown-body">
          {TURNS.map((message, index) => (
            <section data-turn={index} key={index}>
              <MessageView
                message={message}
                entryId={`entry-${index}`}
                modelNames={{}}
                showTimestamp
                turnDurationMs={45000}
                expandLatestThinking={false}
              />
            </section>
          ))}
        </div>
      </div>
    </div>
  </I18nProvider>,
);
