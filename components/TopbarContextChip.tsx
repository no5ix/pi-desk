"use client";

import type { CSSProperties } from "react";
import { contextPercent, contextUsageSummary, formatTokenWindow } from "@/lib/context-usage-summary";
import { useI18n } from "@/hooks/useI18n";
import type { ContextUsage, SessionStatsInfo } from "@/lib/pi-types";
import { TopbarTip, TopbarTipRow, useTopbarTip } from "./TopbarTip";

const RING_SIZE = 13;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
/** High-risk red threshold (fixed, Claude-convention). Single accent below it. */
const CTX_DANGER_PCT = 90;

interface TopbarContextChipProps {
  contextUsage?: ContextUsage | null;
  sessionStats?: SessionStatsInfo | null;
}

/**
 * The conversation header's context chip, last in the row.
 *
 * It used to be a ring at the end of the composer's control row, with a native tooltip.
 * A native tooltip does not open on a phone or on Safari, and the composer's row is a
 * strip of controls: fullness of the context window belongs with the state of the
 * conversation — the project, the branch, the runs, the clock — so it joined the header,
 * where the app's own tip opens on hover, focus **or a tap** and the sentence
 * (`37.6% ctx · 161.8M tok`) is read complete instead of cut.
 *
 * The arc is the value: a ring filled to the percent, gray at rest and accent under the
 * pointer, red at the high-risk threshold (red always, pointer or not).
 * With nothing to report — a session that has never run — the chip renders nothing, so
 * an empty ring never reads as a spinner.
 *
 * The tip is the numbers and nothing else. The full session-stats panel is a command
 * (`/stats` in the composer, `onSessionStatsPanelOpen` in hooks/useAgentSession.ts),
 * not a row inside a hover tip — a tip is a readout, and a control inside it turns a
 * label into a target the pointer has to aim at.
 */
export function TopbarContextChip({ contextUsage, sessionStats }: TopbarContextChipProps) {
  const { t } = useI18n();
  const { tipId, pop, pos, tipRef, triggerProps } = useTopbarTip<HTMLButtonElement>();
  const summary = contextUsageSummary(contextUsage, sessionStats);
  if (!contextUsage || summary === null) return null;
  const percent = contextUsage.percent;
  const pct = contextPercent(percent);
  // The ring is gray at rest and lights up under the pointer (app/native-theme.css owns
  // `--ctx-ring`: rest `--text-dim`, hover / focus / open tip `--accent`). The arc's fill
  // is the value, so the row's end is not a permanent accent dot. One state is painted
  // here and is never gated on the pointer: the high-risk red at the threshold — a
  // warning that needs a hover is a warning nobody sees.
  const danger = pct >= CTX_DANGER_PCT;
  const ringStyle = danger ? ({ "--ctx-ring": "var(--danger)" } as CSSProperties) : undefined;
  const filled = RING_CIRCUMFERENCE * (pct / 100);
  const inWindow = contextUsage.tokens;
  return (
    <small className="app-topbar-context">
      <button
        {...triggerProps}
        className="app-topbar-context-hit"
        style={ringStyle}
        aria-label={t("chat.contextTipTitle", { summary })}
      >
        <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
          <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" stroke="var(--border)" strokeWidth={RING_STROKE} />
          <circle
            cx={RING_SIZE / 2}
            cy={RING_SIZE / 2}
            r={RING_RADIUS}
            fill="none"
            stroke="var(--ctx-ring)"
            strokeWidth={RING_STROKE}
            strokeDasharray={`${filled} ${RING_CIRCUMFERENCE - filled}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
            opacity={percent === null ? 0.35 : 1}
          />
        </svg>
      </button>
      {pop.mounted ? (
        <TopbarTip tipId={tipId} pos={pos} tipRef={tipRef} closing={pop.closing}>
          <TopbarTipRow label={t("chat.ctxUsage")} value={summary} />
          {inWindow !== null && inWindow !== undefined && contextUsage.contextWindow > 0 ? (
            <TopbarTipRow
              label={t("chat.contextTipWindowLabel")}
              value={`${formatTokenWindow(inWindow)} / ${formatTokenWindow(contextUsage.contextWindow)}`}
            />
          ) : null}
        </TopbarTip>
      ) : null}
    </small>
  );
}
