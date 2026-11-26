"use client";

// Fork-owned: the phone composer's `+` — the one control that carries everything that is
// not typing. Attach, the model, the reasoning level, the tool preset and the session's own
// switches used to sit in the card's row beside the text (and behind a second "More"
// button); the phone's row has room for the prompt, one control and Send, so they live here,
// and the row keeps one line while the prompt is one line.
//
// The panel is the composer's hub: its rows name the controls and carry the value each is
// at, and the lists (the model picker, the levels, the presets, the automation switches) are
// the same rows the desktop menus show — this component hosts them, it never redraws them
// (components/ModelSelector.tsx `ModelSelectorList`, components/ComposerReasoningRows.tsx,
// components/ComposerToolPresetRows.tsx, components/SessionAutomationMenu.tsx
// `SessionAutomationRows`).
//
// While the session is compacting, the `+` breathes (app/native-theme.css) and its first
// row stops the compaction: the run has to be reachable from the one control that is always
// in the row, because the row no longer carries the stop button.
//
// ChatInput (upstream-owned) keeps the open state and the ref — its one outside-click
// handler closes every composer menu — and mounts this.

import { useState, type ReactNode, type RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionAutomation, SessionAutomationChange } from "@/hooks/useSessionAutomation";
import {
  COMPOSER_PLUS_MENU_WIDTH,
  composerPanelAnchoring,
  getUpwardMenuMaxHeight,
  getVisibleTopBoundary,
} from "@/lib/composer-panel-placement";
import type { ThinkingLevelChoice } from "@/lib/composer-option-data";
import type { ToolPreset } from "@/lib/tool-presets";
import { ComposerReasoningRows } from "./ComposerReasoningRows";
import { ComposerToolPresetRows } from "./ComposerToolPresetRows";
import { ModelSelectorList, type ModelSelectorOption } from "./ModelSelector";
import { SessionAutomationRows } from "./SessionAutomationMenu";

/** The hub page, or the page a row opened. */
export type ComposerPlusPage = "root" | "model" | "reasoning" | "tools" | "session";

/** The floor a page is given on a viewport too short for its rows; the list scrolls below it. */
const PLUS_PAGE_MIN_HEIGHT = 160;

export interface ComposerPlusMenuProps {
  /** ChatInput's outside-click handler and keyboard navigation are keyed on this. */
  menuRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: (update: (open: boolean) => boolean) => void;
  /** Opens the composer's hidden file input. */
  onAttach: () => void;
  attachLabel: string;
  /** Attachments are already picked: the row says so. */
  attachActive?: boolean;
  isCompacting: boolean;
  summarizationRetry?: { attempt: number; maxAttempts: number } | null;
  onAbortCompaction?: () => void;
  /** A manual compaction can start now (idle, and the session can be compacted). */
  onCompact?: () => void;
  model?: ComposerPlusModel | null;
  reasoning?: ComposerPlusReasoning | null;
  tools?: ComposerPlusTools | null;
  session?: ComposerPlusSession | null;
}

interface ComposerPlusModel {
  options: ModelSelectorOption[];
  value?: { provider: string; modelId: string } | null;
  onPick: (provider: string, modelId: string) => void;
  /** The model's name, printed in the hub's row. */
  label: string;
  emptyLabel?: string;
  defaultValue?: { provider: string; modelId: string } | null;
  onSetDefault?: (provider: string, modelId: string) => void;
}

interface ComposerPlusReasoning {
  availableLevels?: readonly string[] | null;
  resolvedLevel: string | null;
  isAuto: boolean;
  levelMap?: Record<string, string | number | null> | null;
  onPick: (level: ThinkingLevelChoice) => void;
  /** The settings' default level; "auto" is never a default (it means "ask the
      model"), so the callback takes the levels that can be stored. */
  onSetDefault?: (level: Exclude<ThinkingLevelChoice, "auto">) => void;
  savedDefault?: string | null;
  label: string;
  /** Under the levels: the chat-only workspace's block, the same rows the desktop menu shows. */
  footer?: ReactNode;
}

