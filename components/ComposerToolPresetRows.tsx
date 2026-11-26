"use client";

// Fork-owned: the composer's tool-preset rows (the set of tools one run may use).
// ChatInput's desktop menu and the phone's "+" menu (components/ComposerPlusMenu.tsx) both
// render this, so the presets, their names and their one-line descriptions exist once. The
// host owns the panel and what a pick does (the desktop closes its menu, the "+" menu goes
// back to its hub), and passes it as `onPick`.

import { useI18n } from "@/hooks/useI18n";
import { TOOL_PRESET_DESC_KEYS, TOOL_PRESET_MAP, TOOL_PRESETS } from "@/lib/composer-option-data";
import type { ToolPreset } from "@/lib/tool-presets";
import { SelectorRow } from "./SelectorRow";

export function ComposerToolPresetRows({
  current,
  onPick,
}: {
  /** The preset the session runs with; "configured" follows settings.json. */
  current: ToolPreset;
  onPick: (preset: ToolPreset) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {TOOL_PRESETS.map((lvl) => {
        const preset = TOOL_PRESET_MAP[lvl];
        const isActive = (current ?? "configured") === preset;
        const descSpec = TOOL_PRESET_DESC_KEYS[lvl];
        const desc = descSpec.count != null ? t(descSpec.key, { count: descSpec.count }) : t(descSpec.key);
        return (
          <SelectorRow
            key={lvl}
            active={isActive}
            onSelect={() => onPick(preset)}
          >
            <span className="app-menu-copy">
              <span>{t(`chat.toolPresetName.${lvl}`)}</span>
              <small>{desc}</small>
            </span>
          </SelectorRow>
        );
      })}
    </>
  );
}
