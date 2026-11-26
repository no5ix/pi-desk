"use client";

// The conversation's "Branch in new chat" control, one per TURN, drawn in the two places
// a turn can end:
//
//   · in the report's footer, beside Copy (`components/MessageView.tsx`), and
//   · in a row of its own under the turn's Process details card, when the turn has no
//     report — an aborted tool call, an interrupted reply, an `Error:` line. All of that
//     turn's rows are folded inside the card, so nothing below it carries a footer
//     (`components/ChatWindow.tsx`).
//
// One component because both are the same action at the same size: pi's `fork_branch` at
// the reply's entry, so the new session carries the conversation *through* that answer and
// the running session keeps going. The glyph is the sidebar's fork mark
// (`.session-item-fork-glyph`) at the chip's stroke, because the chip creates exactly the
// row that mark labels in the tree.
//
// The plate, the ink and the reveal are CSS (`.message-branch-action`,
// `app/native-theme.css`); nothing here is styling.

import { useI18n } from "@/hooks/useI18n";

export function MessageBranchAction({
  forking,
  onBranch,
}: {
  /** This row's fork is in flight: the chip reads "Creating…" and cannot be pressed again. */
  forking?: boolean;
  onBranch: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onBranch}
      disabled={forking}
      title={forking ? t("i18n.creatingSession") : t("i18n.branchInNewChatTitle")}
      className="message-assistant-action message-branch-action"
      aria-live="polite"
    >
      {/* A fork: two heads above, one trunk below — the reply splits into a session of
          its own. Thinner stroke than the sidebar row's: at 12px on a filled chip the 2px
          glyph reads heavy next to Copy's 1.75. */}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="12" cy="18" r="2.5" />
        <path d="M6 8.5V10a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8.5M12 13v2.5" />
      </svg>
      {/* The label is a span so a phone under 380px can drop it and keep the glyph
          (globals.css `message-action-label`); the title carries the words. */}
      <span className="message-action-label">{forking ? t("i18n.creating") : t("i18n.branchInNewChat")}</span>
    </button>
  );
}
