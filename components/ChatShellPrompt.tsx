"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * Shown above the composer when the chat withheld something the model needs. One click lets this
 * chat use the computer and asks the model to carry on.
 *
 * Two ways to need it, one card: the model asked for a shell and the chat refused the call (no
 * `toolName`), or the model was asked for a tool an installed extension provides — the task
 * manager's `bg_run` — that a locked chat does not declare, so the model can only say that it is
 * not in its function list (`toolName` names what is missing, in the model's own words).
 */
export function ChatShellPrompt({
  busy,
  error,
  onAllow,
  toolName = null,
}: {
  busy: boolean;
  error: string | null;
  onAllow: () => void;
  /** The tool the latest reply asked for, when the chat withheld it from the model. */
  toolName?: string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="chat-shell-prompt-wrap">
      <div className="chat-shell-prompt" role="status">
        <span className="chat-shell-prompt-text">
          {toolName
            ? t("chat.chatShellPromptToolText", { tool: toolName })
            : t("chat.chatShellPromptText")}
        </span>
        <button type="button" className="chat-shell-prompt-button" onClick={onAllow} disabled={busy} aria-busy={busy || undefined}>
          {t("chat.chatShellPromptAllow")}
        </button>
      </div>
      {error && <div role="alert" className="chat-shell-prompt-error">{error}</div>}
    </div>
  );
}
