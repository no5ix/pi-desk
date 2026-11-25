import { createRoot } from "react-dom/client";
import { ChatInput } from "../components/ChatInput";
import { I18nProvider } from "../hooks/useI18n";

/**
 * The composer's disc and the sidebar's fold head while a subagent run is live.
 *
 * `ChatInput` is the real component over the app's real CSS, in the three states the
 * disc knows:
 *
 *   · `runs`   — streaming with a live run under it: the breathing head,
 *   · `turn`   — streaming with no run: the plain square,
 *   · `idle`   — nothing running: the send arrow.
 *
 * The sidebar's fold toggle cannot be mounted on its own (the component needs the whole
 * session list), so the `row` case reproduces the DOM contract `SessionItem` draws —
 * `.session-item-children-toggle.is-running` with the head on
 * `.session-item-children-glyph.agent-status-icon--pulse`, at the row's 11px. The class
 * names are pinned in the source by `components/SessionSidebar.project-row.test.mjs`;
 * what this measures is that the shared rule animates at row size, in the row's pill.
 *
 * A `control` glyph carries no state class: a measurement that reports an animation for
 * it is blind. The `old` case draws the square the disc used to show for a live run, and
 * the head check is expected to reject it.
 */
function Composer({ caseName, isStreaming, subagentsRunning }) {
  return (
    <div data-case={caseName}>
      <ChatInput
        onSend={() => {}}
        onAbort={() => {}}
        onAbortSubagents={() => {}}
        isStreaming={isStreaming}
        subagentsRunning={subagentsRunning}
        thinkingLevel="medium"
        onThinkingLevelChange={() => {}}
        toolPreset="configured"
        onToolPresetChange={() => {}}
        model={{ provider: "fixture", modelId: "fixture-model" }}
        modelList={[{ id: "fixture-model", name: "Fixture model", provider: "fixture" }]}
      />
    </div>
  );
}

function Fixture() {
  return (
    <I18nProvider>
      <main style={{ maxWidth: 860, margin: "0 auto", paddingTop: 40 }}>
        <Composer caseName="runs" isStreaming subagentsRunning />
        <Composer caseName="turn" isStreaming />
        <Composer caseName="idle" />
        <div className="app-sidebar" data-case="row">
          <button type="button" className="session-item-children-toggle is-running" aria-label="Expand 1 subagents · 1 running">
            <svg className="session-item-children-glyph agent-status-icon--pulse" aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="7" width="14" height="11" rx="2" />
              <path d="M9 11h.01M15 11h.01M12 7V4" />
            </svg>
            <span className="session-item-children-count">1</span>
          </button>
        </div>
        <svg data-case="control" width="11" height="11" viewBox="0 0 24 24" />
        {/* The markup the disc showed before: a square where a live run belongs. */}
        <div data-case="old" style={{ width: 32, height: 32, background: "var(--accent)" }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" /></svg>
        </div>
      </main>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")).render(<Fixture />);
