import { createRoot } from "react-dom/client";

/**
 * The right panel's header, in a real browser, so its close button can be measured.
 *
 * The user's complaint: hovering the × made it look slightly transparent. The rule that
 * caused it composited the palette's `--bg-hover` with the panel's colour — and
 * `--bg-hover` is a 4–5% overlay (it has to be, for the desktop's vibrancy window), so
 * the mix came out about half transparent and the content behind showed through the
 * hovered control. The fix lays the tint over an opaque base.
 *
 * The markup is the shell's (AppShell's panel header: `.right-panel-tab-strip` with the
 * actions at its end) so the cascade that decides the colour is the real one.
 */
function Panel() {
  return (
    <div className="right-panel-container is-open" style={{ height: "100vh" }}>
      <div className="right-panel-tab-strip">
        <div className="right-panel-tabs">
          <div className="right-panel-tab is-active">
            <span>notes.md</span>
          </div>
        </div>
        <div className="right-panel-tab-strip-actions">
          <button type="button" className="file-workbench-icon-button right-panel-close-button" aria-label="Close panel">
            ×
          </button>
        </div>
      </div>
      <div className="right-panel-content">
        <p>The × at the top right is the control the pointer aims at.</p>
        {/* The control pass: the recipe that read as transparent, measured side by side
            with the one in the stylesheet. If this probe is not translucent, the test
            below is blind rather than green. */}
        <span
          className="old-wash-probe"
          style={{ background: "color-mix(in srgb, var(--bg-hover), var(--bg-panel))" }}
        >
          old wash
        </span>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Panel />);
