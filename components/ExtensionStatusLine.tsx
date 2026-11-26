"use client";

import { stripAnsi } from "@/lib/ansi";
import type { ExtensionStatusItem } from "@/lib/types";
import { AnsiText } from "./AnsiText";

/**
 * The `ctx.ui.setStatus` entries as the app shows them: ordered by key like
 * pi's TUI footer, and without the ones whose text is blank once the ANSI
 * codes are stripped (pi's footer prints nothing for those either).
 */
export function visibleExtensionStatuses(statuses: ExtensionStatusItem[]): ExtensionStatusItem[] {
  return [...statuses]
    .sort((a, b) => a.key.localeCompare(b.key))
    .filter(({ text }) => stripAnsi(text).trim().length > 0);
}

/**
 * One row per status in the Session stats card (components/AppShell.tsx). The
 * card is opened to read, so every status keeps a row of its own and wraps
 * inside it; the strip under the composer used to fold them into one 17px line
 * and clipped the rest.
 */
export function ExtensionStatusList({ statuses }: { statuses: ExtensionStatusItem[] }) {
  const visible = visibleExtensionStatuses(statuses);
  if (visible.length === 0) return null;
  return (
    <div className="session-stats-status-list">
      {visible.map(({ key, text }) => (
        <div key={key} className="session-stats-status-row" title={stripAnsi(text).trim()}>
          <AnsiText text={text} />
        </div>
      ))}
    </div>
  );
}
