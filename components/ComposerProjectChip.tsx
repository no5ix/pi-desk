"use client";

// Fork-owned: the project chip at the composer's left edge, which keeps the session's
// project visible and switches a new-session composer between active projects.
// ChatInput (upstream-owned) keeps the open state and ref (its outside-click
// handler closes every composer menu) and mounts this.
//
// The menu hangs above the chip, so it is placed by the same two rules every composer
// menu uses (lib/composer-panel-placement.ts):
// - sideways: a number for the width, and the box the page can show. `position: absolute`
//   with only a `minWidth` is shrink-to-fit on the chip's own wrapper, and a panel wider
//   than that grows out of the conversation column, which clips it and is painted over.
// - upwards: a height cap from the chip to the boundary above it — the chat column's
//   clipping edge and, over that, the app topbar (#63). The project list is the composer's
//   longest one (every recent project, on a phone one row per project), so it is the menu
//   that reaches the boundary first: uncapped it grew up behind the topbar, whose bar is
//   drawn above the chat column, and the projects at the top of the list — the filter box
//   and the current project — were covered and unreachable.

import { useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  composerPanelAnchoring,
  getUpwardMenuMaxHeight,
  getVisibleTopBoundary,
} from "@/lib/composer-panel-placement";
import { canUseNativeMenu, menuPointBelow, showNativeMenu } from "@/lib/desktop-menu";
import { getProjectDisplayName } from "@/lib/project-display";
import { useI18n } from "@/hooks/useI18n";
import { WorktreeIcon } from "./GitIcons";

/** The list wants room for a project name and its glyph; the helper clamps it to the column. */
const PROJECT_MENU_WIDTH = 260;
/** The width the panel keeps when nothing could be measured (a detached anchor). */
const PROJECT_MENU_MIN_WIDTH = 220;
const PROJECT_MENU_MAX_WIDTH = 320;
/** The composer menus' gap above their control. */
const MENU_GROW_GAP = 6;
/** Never a sliver: the composer menus keep this much list when the space is tight. */
const UPWARD_MENU_MIN_HEIGHT = 120;
/** The composer popovers' layer (`--z-dropdown`), under the chrome and the menus above it. */
const COMPOSER_MENU_Z_INDEX = 100;

export function getProjectLabel(
  projectPath: string | null | undefined,
  allProjectPaths: readonly string[] = [],
): string | null {
  if (!projectPath) return null;
  return getProjectDisplayName(projectPath, allProjectPaths);
}

interface ComposerProjectChipProps {
  menuRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
  label: string;
  projectPath?: string | null;
  /** The composer's folder is a linked worktree checkout: the checkout glyph, not the
   *  folder. Asked of the folder alone — components/TopbarProjectChip.tsx says why. */
  isWorktree?: boolean;
  maxWidth: number;
  /** Active project roots a new-session composer can switch between. */
  projectOptions: string[];
  onProjectChange?: (projectRoot: string) => void;
  /** Opens the project chooser when there is no list to switch within. */
  onSelectProject?: () => void;
}