interface ComposerPlusTools {
  current: ToolPreset;
  onPick: (preset: ToolPreset) => void;
  label: string;
}

interface ComposerPlusSession {
  automation?: SessionAutomation;
  onSetAutomation?: (change: SessionAutomationChange) => void;
}

const ICON = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function ComposerPlusMenu({
  menuRef, open, onOpenChange, onAttach, attachLabel, attachActive,
  isCompacting, summarizationRetry, onAbortCompaction, onCompact,
  model, reasoning, tools, session,
}: ComposerPlusMenuProps) {
  const { t } = useI18n();
  const [page, setPage] = useState<ComposerPlusPage>("root");
  const close = () => {
    onOpenChange(() => false);
    setPage("root");
  };
  const compactingTitle = t("chat.stopCompaction")
    + (summarizationRetry ? ` · ${t("chat.compactingRetry", { attempt: summarizationRetry.attempt, max: summarizationRetry.maxAttempts })}` : "");

  return (
    <div ref={menuRef} style={{ position: "relative", display: "flex" }}>
      <button
        type="button"
        className="native-toolbar-button composer-plus-button"
        data-compacting={isCompacting ? "true" : undefined}
        // The `+` is the row's only control besides Send, so it is the one that says a
        // compaction is running: the button breathes (app/native-theme.css) and its label
        // names the run for the accessibility tree.
        title={isCompacting ? compactingTitle : t("chat.composerPlus")}
        aria-label={isCompacting ? compactingTitle : t("chat.composerPlus")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setPage("root");
          onOpenChange((v) => !v);
        }}
      >
        <svg {...ICON} width={18} height={18} aria-hidden="true">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      {open && (() => {
        const anchor = menuRef.current;
        // The composer's vertical rule, the same one the project chip's list uses: a menu
        // that grows up is capped to the space above the chip, down to the chat column's
        // top and the app topbar's bottom. The page's own viewport is the short one on a
        // phone (`60vh` reads the tall layout viewport), so the measured cap is what keeps
        // the rows under the header.
        const cap = anchor
          ? Math.max(PLUS_PAGE_MIN_HEIGHT, getUpwardMenuMaxHeight(anchor.getBoundingClientRect().top, getVisibleTopBoundary(anchor)))
          : null;
        const anchoring = composerPanelAnchoring(anchor, COMPOSER_PLUS_MENU_WIDTH(window.innerWidth), { alignLeft: true });
        return (
          <div
            className="native-popover app-menu composer-plus-menu"
            style={{
              position: "absolute",
              bottom: "calc(100% + 6px)",
              ...(anchoring ? { left: anchoring.left, width: anchoring.width } : { left: 0 }),
              zIndex: 100,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              maxHeight: cap != null ? `min(60vh, 420px, ${cap}px)` : "min(60vh, 420px)",
            }}
          >
            {page === "root" ? (
              <div className="composer-plus-list" role="menu" aria-label={t("chat.composerPlus")}>
                {isCompacting && onAbortCompaction && (
                  <PlusRow
                    danger
                    icon={<svg {...ICON} width={14} height={14}><rect x="3" y="3" width="18" height="18" rx="2" /><rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="none" /></svg>}
                    label={t("chat.compacting")}
                    value={summarizationRetry ? `${summarizationRetry.attempt}/${summarizationRetry.maxAttempts}` : undefined}
                    onSelect={() => { onAbortCompaction(); close(); }}
                  />
                )}
                <PlusRow
                  active={attachActive}
                  icon={<svg {...ICON}><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a3 3 0 0 1 4.24 4.24l-9.2 9.19a1 1 0 0 1-1.41-1.41l8.49-8.49" /></svg>}
                  label={attachLabel}
                  onSelect={() => { onAttach(); close(); }}
                />
                {model && (
                  <PlusRow
                    icon={<svg {...ICON}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></svg>}
                    label={t("chat.composerPlusModel")}
                    value={model.label}
                    onSelect={() => setPage("model")}
                  />
                )}
                {reasoning && (
                  <PlusRow
                    icon={<svg {...ICON}><line x1="4" y1="7" x2="14" y2="7" /><line x1="18" y1="7" x2="20" y2="7" /><circle cx="16" cy="7" r="2" /><line x1="4" y1="17" x2="6" y2="17" /><line x1="10" y1="17" x2="20" y2="17" /><circle cx="8" cy="17" r="2" /></svg>}
                    label={t("chat.reasoningHeading")}
                    value={reasoning.label}
                    onSelect={() => setPage("reasoning")}
                  />
                )}
                {tools && (
                  <PlusRow
                    icon={<svg {...ICON}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>}
                    label={t("chat.toolsHeading")}
                    value={tools.label}
                    onSelect={() => setPage("tools")}
                  />
                )}
                {session && (session.automation || onCompact) && (
                  <PlusRow
                    icon={<svg {...ICON}><path d="M13 2 4.5 13.5H12L11 22l8.5-11.5H12L13 2Z" /></svg>}
                    label={t("chat.sessionAutomation")}
                    onSelect={() => setPage("session")}
                  />
                )}
              </div>
            ) : (
              <>
                <div className="composer-plus-page-head">
                  <button type="button" className="composer-menu-row composer-plus-back" onClick={() => setPage("root")}>
                    <svg {...ICON} width={14} height={14} aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
                    <span style={{ flex: 1 }}>
                      {page === "model" ? t("chat.composerPlusModel")
                        : page === "reasoning" ? t("chat.reasoningHeading")
                        : page === "tools" ? t("chat.toolsHeading")
                        : t("chat.sessionAutomation")}
                    </span>
                  </button>
                </div>
                <div className="composer-plus-list">
                  {page === "model" && model && (
                    <ModelSelectorList
                      options={model.options}
                      value={model.value}
                      onPick={(provider, modelId) => { model.onPick(provider, modelId); close(); }}
                      emptyLabel={model.emptyLabel}
                      defaultValue={model.defaultValue}
                      onSetDefault={model.onSetDefault}
                    />
                  )}
                  {page === "reasoning" && reasoning && (
                    <ComposerReasoningRows
                      availableLevels={reasoning.availableLevels}
                      resolvedLevel={reasoning.resolvedLevel}
                      isAuto={reasoning.isAuto}
                      levelMap={reasoning.levelMap}
                      savedDefault={reasoning.savedDefault}
                      onSetDefault={reasoning.onSetDefault}
                      onPick={(level) => { reasoning.onPick(level); setPage("root"); }}
                      footer={reasoning.footer}
                    />
                  )}
                  {page === "tools" && tools && (
                    <ComposerToolPresetRows
                      current={tools.current}
                      onPick={(preset) => { tools.onPick(preset); setPage("root"); }}
                    />
                  )}
                  {page === "session" && session && (
                    <SessionAutomationRows
                      automation={session.automation}
                      onSetAutomation={session.onSetAutomation}
                      onCompact={onCompact}
                      onClose={close}
                    />
                  )}
                </div>
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/** One hub row: the control's glyph, its name, the value it is at, and the page it opens. */
function PlusRow({
  icon,
  label,
  value,
  active,
  danger,
  onSelect,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  active?: boolean;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="composer-plus-row"
      data-active={active ? "true" : undefined}
      data-danger={danger ? "true" : undefined}
      title={value ? `${label}: ${value}` : label}
      onClick={onSelect}
    >
      <span className="composer-plus-row-icon" aria-hidden="true">{icon}</span>
      <span className="composer-plus-row-label">{label}</span>
      {value && <span className="composer-plus-row-value">{value}</span>}
    </button>
  );
}
