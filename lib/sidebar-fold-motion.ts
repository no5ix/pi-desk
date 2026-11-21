"use client";

import { useEffect, useRef, useState } from "react";

/** The CSS fold transition's length; keep it in step with `--dur-base` in app/native-theme.css. */
export const SIDEBAR_FOLD_MS = 180;

/**
 * The sidebar folds animate in both directions, and a closing fold needs its content
 * mounted to animate out.
 *
 * Keeping it mounted permanently is not an option here: the sidebar's keyboard row walk
 * (`focusSidebarTreeRow` in components/SessionSidebar.tsx), the project row counts, and
 * the flat list's virtualization all treat a folded project as having no rows, and the
 * Chats fold is conditionally rendered by contract (components/SessionSidebar.test.mjs
 * pins it). So the module keeps a root mounted for exactly one animation length after it
 * collapses, and no longer: the row walk never reaches an invisible row, and the DOM
 * settles to the folded state.
 *
 * Call it once with the whole collapsed set — the sidebar renders projects in a loop, so
 * a per-project hook would change the hook count.
 */
export function useCollapseExit(collapsed: Set<string>, durationMs = SIDEBAR_FOLD_MS + 20): Set<string> {
  const previous = useRef(collapsed);
  const [exiting, setExiting] = useState<Set<string>>(() => new Set());
  const mounted = useRef(true);

  useEffect(() => {
    const before = previous.current;
    previous.current = collapsed;
    const closing = [...collapsed].filter((root) => !before.has(root));
    if (closing.length === 0) return;
    setExiting((prev) => {
      const next = new Set(prev);
      for (const root of closing) next.add(root);
      return next;
    });
    const timer = setTimeout(() => {
      if (!mounted.current) return;
      setExiting((prev) => {
        const next = new Set(prev);
        for (const root of closing) next.delete(root);
        return next;
      });
    }, durationMs);
    return () => clearTimeout(timer);
  }, [collapsed, durationMs]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return exiting;
}