export function ComposerProjectChip({
  menuRef, open, onOpenChange, label, projectPath, isWorktree = false, maxWidth, projectOptions, onProjectChange, onSelectProject,
}: ComposerProjectChipProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const panelRef = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | null>(null);

  // Cap the open list to the space above the chip. Measured from the chip (not from the
  // panel), so the cap the panel is given never feeds back into the measurement; the
  // observers only re-run it when the row above the chip, the window, or the keyboard
  // moves that space.
  useLayoutEffect(() => {
    if (!open) {
      setMaxHeight(null);
      return;
    }
    const panel = panelRef.current;
    const chip = menuRef.current;
    if (!panel || !chip) return;

    let frame: number | null = null;
    const measure = () => {
      frame = null;
      // The panel's bottom edge sits `MENU_GROW_GAP` above the chip's top edge.
      const menuBottom = chip.getBoundingClientRect().top - MENU_GROW_GAP;
      const next = getUpwardMenuMaxHeight(menuBottom, getVisibleTopBoundary(panel));
      setMaxHeight((current) => (current === next ? current : next));
    };
    const schedule = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(chip);
    if (panel.parentElement) observer?.observe(panel.parentElement);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer?.disconnect();
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, menuRef]);

  const showsWorktreeGlyph = isWorktree;
  return (
    <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        className="chat-project-context"
        style={{ maxWidth }}
        title={`${t("chat.switchProject")} · ${t("chat.currentProject", { path: projectPath ?? label })}`}
        aria-label={t("chat.currentProject", { path: projectPath ?? label })}
        aria-haspopup={projectOptions.length > 0 && onProjectChange ? "menu" : undefined}
        aria-expanded={projectOptions.length > 0 && onProjectChange ? open : undefined}
        onClick={(event) => {
          if (projectOptions.length > 0 && onProjectChange) {
            // Desktop shell: the project list as a native popup.
            if (canUseNativeMenu()) {
              void showNativeMenu(
                projectOptions.map((projectRoot) => ({
                  label: getProjectLabel(projectRoot, projectOptions) ?? projectRoot,
                  checked: projectRoot === projectPath,
                  onSelect: () => {
                    if (projectRoot !== projectPath) onProjectChange(projectRoot);
                  },
                })),
                menuPointBelow(event.currentTarget),
              ).then((shown) => { if (!shown) onOpenChange(true); });
              return;
            }
            onOpenChange((isOpen) => !isOpen);
          } else onSelectProject?.();
        }}
        disabled={!onSelectProject && !(projectOptions.length > 0 && onProjectChange)}
      >
        {showsWorktreeGlyph ? <WorktreeIcon size={14} /> : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          </svg>
        )}
        <span>{label}</span>
      </button>
      {open && projectOptions.length > 0 && onProjectChange && (() => {
        // A number for the width and a box that stops at the sidebar, like the composer's
        // other menus; a phone hangs the panel from the chip's left edge.
        const anchoring = composerPanelAnchoring(menuRef.current, PROJECT_MENU_WIDTH, { alignLeft: isMobile });
        const cap = maxHeight === null ? null : Math.max(UPWARD_MENU_MIN_HEIGHT, maxHeight);
        return (
        <div
          ref={panelRef}
          className="native-popover app-menu composer-project-menu"
          role="menu"
          style={{
            position: "absolute",
            bottom: `calc(100% + ${MENU_GROW_GAP}px)`,
            ...(anchoring ? { left: anchoring.left, width: anchoring.width } : isMobile ? { left: 0, minWidth: PROJECT_MENU_MIN_WIDTH, maxWidth: PROJECT_MENU_MAX_WIDTH } : { right: 0, minWidth: PROJECT_MENU_MIN_WIDTH, maxWidth: PROJECT_MENU_MAX_WIDTH }),
            zIndex: COMPOSER_MENU_Z_INDEX,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            // The list's own cap, and the measured space above the chip: the shorter of
            // the two, so the panel stops at the header instead of running behind it.
            maxHeight: cap === null ? "min(60vh, 420px)" : `min(60vh, 420px, ${cap}px)`,
          }}
        >
          <div className="app-menu-list">
            {projectOptions.map((projectRoot) => {
              const optionLabel = getProjectLabel(projectRoot, projectOptions) ?? projectRoot;
              const isCurrent = projectRoot === projectPath;
              return (
                <button
                  key={projectRoot}
                  type="button"
                  role="menuitem"
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => {
                    onOpenChange(false);
                    if (!isCurrent) onProjectChange(projectRoot);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    width: "100%",
                    minWidth: 0,
                    padding: "7px 9px",
                    border: 0,
                    borderRadius: "var(--radius-sm)",
                    background: isCurrent ? "var(--bg-selected)" : "transparent",
                    color: isCurrent ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: "var(--fs-caption)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = "var(--bg-hover)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isCurrent) e.currentTarget.style.background = "transparent";
                  }}
                  title={projectRoot}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  </svg>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{optionLabel}</span>
                </button>
              );
            })}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
