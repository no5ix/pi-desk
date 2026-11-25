type Translate = (key: string, params?: Record<string, string | number>) => string;

interface Props {
  loading: boolean;
  prompt: string | null;
  translate: Translate;
}

export function SystemPromptPanel({ loading, prompt, translate }: Props) {
  // The head says what the card is and what it is waiting for, so an empty card has a
  // sentence and not a bare italic line. The body keeps the same words: a screen reader
  // reads the panel, and the caption is the menu row's affordance.
  const hint = prompt === null
    ? (loading ? translate("system.loading") : translate("system.load"))
    : prompt === ""
      ? translate("system.empty")
      : translate("appshell.viewInstructions");
  return (
    <section className="system-prompt-panel app-menu" aria-label={translate("system.prompt")}>
      <div className="system-prompt-head">
        <strong className="system-prompt-title">{translate("system.prompt")}</strong>
        <span className="system-prompt-hint">{hint}</span>
      </div>
      <div className="system-prompt-scroll app-menu-list">
        {prompt ? (
          <div className="system-prompt-text">{prompt}</div>
        ) : (
          <div className="system-prompt-empty">
            {prompt === ""
              ? translate("system.empty")
              : loading
                ? translate("system.loading")
                : translate("system.load")}
          </div>
        )}
      </div>

      {/* The card's surface, its head and its paddings are the app's menu tokens in
          app/native-theme.css: this panel is one `.app-menu` card, so the only rules kept
          here are the prompt's own typography and the height it reads at. */}
      <style>{`
        .system-prompt-panel {
          display: flex;
          height: min(600px, 75dvh);
          min-height: 220px;
          flex-direction: column;
        }
        .system-prompt-scroll {
          min-height: 0;
          flex: 1;
          overflow: auto;
        }
        .system-prompt-text {
          color: var(--text-muted);
          font-family: var(--font-mono);
          font-size: 12px;
          line-height: 1.6;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        }
        .system-prompt-empty {
          padding: 10px 0;
          color: var(--text-muted);
          font-size: 12px;
          font-style: italic;
        }
      `}</style>
    </section>
  );
}
