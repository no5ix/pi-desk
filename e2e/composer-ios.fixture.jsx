import { createRoot } from "react-dom/client";

/**
 * The composer's card and its one row, in a form WebKit (the phone's Safari engine) can lay
 * out, so the row can be measured at 390px with the keyboard open.
 *
 * The structure and the inline styles mirror components/ChatInput.tsx: the card is one row
 * (`data-inline`, `flexDirection: "row"`, `alignItems: "flex-end"`), the `+` is the row's
 * first control, the text area is `flex: "1 1 auto"` with no width of its own, and
 * `.chat-composer-actions` (folded into the same row by `display: contents`) carries the
 * session controls, the side-chat button and Send. The classes are the real ones, so the
 * cascade that decides the geometry is the shipped one. e2e/composer-ios.mjs asserts this
 * mirror against ChatInput's source: a fixture that drifts from the composer it models is a
 * fixture that measures nothing.
 */
function Composer() {
  return (
    <div className="chat-composer" style={{ "--chat-content-font-size": "14px" }}>
      <div
        className="chat-composer-editor"
        data-inline="true"
        style={{ display: "flex", flexDirection: "row", gap: 0, alignItems: "flex-end", position: "relative" }}
      >
        <button type="button" className="native-toolbar-button composer-attach-button" aria-label="Attach files">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <textarea
          className="chat-input-textarea"
          rows={1}
          placeholder="Message Pi…"
          style={{ flex: "1 1 auto", minWidth: 0, background: "none", border: "none", outline: "none", resize: "none" }}
        />
        <span className="composer-trigger-hint">/ commands · @ files · # sessions</span>
        <div className="chat-composer-actions">
          <div className="chat-composer-controls" style={{ flex: "0 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" aria-label="Reasoning: high" aria-haspopup="listbox" style={{ width: "var(--composer-send-size)", height: "var(--composer-send-size)", padding: 0 }} />
            <button type="button" aria-label="Change tool preset: default" aria-haspopup="listbox" style={{ width: "var(--composer-send-size)", height: "var(--composer-send-size)", padding: 0 }} />
          </div>
          <button type="button" className="composer-side-chat-button" aria-label="Side chat" />
          <button type="button" className="native-primary-button composer-send-button" data-action="send" aria-label="Send" />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Composer />);
