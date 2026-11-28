import { createRoot } from "react-dom/client";
import { useState } from "react";

/**
 * The phone's panel and its expand button, mounted for measurement.
 *
 * On a phone the right panel is an overlay card, and upstream hides the panel's
 * expand button there (the card already spans the width). This fork keeps the
 * button, because the Git view — a branch tree, a commit list, a diff — is the
 * view that cannot live in a short card, and "expand" on a phone means the whole
 * viewport: unexpanded the card leaves the chat's topbar above it, expanded it is
 * the screen.
 *
 * The AppShell unit test pins the shell's own rule (the class the button sets and
 * the words on it). This mounts the panel's real header row and the app's real
 * stylesheets at a phone width, and measures the boxes: the button in the header
 * row's right end, the press changing the card into the viewport, and the second
 * press giving the card back. The run also wires the button to nothing — what the
 * shell did while the full-width class was desktop-only — and expects the card to
 * be unchanged, so the check can see that a press has to do something.
 */
const unfixed = new URLSearchParams(window.location.search).get("unfixed") === "1";

const EXPAND_LABEL = "Expand to the whole screen";
const SHRINK_LABEL = "Shrink back to a card";

function PhonePanel() {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);
  // The shell's rule: on a phone, expanded is the viewport, and the same class
  // carries it. `unfixed` reproduces the desktop-only gate that kept the class off
  // the phone, where pressing the button changed nothing.
  const viewportFull = !unfixed && open && expanded;

  return (
    <>
      <div
        className="app-topbar"
        data-role="chat-topbar"
        style={{ position: "fixed", top: 0, left: 0, right: 0, height: 52, zIndex: 1, background: "var(--bg-panel)", borderBottom: "var(--hairline) solid var(--border)" }}
      />
      <div
        id="file-panel"
        className={`right-panel-container${open ? " right-panel-open" : " right-panel-closed"}${viewportFull ? " right-panel-full-width" : ""}`}
      >
        <div className="right-panel-tab-strip">
          <div className="file-tab-bar-slot">
            <div className="file-tab file-tab--git" role="tab" aria-selected="true" data-tab-id="git:panel">
              <span className="file-tab-label">Git</span>
            </div>
          </div>
          <button
            type="button"
            className="file-workbench-icon-button file-tree-toggle is-active"
            aria-label="File tree"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" fill="none" stroke="currentColor" strokeWidth="1.75" /></svg>
          </button>
          <button
            type="button"
            className="file-panel-expand-button"
            onClick={() => (unfixed ? undefined : setExpanded((value) => !value))}
            aria-controls="file-panel"
            aria-pressed={viewportFull}
            title={viewportFull ? SHRINK_LABEL : EXPAND_LABEL}
            aria-label={viewportFull ? SHRINK_LABEL : EXPAND_LABEL}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={viewportFull ? "M4 9V4h5M20 15v5h-5M4 15v5h5M20 9V4h-5" : "M15 4h5v5M9 20H4v-5M20 15v5h-5M4 9V4h5"} />
            </svg>
          </button>
        </div>
        <div className="git-panel" data-role="git-view">
          <div className="git-branch-list">
            <div className="git-branch-row"><span className="git-branch-name">feat/branchshift-integration-editor</span></div>
          </div>
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(<PhonePanel />);
