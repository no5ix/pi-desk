"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useI18n } from "@/hooks/useI18n";
import { scrollMovesAnchor } from "@/lib/menu-placement";
import { GitRequestError } from "./git-api";

/**
 * The panel's shared pieces. Menus use the application's `.app-menu` surface
 * (AGENTS.md: every popup is the same surface), states are words the message
 * pack owns, and the formatters are here so a timestamp reads the same in the
 * graph, the commit list and the shelf rows.
 */

export interface GitMenuItem {
  id: string;
  label: string;
  hint?: string;
  disabled?: boolean;
  checked?: boolean;
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

/**
 * The row a menu belongs to. A menu opened from the small button at a row's
 * right edge is a menu about the row, so it opens under the row's left edge —
 * the way a native context menu does. Anchored to the button, it hung in the
 * middle of the list, and in a narrow panel the button's own x pushed it off
 * the row it described.
 */
const MENU_ROW_SELECTOR = ".git-branch-row, .git-log-row, .git-shelf-row, .git-change-row, [data-git-menu-row]";

/** Place a menu at a point or beside an element, inside the viewport. */
function anchorTo(anchor: { x: number; y: number } | Element, width = MENU_WIDTH): Anchored {
  const rect = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, top: anchor.y, bottom: anchor.y + 1, right: anchor.x };
  const row = anchor instanceof Element ? anchor.closest(MENU_ROW_SELECTOR) : null;
  const leftEdge = row ? row.getBoundingClientRect().left : rect.left;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.max(MENU_MARGIN, Math.min(leftEdge, viewportWidth - width - MENU_MARGIN));
  const spaceBelow = viewportHeight - rect.bottom - MENU_MARGIN;
  const spaceAbove = rect.top - MENU_MARGIN;
  const top = spaceBelow < 160 && spaceAbove > spaceBelow
    ? Math.max(MENU_MARGIN, rect.top - MENU_MAX_HEIGHT)
    : Math.min(rect.bottom + 2, viewportHeight - MENU_MARGIN - 40);
  return { top, left };
}

export interface GitMenuState {
  items: GitMenuItem[];
  position: Anchored;
  /** The control the menu was opened from; a scroll inside it moves the menu. */
  anchor: Element | null;
}

/**
 * One open menu per panel. `open(event, items)` from a click handler; the menu
 * closes on a choice, on Escape, on an outside press, and on scroll (a menu
 * anchored to a row that scrolled away is a menu aimed at nothing).
 */
export function useGitMenu() {
  const [menu, setMenu] = useState<GitMenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  const open = useCallback((anchor: Element | { x: number; y: number }, items: GitMenuItem[]) => {
    setMenu({
      items,
      position: anchorTo(anchor),
      anchor: anchor instanceof Element ? anchor : null,
    });
  }, []);

  const openAtPointer = useCallback((event: { currentTarget: Element }, items: GitMenuItem[]) => {
    open(event.currentTarget, items);
  }, [open]);

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
    // A capture-phase scroll listener sees every scroller in the app, including
    // the chat's auto-scroll. Only a scroll that moves this menu's own anchor
    // takes the menu away (the app's rule for every anchored menu).
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

  return { menu, open, openAtPointer, close };
}

