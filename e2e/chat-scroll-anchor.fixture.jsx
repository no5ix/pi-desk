/**
 * Fixture for e2e/chat-scroll-anchor.mjs.
 *
 * It mirrors the pieces of components/ChatWindow.tsx that own the scroll
 * position: a scroller with `overflow-anchor: none`, a sentinel at the top that
 * loads an older page, rows carrying `data-entry-id`, the anchor capture taken
 * before the fetch, the re-attach in a layout effect, the ResizeObserver that
 * absorbs content growing above the anchor, and the user's own scroll cancelling
 * it. The maths is the app's — the fixture imports the helpers from
 * @/lib/chat-lazy-load, so a change to them moves the measurement.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CHAT_SCROLL_ANCHOR_WINDOW_MS,
  pickScrollAnchor,
  scrollTopForAnchor,
} from "@/lib/chat-lazy-load";

const PAGE = 12;
/** Deterministic pseudo-heights so the page's size is not a round number. */
function rowHeight(index) {
  return 90 + ((index * 37) % 190);
}

function Row({ index }) {
  // `?grow=1` makes every loaded row grow a moment after it lands, the way a
  // reply does when the highlight queue hands it to Prism, or an image reports
  // its intrinsic size.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    if (!GROW) return undefined;
    const timer = window.setTimeout(() => setGrown(true), GROW_DELAY);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      data-entry-id={`e${index}`}
      data-row-height={rowHeight(index)}
      style={{
        height: rowHeight(index) + (grown ? 220 : 0),
        padding: 12,
        borderBottom: "1px solid #ddd",
        background: index % 2 ? "#fafafa" : "#fff",
      }}
    >
      message {index}
    </div>
  );
}

const PARAMS = typeof window !== "undefined" ? new URL(window.location.href).searchParams : new URLSearchParams();
const GROW = PARAMS.get("grow") === "1";
const BROKEN = PARAMS.get("broken") === "1";
/**
 * When the content above the anchor grows, and for how long the anchor keeps
 * re-attaching. The defaults are the app's; `?growDelay=900&windowMs=600` is the
 * control pass: a window shorter than the growth leaves the reader 220px away.
 */
const GROW_DELAY = Number(PARAMS.get("growDelay")) || 180;
const ANCHOR_WINDOW = Number(PARAMS.get("windowMs")) || CHAT_SCROLL_ANCHOR_WINDOW_MS;

export function Fixture() {
  const [oldest, setOldest] = useState(200);
  const [rows, setRows] = useState(() => Array.from({ length: PAGE }, (_, i) => 200 + i));
  const scrollerRef = useRef(null);
  const contentRef = useRef(null);
  const sentinelRef = useRef(null);
  const loadingRef = useRef(false);
  const anchorRef = useRef(null);

  const captureAnchor = useCallback((container) => {
    const box = container.getBoundingClientRect();
    const measured = [...container.querySelectorAll("[data-entry-id]")].map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        entryId: el.getAttribute("data-entry-id"),
        top: rect.top - box.top,
        bottom: rect.bottom - box.top,
      };
    });
    const picked = pickScrollAnchor(measured, container.clientHeight);
    anchorRef.current = picked ? { ...picked, until: Date.now() + ANCHOR_WINDOW } : null;
  }, []);

  const applyAnchor = useCallback((container) => {
    const anchor = anchorRef.current;
    if (!anchor || BROKEN) return false;
    if (Date.now() > anchor.until) {
      anchorRef.current = null;
      return false;
    }
    const row = container.querySelector(`[data-entry-id="${anchor.entryId}"]`);
    if (!row) return false;
    const now = row.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const next = scrollTopForAnchor(
      container.scrollTop,
      now,
      anchor.top,
      container.scrollHeight,
      container.clientHeight,
    );
    if (Math.abs(next - container.scrollTop) > 0.5) container.scrollTop = next;
    return true;
  }, []);

  const loadOlder = useCallback(() => {
    if (loadingRef.current) return;
    const container = scrollerRef.current;
    if (!container) return;
    loadingRef.current = true;
    captureAnchor(container);
    // The page arrives a moment later, like a fetch.
    window.setTimeout(() => {
      const from = Math.max(0, oldest - PAGE);
      setRows((current) => [...Array.from({ length: oldest - from }, (_, i) => from + i), ...current]);
      setOldest(from);
      loadingRef.current = false;
    }, 120);
  }, [captureAnchor, oldest]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollerRef.current;
    if (!sentinel || !container) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadOlder();
      },
      { root: container, threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadOlder]);

  useLayoutEffect(() => {
    const container = scrollerRef.current;
    if (!container) return;
    applyAnchor(container);
  }, [rows, applyAnchor]);

  useEffect(() => {
    const container = scrollerRef.current;
    const content = contentRef.current;
    if (!container || !content || !anchorRef.current) return undefined;
    const observer = new ResizeObserver(() => applyAnchor(container));
    observer.observe(content);
    const timer = window.setTimeout(() => {
      anchorRef.current = null;
      observer.disconnect();
    }, ANCHOR_WINDOW);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [rows, applyAnchor]);

  return (
    <div
      ref={scrollerRef}
      className="chat-scroll-container"
      onWheel={() => { anchorRef.current = null; }}
      style={{
        height: 480,
        overflowY: "scroll",
        overflowX: "hidden",
        overflowAnchor: "none",
        border: "1px solid #ccc",
        paddingTop: 16,
      }}
    >
      <div ref={contentRef}>
        <div ref={sentinelRef} style={{ height: 24, color: "#888" }}>
          older…
        </div>
        {rows.map((index) => (
          <Row key={index} index={index} />
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Fixture />);
