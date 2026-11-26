"use client";

// Fork-owned: the composer's reasoning-level rows. ChatInput's desktop menu and the phone's
// "+" menu (components/ComposerPlusMenu.tsx) both render this, so the levels, the model's
// own names for them and the one-line description exist once. The host owns the panel, the
// placement and what a pick does (the desktop closes its menu, the "+" menu goes back to its
// hub), and passes it as `onPick`.

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  THINKING_LEVEL_DESC_KEYS,
  visibleThinkingLevels,
  type ThinkingLevelChoice,
} from "@/lib/composer-option-data";
import { SelectorRow } from "./SelectorRow";

export function ComposerReasoningRows({
  availableLevels,
  resolvedLevel,
  isAuto,
  levelMap,
  onPick,
  onSetDefault,
  savedDefault,
  footer,
}: {
  /** The levels the current model lists; null/undefined offers all of them. */
  availableLevels?: readonly string[] | null;
  /** The level the session runs at, as the model names it; null while none is resolved. */
  resolvedLevel: string | null;
  /** The session follows the model's (or the settings') own level. */
  isAuto: boolean;
  /** The model's own names for the levels, when it renames them. */
  levelMap?: Record<string, string | number | null> | null;
  onPick: (level: ThinkingLevelChoice) => void;
  /** The settings' default level; "auto" is never a default (it means "ask the
      model"), so the callback takes the levels that can be stored. */
  onSetDefault?: (level: Exclude<ThinkingLevelChoice, "auto">) => void;
  savedDefault?: string | null;
  /** What the host adds under the levels — the chat-only workspace's own block. */
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <>
      <div className="composer-menu-heading">{t("chat.reasoningHeading")}</div>
      {visibleThinkingLevels(availableLevels).map((lvl) => {
        const isActive = lvl === "auto" ? isAuto : !isAuto && resolvedLevel === lvl;
        const desc = t(THINKING_LEVEL_DESC_KEYS[lvl]);
        const mappedVal = (lvl !== "auto" && levelMap) ? levelMap[lvl] : undefined;
        const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl;
        const showOriginal = mappedVal != null && mappedVal !== lvl;
        return (
          <SelectorRow
            key={lvl}
            active={isActive}
            onSelect={() => onPick(lvl)}
            gutter={Boolean(onSetDefault)}
            star={onSetDefault && lvl !== "auto"
              ? {
                  isDefault: savedDefault === lvl,
                  saveLabel: t("chat.saveDefaultThinking"),
                  defaultLabel: t("chat.defaultThinking"),
                  onSave: () => onSetDefault(lvl),
                }
              : undefined}
          >
            <span style={{ flex: 1 }}>
              {displayLabel}
              {showOriginal && <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({lvl})</span>}
            </span>
            <span style={{ fontSize: "var(--fs-micro)", color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
          </SelectorRow>
        );
      })}
      {footer}
    </>
  );
}