export function GitMenu({ menu, onDone }: { menu: GitMenuState; onDone: () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(0);
  const actionable = menu.items.filter((item) => !item.separator);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Clamp once the height is known, so a long menu does not spill below the panel.
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
    const buttons = hostRef.current?.querySelectorAll<HTMLButtonElement>("button[role^='menuitem']:not([disabled])");
    buttons?.[next]?.focus();
  };

  return (
    <div
      ref={hostRef}
      className="native-popover app-menu git-menu"
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
            role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
            aria-checked={item.checked}
            className={`git-menu-item${item.danger ? " is-danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onDone();
              item.onSelect?.();
            }}
          >
            <span className="git-menu-label">{item.label}</span>
            {item.hint ? <span className="git-menu-hint">{item.hint}</span> : null}
          </button>
        ),
      )}
    </div>
  );
}

/** A row's kebab button: a pointer target for a menu, with the label for a
 *  screen reader (the app's rule: no bare icon). */
export function GitRowMenuButton({
  label,
  items,
  onOpen,
  disabled,
}: {
  label: string;
  items: GitMenuItem[];
  onOpen: (anchor: Element, items: GitMenuItem[]) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="git-row-menu-button"
      title={label}
      aria-label={label}
      aria-haspopup="menu"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(event.currentTarget, items);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpen(event.currentTarget, items);
      }}
    >
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
        <circle cx="6" cy="2.4" r="1.1" fill="currentColor" />
        <circle cx="6" cy="6" r="1.1" fill="currentColor" />
        <circle cx="6" cy="9.6" r="1.1" fill="currentColor" />
      </svg>
    </button>
  );
}

export function GitTabs<T extends string>({
  value,
  onChange,
  items,
  ariaLabel,
  className = "",
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ id: T; label: string; badge?: number; title?: string }>;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div className={`git-tabs ${className}`} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          className={`git-tab${value === item.id ? " is-active" : ""}`}
          title={item.title ?? item.label}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.badge ? <span className="git-tab-badge">{item.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Loading, empty and failure in words, announced the way the app's other
 *  panels announce them (the existing Git view's rule). */
export function GitState({
  kind,
  text,
  onRetry,
}: {
  kind: "loading" | "empty" | "error";
  text: string;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={`git-state git-state-${kind}`} role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"}>
      {kind === "loading" ? <span className="git-panel-spin" aria-hidden="true" /> : null}
      <span>{text}</span>
      {kind === "error" && onRetry ? (
        <button type="button" className="git-inline-button" onClick={onRetry}>
          {t("gitPanel.reload")}
        </button>
      ) : null}
    </div>
  );
}

export function GitErrorLine({ error }: { error: GitRequestError | null }) {
  if (!error) return null;
  return (
    <div className="git-state git-state-error" role="alert">
      <span>
        {error.message}
        {error.recovery ? <span className="git-state-recovery"> {error.recovery}</span> : null}
      </span>
    </div>
  );
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "3m", "5h", "12d", "3 Feb" — the graph and the list share one shape. */
export function formatCommitTime(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const age = Math.max(0, now - time);
  if (age < MINUTE) return "now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)}m`;
  if (age < DAY) return `${Math.floor(age / HOUR)}h`;
  if (age < 30 * DAY) return `${Math.floor(age / DAY)}d`;
  const date = new Date(time);
  return `${date.getDate()} ${date.toLocaleString("en", { month: "short" })}`;
}

/**
 * The Log's date column: `2026-11-25 23:21`, local time, newest first.
 *
 * The relative form ("14h") is what a feed wants; a commit list is read for the
 * moment a change was made, and the user reads the column across a week of
 * commits. Zero padded, so the column sorts as it reads.
 */
export function formatLogDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatFullTime(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  return new Date(time).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One letter, the way git's own `--porcelain` columns read, and the same class
 *  the file explorer's git marks use, so a `M` looks the same in both. */
export function statusLetter(status: string): { letter: string; className: string } {
  switch (status) {
    case "added":
    case "untracked":
      return { letter: "U", className: "is-added" };
    case "deleted":
      return { letter: "D", className: "is-deleted" };
    case "renamed":
    case "copied":
      return { letter: "R", className: "is-renamed" };
    case "conflicted":
      return { letter: "C", className: "is-conflicted" };
    default:
      return { letter: "M", className: "is-modified" };
  }
}

export function indexLetter(indexStatus: string): string {
  return indexStatus && indexStatus !== "?" ? indexStatus : "·";
}

export function workTreeLetter(workTreeStatus: string): string {
  return workTreeStatus && workTreeStatus !== "?" ? workTreeStatus : "·";
}

/** A short path with the tail kept: `lib/git/.../git-executor.ts` is the reading
 *  shape a narrow panel needs. */
export function middleEllipsis(filePath: string, max = 46): string {
  const clean = filePath.replace(/\\/g, "/");
  if (clean.length <= max) return clean;
  const head = clean.split("/")[0] ?? clean;
  const tail = clean.split("/").pop() ?? clean;
  const budget = max - head.length - tail.length - 3;
  if (budget < 4) return `…${tail.slice(-(max - 1))}`;
  return `${head}/…/${tail}`;
}

export function fileName(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

/** A relative path grouped by directory, for the tree the commit panel shows. */
export function pathSegments(filePath: string): string[] {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

export function useAutoFocus<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);
  return ref;
}

export function GitIconButton({
  label,
  onClick,
  disabled,
  active,
  children,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`git-icon-button${active ? " is-active" : ""}`}
      title={title ?? label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** A small dialog: the app's dialog surface, opened over the panel. */
export function GitDialog({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="git-dialog-backdrop" role="presentation" onPointerDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="git-dialog" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <div className="git-dialog-header">
          <span className="git-dialog-title">{title}</span>
          <button type="button" className="git-dialog-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="git-dialog-body">{children}</div>
        {footer ? <div className="git-dialog-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

export function GitTextInput({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  type?: string;
}) {
  return (
    <label className="git-field">
      <span className="git-field-label">{label}</span>
      <input
        className="git-input"
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export function GitCheckbox({
  label,
  checked,
  onChange,
  indeterminate,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  indeterminate?: boolean;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      className="git-checkbox"
      type="checkbox"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      title={title ?? label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      onClick={(event) => event.stopPropagation()}
    />
  );
}
