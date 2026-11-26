/**
 * Cap on warm sessions nobody is using. Opening a session to read it starts a
 * wrapper that stays loaded for the idle timeout: on a real ~/.pi, opening one
 * 135 MB transcript held ~160 MB of heap for that long, and every further large
 * session browsed in that window added its own.
 *
 * Only wrappers that are not running, have no SSE listener and have been
 * unwatched for IDLE_SESSION_CAP_GRACE_MS count; the most recently left one is
 * always kept, so going back to the session just left is still instant.
 *
 * Only bytes are capped, never the number of sessions: small transcripts cost
 * little heap, and 0.8.1's count of 4 evicted ordinary 1-5 MB sessions while the
 * user switched among a handful, so every switch back cold-started a wrapper
 * (re-parsing the transcript and rebinding extensions). The idle timeout still
 * releases them all. That is why the byte budget is small and the count is
 * unlimited: bytes is the axis that measures a 5 MB session and a 135 MB one
 * alike.
 *
 * The budget is 64 MiB, not the 256 MiB it started at. A capped heap and a
 * measured 1.15-1.2x file-to-heap ratio (lib/session-slim-load.ts,
 * lib/session-reader.ts's cache comment) mean 64 MiB of session files is
 * roughly 80 MB of heap for the sessions a person is not looking at, and the
 * read-only view cache (lib/session-reader.ts) makes the reopen of a browsed
 * session a map hit, which is what makes releasing them cheap.
 */
/** Session-file bytes, a proxy for the heap a loaded transcript holds. */
export const IDLE_SESSION_CAP_MAX_BYTES = 64 * 1024 * 1024;
/** An EventSource reconnect or a session switch briefly leaves zero listeners. */
export const IDLE_SESSION_CAP_GRACE_MS = 15_000;
const MIN_CAP_BYTES = 4 * 1024 * 1024;
const MAX_CAP_BYTES = 4 * 1024 * 1024 * 1024;

/** PI_WEB_IDLE_CAP_BYTES: the byte budget, in MB. 0 leaves warm sessions uncapped. */
export function resolveIdleSessionCapBytes(
  rawValue: string | undefined = process.env.PI_WEB_IDLE_CAP_BYTES,
): number {
  const raw = (rawValue ?? "").trim();
  if (raw === "") return IDLE_SESSION_CAP_MAX_BYTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`[pi-web] invalid PI_WEB_IDLE_CAP_BYTES "${raw}", using ${IDLE_SESSION_CAP_MAX_BYTES / 1024 / 1024} MB`);
    return IDLE_SESSION_CAP_MAX_BYTES;
  }
  if (parsed === 0) return Number.MAX_SAFE_INTEGER;
  const bytes = Math.round(parsed * 1024 * 1024);
  return Math.min(MAX_CAP_BYTES, Math.max(MIN_CAP_BYTES, bytes));
}

/** PI_WEB_IDLE_CAP_GRACE_MS: how long a just-left session counts as just-left. */
export function resolveIdleSessionCapGraceMs(
  rawValue: string | undefined = process.env.PI_WEB_IDLE_CAP_GRACE_MS,
): number {
  const raw = (rawValue ?? "").trim();
  if (raw === "") return IDLE_SESSION_CAP_GRACE_MS;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  console.warn(`[pi-web] invalid PI_WEB_IDLE_CAP_GRACE_MS "${raw}", using ${IDLE_SESSION_CAP_GRACE_MS} ms`);
  return IDLE_SESSION_CAP_GRACE_MS;
}

export interface IdleSessionCandidate {
  id: string;
  /** When the session last had a listener or a command (ms epoch). */
  idleSince: number;
  bytes: number;
  /** True when no prompt ever ran through it: a session only read, not used. */
  viewer?: boolean;
}

export interface IdleSessionCapLimits {
  maxBytes?: number;
  /**
   * How long a session must have been unwatched to count. The pressure valve
   * passes 0: over budget, a session the page left five seconds ago is as warm
   * as one it left a minute ago.
   */
  graceMs?: number;
}

/**
 * Ids to shut down, oldest first. Walking from the most recently left session,
 * each one is kept if it still fits the byte budget; the newest is kept even
 * when it alone is over budget.
 */
export function selectIdleSessionsToEvict(
  candidates: readonly IdleSessionCandidate[],
  { maxBytes = IDLE_SESSION_CAP_MAX_BYTES }: IdleSessionCapLimits = {},
): string[] {
  const newestFirst = [...candidates].sort((a, b) => b.idleSince - a.idleSince);
  const evict: string[] = [];
  let keptAny = false;
  let keptBytes = 0;
  for (const candidate of newestFirst) {
    if (!keptAny || keptBytes + candidate.bytes <= maxBytes) {
      keptAny = true;
      keptBytes += candidate.bytes;
    } else {
      evict.push(candidate.id);
    }
  }
  return evict.reverse();
}
