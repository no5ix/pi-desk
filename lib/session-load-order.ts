/**
 * Newest-result-wins tickets for reads of one session.
 *
 * A session is read from several places at once: opening it (a forced read), the
 * reconcile/hydration paths, the SSE settle handler. Two reads for the same session can
 * overlap, and the responses can land in the opposite order — the older read is the one
 * that describes an older transcript. Without a rule, the read that resolves last wins,
 * and a stale window (a turn whose final reply is missing) then lands on screen and is
 * re-cached as the session's view.
 *
 * So every read takes a ticket, and a read may apply what it fetched only while its
 * ticket is the newest one taken. `lib/session-view-cache.ts` documents the cache this
 * protects; the pagination path already solved the same problem with a request id
 * (`contextLoadIdRef` in hooks/useAgentSession.ts).
 */

export interface LoadSequence {
  /** Claim the newest position. Every read takes one, forced reads included. */
  take(): number;
  /** True while `ticket` is still the newest claim — the only read allowed to apply. */
  isLatest(ticket: number): boolean;
  /** The newest claim, for tests and callers that want to invalidate in-flight reads. */
  current(): number;
}

export function createLoadSequence(): LoadSequence {
  let latest = 0;
  return {
    take() {
      latest += 1;
      return latest;
    },
    isLatest(ticket: number) {
      return ticket === latest;
    },
    current() {
      return latest;
    },
  };
}
