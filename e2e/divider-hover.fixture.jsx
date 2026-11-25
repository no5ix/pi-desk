import { createRoot } from "react-dom/client";
import { useRef } from "react";
import { useResizablePanel } from "@/hooks/useResizablePanel";

/**
 * The shell's panel dividers, in a real browser, so hovering them can be measured.
 *
 * The user's complaint: sliding the pointer over the line between a sidebar and the
 * conversation made that line light up. The line is the panels' own hairline — the
 * resize handle only widens the hit target — so the tint upstream paints on
 * `:hover` reads as a stray highlight on a separator that was already there.
 *
 * The markup is the shell's (AppShell renders `.panel-resize-handle` with the
 * `sidebar-` / `right-panel-` / `file-tree-` modifier, `role="separator"` and
 * `tabIndex` from the resizer's `separatorProps`) so the cascade that decides the
 * colour — upstream's tint in `app/globals.css`, the fork's overrides in
 * `app/native-theme.css`, and the right panel's `!important` pair above 960px —
 * is the real one. The panel surfaces themselves are omitted: nothing in those
 * rules keys off an ancestor, and a fixed-position panel would intercept the
 * pointer from the handle in front of it.
 */
function Divider({ id, extra = "" }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${id}`}
      aria-valuenow={300}
      aria-valuemin={200}
      aria-valuemax={800}
      tabIndex={0}
      className={`panel-resize-handle ${id}-resize-handle${extra}`}
      data-resize-handle={id}
    />
  );
}

function Shell() {
  return (
    <div className="app-shell" style={{ display: "flex", height: 320, background: "var(--bg)" }}>
      <div className="sidebar-container sidebar-open" style={{ width: 220, borderRight: "1px solid var(--border)" }}>
        <div id="session-sidebar" className="session-sidebar">Sessions</div>
      </div>
      <Divider id="sidebar" />
      <div className="app-main-column" style={{ flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="app-topbar">Fix missed divider</div>
        <div style={{ flex: 1 }}>The conversation</div>
      </div>
      <Divider id="right-panel" />
      {/* A 12px lead-in: in the shell both the panel's own divider and the file tree's
          sit at the panel's left edge, so their 12px hit bands would share the same
          pixel and the pointer could only ever reach the one on top (z-index 220). The
          measurement needs each handle to receive its own hover. */}
      <div style={{ width: 260, display: "flex", paddingLeft: 12, borderLeft: "1px solid var(--separator)" }}>
        <Divider id="file-tree" />
        <div className="file-tree-panel">Files</div>
      </div>
    </div>
  );
}

/**
 * The real resizer hook on a divider, so a pointer drag is the shell's own pipeline.
 *
 * `useResizablePanel` owns `is-resizing`, the pointer capture, and — until this fix —
 * the `target.focus()` a drag performed. Chromium grants `:focus-visible` to a
 * programmatically focused `div[role=separator][tabindex=0]`, so a drag left the
 * separator focused and the divider stayed lit after the pointer was released: the
 * pointer's own gesture highlighted the line. That hook is what has to get this right,
 * so it is mounted here and dragged with a real mouse.
 */
function LiveDivider() {
  const widthRef = useRef(260);
  const resizer = useResizablePanel({
    ariaLabel: "sidebar",
    cssVariable: "--e2e-divider-width",
    defaultWidth: 260,
    getMaxWidth: () => 900,
    growthDirection: "right",
    maxWidth: 900,
    minWidth: 160,
    storageKey: "pi-e2e-divider-sidebar-width",
    widthRef,
  });
  return (
    <div style={{ display: "flex", height: 240, border: "1px solid var(--border)" }}>
      <div
        ref={resizer.panelRef}
        data-e2e="live-sidebar-panel"
        className="sidebar-container sidebar-open"
        style={{ width: "var(--e2e-divider-width, 260px)", borderRight: "1px solid var(--border)" }}
      >
        Sessions
      </div>
      <div
        {...resizer.separatorProps}
        className={`panel-resize-handle sidebar-resize-handle${resizer.isResizing ? " is-resizing" : ""}`}
        data-resize-handle="live-sidebar"
        style={{ height: 240 }}
      />
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>The conversation, resized by the real hook</div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <div style={{ display: "grid", gap: 16, padding: 8, paddingTop: 200 }}>
    {/* A top offset: the shell is a plain row here, and the pointer must land on the
        12px-wide handle, not on anything painted over it. */}
    <Shell />
    <LiveDivider />
  </div>,
);
