"use client";

import { useEffect, useState } from "react";

/**
 * Milliseconds since `since`, re-read every second — the header's clock.
 *
 * `null` while there is no timestamp, which is also the first (hydration)
 * render of anything that shows a live duration: the server has no session, and
 * a client render that already had a number would not match the HTML. The
 * interval belongs to the leaf that prints the label and never to a page owner
 * like AppShell: a per-second tick must not re-render the shell, its sidebar
 * and the chat column with it.
 */
export function useElapsedSince(since: number | null): number | null {
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    if (since === null) {
      setElapsed(null);
      return;
    }
    const tick = () => setElapsed(Math.max(0, Date.now() - since));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [since]);
  return elapsed;
}
