import { createRoot } from "react-dom/client";
import { I18nProvider } from "../hooks/useI18n";
import { MessageView } from "../components/MessageView";
import { MarkdownBody } from "../components/MarkdownBody";

/**
 * The conversation's reading blocks, in a real browser with the real components.
 *
 * A compaction's summary and a subagent's report are bodies of prose the user reads,
 * so they wear the final report's type — the app's UI face, its character spacing, its
 * leading — at the thinking card's size. Upstream laid a report out in a 13px terminal
 * face on 1.32 leading (pi's TUI aligns an extension's text in columns) and left a
 * compaction at the 14px reply body, so both cards read as text the conversation is
 * not made of.
 *
 * Four sections, one per thing the eye compares:
 *
 *   · `report`     — the final report: `.markdown-body` prose, the reference;
 *   · `thinking`   — a thinking card, open: the small size the two bodies take;
 *   · `compaction` — a compaction note, opened by its header;
 *   · `subagent`   — a finished subagent's report, opened by its header.
 *
 * e2e/chat-body-type.mjs measures the computed type of each and the old-build control.
 */

const SUMMARY = [
  "## Goal",
  "",
  "- Move the fork glyph into the sidebar's row and keep the chip on the final report only.",
  "- Read the `ProcessDetailsContext` in every step, so nothing else grows a button.",
  "",
  "## Progress",
  "",
  "1. `components/MessageView.tsx` gates the chip.",
  "2. `e2e/subagent-run-glyph.mjs` pins the new glyph.",
  "",
  "```ts",
  "const canBranchInNewChat = !isStreaming && !entryId && !insideProcessDetails;",
  "```",
].join("\n");

const REPORT = [
  "Both steps completed. No files were modified.",
  "",
  "Task ID: `integration-suite-20261125T150526Z` · exit= `0`",
  "",
  "- Failing tests: none.",
  "- `npm run lint` passed.",
  "",
  "```text",
  "i tests 77",
  "i pass 77",
  "i fail 0",
  "```",
].join("\n");

const turn = {
  role: "assistant",
  content: [
    { type: "thinking", thinking: "Measured the report's leading in Chromium before touching the type." },
    { type: "text", text: "The final report: the map of the run, in the reply's prose, read at 14px on 1.7 leading." },
  ],
  model: "fixture-model",
  stopReason: "stop",
  timestamp: 1000,
  usage: { input: 10, output: 20 },
};

const compaction = {
  role: "custom",
  customType: "compaction",
  timestamp: 1100,
  content: [{ type: "text", text: SUMMARY }],
};

const subagent = {
  role: "custom",
  customType: "pi-web:subagent-notification",
  timestamp: 1200,
  content: [{ type: "text", text: REPORT }],
};

function Fixture() {
  return (
    <div className="app-shell chat-container" style={{ maxWidth: 860, margin: "0 auto" }}>
      <section data-case="report">
        <MarkdownBody>The final report: the map of the run, in the reply&apos;s prose, read at 14px on 1.7 leading, with `inline code` in the sentence.</MarkdownBody>
      </section>
      <section data-case="thinking">
        <MessageView message={turn} entryId="entry-0" showTimestamp={false} expandLatestThinking />
      </section>
      <section data-case="compaction">
        <MessageView message={compaction} entryId="entry-1" showTimestamp={false} />
      </section>
      <section data-case="subagent">
        <MessageView message={subagent} entryId="entry-2" showTimestamp={false} />
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <Fixture />
  </I18nProvider>,
);
