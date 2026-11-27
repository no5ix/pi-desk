import { createRoot } from "react-dom/client";
import { useLayoutEffect, useRef, useState } from "react";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { TopbarBackgroundTasksButton } from "@/components/TopbarBackgroundTasksButton";
import { BackgroundTasksPanel } from "@/components/BackgroundTasksPanel";
import {
  AGENT_PANEL_EDGE_GUTTER,
  BACKGROUND_TASKS_PANEL_WIDTH,
  placeAgentsPanel,
} from "@/lib/top-panel-placement";

/**
 * The header's Background Tasks card, in a real browser.
 *
 * The card was an empty rounded rectangle: its two pages are stacked with `position: absolute`,
 * so the box that holds them has nothing of its own in flow, and the rule that handed the card
 * the shell's height box also took away its floor. A card with nothing in flow has no height,
 * and the menu's surface painted a strip 500px wide and nothing else. The chip, meanwhile,
 * filled itself with the accent wash while work ran, so it read as pressed — highlighted —
 * before it was ever clicked.
 *
 * e2e/background-tasks-card.mjs measures the real chip, the real card, the app's real CSS and
 * the shell's own placement. The task data is served by the harness's own HTTP server at
 * `/api/background-tasks*`, so the panel runs its real client: snapshot, detail, log window.
 */
const SESSION = new URLSearchParams(window.location.search).get("session") ?? "session-1";

function Workbench() {
  const { t } = useI18n();
  const topBarRef = useRef(null);
  const chipRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    const place = () => {
      const bar = topBarRef.current?.getBoundingClientRect();
      if (!bar) return;
      const isMobile = window.matchMedia("(max-width: 640px)").matches;
      setPos(placeAgentsPanel(bar, chipRef.current?.getBoundingClientRect() ?? null, isMobile, BACKGROUND_TASKS_PANEL_WIDTH));
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
          <div className="app-topbar-title" title="Fix the task card">
            <span>Fix the task card</span>
            <span className="app-topbar-subtitle-row">
              <TopbarBackgroundTasksButton
                ref={chipRef}
                running={2}
                unseenFailed={1}
                title={t("backgroundTasks.title")}
                tasksOpen={open}
                onToggle={() => setOpen((current) => !current)}
              />
            </span>
          </div>
        </div>
        <div style={{ flex: 1, padding: 16, fontSize: "var(--fs-body)" }}>
          The conversation lives here. The card opens over it, under the chip.
        </div>
      </div>
      {open && pos && (
        <div
          id="panel-layer"
          className="top-panel-card"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: pos.width,
            maxHeight: `calc(100dvh - ${pos.top}px - ${pos.floating ? `${AGENT_PANEL_EDGE_GUTTER}px` : "0px"})`,
            "--top-panel-max-height": `calc(100dvh - ${pos.top}px - ${pos.floating ? `${AGENT_PANEL_EDGE_GUTTER}px` : "0px"})`,
            overflowY: pos.floating ? "visible" : "auto",
            zIndex: 500,
          }}
        >
          <BackgroundTasksPanel
            sessionId={SESSION}
            open={open}
            onClose={() => setOpen(false)}
            translate={t}
          />
        </div>
      )}
    </>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<I18nProvider><Workbench /></I18nProvider>);
