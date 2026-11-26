// Fork-owned: the two run-setting lists the composer offers — the reasoning level and the
// tool preset. ChatInput's desktop menus and the phone's "+" menu (the composer's one
// control that collects everything) read these, so a level, a preset, its name and its
// description exist once. `components/ComposerReasoningRows.tsx` and
// `components/ComposerToolPresetRows.tsx` draw the rows.

import type { ToolPreset } from "@/lib/tool-presets";

/** "configured" sends no override, so the session follows settings.json defaultTools. */
export const TOOL_PRESETS = ["configured", "chat-only", "read-only", "default", "full"] as const;
export type ToolPresetLabel = typeof TOOL_PRESETS[number];
export const TOOL_PRESET_MAP: Record<ToolPresetLabel, ToolPreset> = {
  configured: "configured",
  "chat-only": "none",
  "read-only": "read-only",
  default: "default",
  full: "full",
};

/**
 * What each preset is, in one line under its name. The two lists say how many tools the
 * preset leaves in reach, so their counts ride in the translation call.
 */
export const TOOL_PRESET_DESC_KEYS: Record<ToolPresetLabel, { key: string; count?: number }> = {
  configured: { key: "chat.configuredTools" },
  "chat-only": { key: "chat.chatOnly" },
  "read-only": { key: "chat.readOnlyTools", count: 4 },
  default: { key: "chat.builtInTools", count: 4 },
  full: { key: "chat.allBuiltInTools" },
};

export const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ThinkingLevelChoice = typeof THINKING_LEVELS[number];
export const THINKING_LEVEL_DESC_KEYS: Record<ThinkingLevelChoice, string> = {
  auto: "chat.thinkingUseDefault", off: "chat.thinkingOff", minimal: "chat.thinkingMinimal", low: "chat.thinkingLow",
  medium: "chat.thinkingMedium", high: "chat.thinkingHigh", xhigh: "chat.thinkingXhigh", max: "chat.thinkingMax",
};

/**
 * The levels to offer. A model that lists levels offers `auto` plus every one of them the
 * composer knows; a session that lists none (null/undefined) offers them all.
 */
export function visibleThinkingLevels(available: readonly string[] | null | undefined): ThinkingLevelChoice[] {
  if (!available) return [...THINKING_LEVELS];
  return THINKING_LEVELS.filter((level) => level === "auto" || available.includes(level));
}
