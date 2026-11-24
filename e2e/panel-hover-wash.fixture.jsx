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
    <div className="right-panel-container is-open" style={{ height: 220 }}>
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

/**
 * The image preview's close, over the preview's backdrop.
 *
 * Clicking an attached image opens it in a `<dialog>` over a `rgba(0, 0, 0, .72)`
 * backdrop, and upstream (app/globals.css, byte-identical) paints the close button's
 * hover plate with `var(--bg-hover)` — a 4–5% overlay. Over a dark backdrop the hovered
 * × is then a window: the user's photo shows through the control they are about to press.
 * The markup is components/ImagePreview.tsx's, and the stage stands in for the dialog's
 * `::backdrop` (which is not reachable from script) painted over a bright photo.
 */
function PhotoPreview() {
  return (
    <div
      className="photo-stage"
      style={{ position: "relative", height: "220px", background: "rgba(0, 0, 0, 0.72)" }}
    >
      <div className="photo-under" style={{ position: "absolute", inset: 0, background: "#d8d8d8" }} />
      {/* The real dialog is `position: fixed; inset: 0; width: 100vw; height: 100dvh`. In
          the fixture it is the stage, so the close lands over the photo. */}
        <div className="image-preview-dialog" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", padding: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="image-preview-image" src="" alt="" style={{ width: 120, height: 120, background: "#cfcfcf" }} />
        <button type="button" className="image-preview-close" aria-label="Close">
          ×
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <div style={{ display: "grid", gap: 16, padding: 8, paddingTop: 244 }}>
    {/* The panel surface is `position: fixed` in the shell, so the page gets a top
        offset: the two surfaces must not share the pointer, or the earlier hover is
        intercepted by the dialog. */}
    {/* The photo first, so the pointer reaches the dialog's close: the panel is the
        surface the earlier check measures and it fills the page below. */}
    <PhotoPreview />
    <Panel />
  </div>,
);
