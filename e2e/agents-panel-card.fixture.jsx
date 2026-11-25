import { createRoot } from "react-dom/client";
import { useLayoutEffect, useRef, useState } from "react";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { TopbarProjectChip } from "@/components/TopbarProjectChip";
import { TopbarBranchChip } from "@/components/TopbarBranchChip";
import { TopbarSubagents } from "@/components/TopbarSubagents";
import { AgentSessionPanel } from "@/components/AgentSessionPanel";
import { AGENT_PANEL_EDGE_GUTTER, placeAgentsPanel } from "@/lib/top-panel-placement";

/**
 * The Agents panel as a card, in a real browser.
 *
 * The user asked for two things: the surface the app's other popups wear (a rounded
 * rectangle in the menu's shadow, not a grey sheet with right angles), and a place that
 * belongs to the control that opens it — under the header's subagent count on a desktop
 * and a pad, centred under the header on a phone. e2e/agents-panel-card.mjs measures
 * both with the app's real CSS, the real chip, the real panel and the real placement
 * function, and puts the old rules back to prove the measurement sees them.
 */
const ROOT = {
  id: "root-000000000000",
  name: "Fix the Agents panel card",
  firstMessage: "Start ONE background subagent and report",
  modified: new Date(Date.now() - 60_000).toISOString(),
};
const SUBAGENTS = [
  {
    id: "sub-111111111111",
    name: "",
    firstMessage: "Read repo files in batches, report",
    modified: new Date(Date.now() - 41 * 60_000).toISOString(),
    relation: { kind: "subagent", profile: "explore", description: "Read repo files in batches, report", status: "aborted", parentSessionId: ROOT.id },
  },
  {
    id: "sub-222222222222",
    name: "",
    firstMessage: "Check the header's project row",
    modified: new Date(Date.now() - 9 * 60_000).toISOString(),
    relation: { kind: "subagent", profile: "explore", description: "Check the header's project row", status: "running", parentSessionId: ROOT.id },
  },
];
const RUNNING = new Set(["sub-222222222222"]);

function Workbench() {
  const { t } = useI18n();
  const topBarRef = useRef(null);
  const chipRef = useRef(null);
  const [open, setOpen] = useState(true);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const place = () => {
      const bar = topBarRef.current?.getBoundingClientRect();
      if (!bar) return;
      const isMobile = window.matchMedia("(max-width: 640px)").matches;
      setPos(placeAgentsPanel(bar, chipRef.current?.getBoundingClientRect() ?? null, isMobile));
    };
    place();
    const onResize = () => place();
    window.addEventListener("resize", onResize);
    const observer = new ResizeObserver(place);
    if (topBarRef.current) observer.observe(topBarRef.current);
    return () => {
      window.removeEventListener("resize", onResize);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      <div className="app-main-column" style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <div
          ref={topBarRef}
          className="app-topbar"
          style={{ display: "flex", alignItems: "center", flexShrink: 0, gap: 2, height: "auto", minHeight: 36 }}
        >
          <div className="app-topbar-title" title="Fix the Agents panel card">
            <span>Fix the Agents panel card</span>
            <span className="app-topbar-subtitle-row">
              <TopbarProjectChip name="pi-desk" path="/Users/lynx/Documents/github/pi-desk" />
              <TopbarBranchChip branch="feat/branch-picker-header-worktrees" projectRoot="/Users/lynx/Documents/github/pi-desk" isWorktree={false} />
              <TopbarSubagents
                subagents={{ total: 2, completed: 0, aborted: 1, running: 1 }}
                sideChats={{ total: 0, completed: 0, aborted: 0, running: 0 }}
                onOpenAgents={() => setOpen((current) => !current)}
                translate={t}
                anchorRef={chipRef}
              />
            </span>
          </div>
          <button type="button" className="native-icon-button" style={{ marginLeft: "auto" }} aria-label="More">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.65" /><circle cx="12" cy="12" r="1.65" /><circle cx="19" cy="12" r="1.65" />
            </svg>
          </button>
        </div>
        <div style={{ flex: 1, padding: 16, fontSize: "var(--fs-body)" }}>
          The conversation lives here. The card opens over it, under the count.
        </div>
      </div>
      {open && pos && (
        <div
          id="panel-layer"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: `calc(100dvh - ${pos.top}px - ${pos.floating ? `${AGENT_PANEL_EDGE_GUTTER}px` : "0px"})`,
            overflowY: pos.floating ? "visible" : "auto",
            zIndex: 500,
          }}
        >
          <AgentSessionPanel
            rootSession={ROOT}
            subagents={SUBAGENTS}
            selectedSessionId={ROOT.id}
            runningSessionIds={RUNNING}
            onSelectSession={() => {}}
            // The props the app really passes (AppShell): the main row carries the side-chat
            // "+", a running row carries steer and Stop. The row geometry the measurement is
            // about is the buttons' as much as the labels': in the old one-track layout the
            // buttons pushed a row's state left of a row without them, which is the scattering
            // the last pass has to see. A fixture without them measures three labels and sees
            // the states line up for the wrong reason — and equal-width labels (every state now
            // leads with a glyph) make that blind probe pass.
            openSideTabIds={new Set()}
            onToggleSideTab={() => {}}
            onNewSideChat={async () => null}
            onDeleteSideChat={async () => null}
          />
        </div>
      )}
    </>
  );
}

function Harness() {
  // The i18n provider is loaded by the app's layout; the fixture asks for the same default.
  return (
    <I18nProvider>
      <Workbench />
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
