"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { scrollMovesAnchor } from "@/lib/menu-placement";

/**
 * The file tree's row menu.
 *
 * It is the application's menu surface (`native-popover app-menu`) with the
 * app's menu behaviour: a choice, Escape, a press outside, or a scroll that
 * moves the row it opened from takes it away; ↑ ↓ move the highlight; the first
 * item is focused on open, so the keyboard never has to find the menu.
 *
 * The menu is **left-aligned with the row that opened it**, not with the kebab:
 * the kebab sits at the row's right end, and a 240-pixel menu opened from there
 * is a box floating over the chat. Anchored to the row's left edge, it reads as
 * belonging to the row.
 */

export interface FileTreeMenuItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  onSelect?: () => void;
}

interface Anchored {
  top: number;
  left: number;
}

const MENU_MARGIN = 8;
const MENU_WIDTH = 244;
const MENU_MAX_HEIGHT = 420;
/** Rows a row-menu is aligned to. */
const ROW_SELECTOR = ".file-tree-row,.git-branch-row,.git-log-row,.git-change-row,.git-file-row,.git-shelf-head";

function place(anchor: Element, width: number): Anchored {
  const rect = anchor.getBoundingClientRect();
  const row = anchor.closest(ROW_SELECTOR) ?? null;
  const edge = row?.getBoundingClientRect().left ?? rect.left;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.max(MENU_MARGIN, Math.min(edge, viewportWidth - width - MENU_MARGIN));
  const spaceBelow = viewportHeight - rect.bottom - MENU_MARGIN;
  const spaceAbove = rect.top - MENU_MARGIN;
  const top = spaceBelow < 160 && spaceAbove > spaceBelow
    ? Math.max(MENU_MARGIN, rect.top - MENU_MAX_HEIGHT)
    : Math.min(rect.bottom + 2, viewportHeight - MENU_MARGIN - 40);
  return { top, left };
}

export interface FileTreeMenuState {
  items: FileTreeMenuItem[];
  position: Anchored;
  /** The control the menu opened from; a scroll inside it moves the menu. */
  anchor: Element | null;
}

/** One open menu per tree. `open(rowElement, items)` from a click handler. */
export function useFileTreeMenu() {
  const [menu, setMenu] = useState<FileTreeMenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  const open = useCallback((anchor: Element, items: FileTreeMenuItem[]) => {
    setMenu({ items, position: place(anchor, MENU_WIDTH), anchor });
  }, []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".app-menu")) return;
      close();
    };
    // Capture sees every scroller in the app, the chat's auto-scroll included:
    // only a scroll that moves this menu's own row may close it.
    const onScroll = (event: Event) => {
      if (!scrollMovesAnchor(event.target, menu.anchor)) return;
      close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu, close]);

  return { menu, open, close };
}

export function FileTreeMenu({ menu, onDone }: { menu: FileTreeMenuState; onDone: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(0);
  const actionable = menu.items.filter((item) => !item.separator);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Clamp once the height is known, so a long menu does not spill out of the window.
    const rect = host.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - MENU_MARGIN) {
      host.style.top = `${Math.max(MENU_MARGIN, window.innerHeight - rect.height - MENU_MARGIN)}px`;
    }
    if (rect.right > window.innerWidth - MENU_MARGIN) {
      host.style.left = `${Math.max(MENU_MARGIN, window.innerWidth - rect.width - MENU_MARGIN)}px`;
    }
    host.querySelector<HTMLButtonElement>("button[role^='menuitem']:not([disabled])")?.focus();
  }, [menu]);

  const move = (delta: number) => {
    const count = actionable.length;
    if (!count) return;
    const next = (focused + delta + count) % count;
    setFocused(next);
    hostRef.current?.querySelectorAll<HTMLButtonElement>("button[role^='menuitem']:not([disabled])")[next]?.focus();
  };

  return (
    <div
      ref={hostRef}
      className="native-popover app-menu file-tree-menu"
      role="menu"
      style={{ top: menu.position.top, left: menu.position.left, maxHeight: MENU_MAX_HEIGHT }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          move(-1);
        }
      }}
    >
      {menu.items.map((item, index) =>
        item.separator ? (
          <div key={`${item.id}-${index}`} className="app-menu-separator" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`file-tree-menu-item${item.danger ? " is-danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onDone();
              item.onSelect?.();
            }}
          >
            <span className="file-tree-menu-label">{item.label}</span>
            {item.hint ? <span className="file-tree-menu-hint">{item.hint}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * A row's menu button. It is a real control with a name (the app's rule: no
 * bare icon), it is reachable by keyboard, and it is visible on hover, on
 * keyboard focus, on the selected row, and on a touch screen — where there is
 * no hover to wait for.
 */
export function FileTreeRowMenuButton({
  label,
  onOpen,
}: {
  label: string;
  onOpen: (anchor: Element) => void;
}) {
  return (
    <button
      type="button"
      className="file-tree-menu-button"
      title={label}
      aria-label={label}
      aria-haspopup="menu"
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event.currentTarget);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="5" r="1.7" />
        <circle cx="12" cy="12" r="1.7" />
        <circle cx="12" cy="19" r="1.7" />
      </svg>
    </button>
  );
}
