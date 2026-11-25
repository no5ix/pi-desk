"use client";

// Fork-owned: the menu that hangs off a project — the sidebar's "…" (open a
// terminal, reveal in the file manager, archive) and, for the composer's branch
// chip (components/ComposerBranchMenu.tsx), the branch, worktree and
// new-worktree pages. The branch page is the app's one branching surface: the
// current branch first, then the branches that have a folder of their own, then
// the rest as a foldable tree of the prefix their names carry
// (lib/branch-tree.ts), and each row carries the git call the name makes plus
// the buttons only that row can do. There is no "Project actions" step and no
// "Worktrees…" row: a page of a menu is not a screen, and a branch with a
// folder of its own is in the list with the glyph that says so.
// Rendered as a DOM menu here, or as native popups in the desktop shell
// (showNative*); the steps a native menu cannot do (typing a branch name,
// confirming a removal) open the DOM menu at the same point.

import { AppCombobox } from "./AppCombobox";
import { BranchIcon, ProjectFolderIcon, WorktreeIcon } from "./GitIcons";
import type { CSSProperties, RefObject } from "react";
import { useCallback, useEffect, useState } from "react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import {
  buildBranchRows,
  buildBranchTree,
  flattenBranchTree,
  worktreePathForBranch,
  type BranchListItem,
  type BranchRow,
} from "@/lib/branch-tree";
import { worktreeDirNameForBranch } from "@/lib/worktree-folder";
import { shortenPath } from "@/lib/display-path";
import { isImeComposing } from "@/lib/ime";
import { MENU_MAX_HEIGHT_CSS } from "@/lib/menu-placement";
import { useMenuNavigation } from "@/hooks/useMenuNavigation";
import { useMenuPlacement } from "@/hooks/useMenuPlacement";
import type { MenuAnchor } from "@/lib/menu-placement";
import { showNativeMenu, type NativeMenuEntry, type NativeMenuPoint } from "@/lib/desktop-menu";
import type { TranslationParams } from "@/lib/i18n/types";

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
}

/** The arrow that folds a group of the branch tree; CSS turns it, so the row's
 *  `aria-expanded` and the glyph turn together. */
function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

/** The trash a worktree checkout gets taken away with (the branch stays). */
function WorktreeRemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

export interface ProjectBranchMenuState {
  /** The checkout the menu was asked about: a main checkout or a linked worktree. Every
   *  git action in the menu runs here, which is what the user is standing in. */
  root: string;
  /** The repository's main checkout — the project the worktrees belong to, and the name
   *  the header and the composer show for a worktree. */
  projectRoot: string;
  isGit: boolean;
  branches: string[];
  remoteBranches: string[];
  worktrees: WorktreeEntry[];
  loaded: boolean;
}

/** Which page of the DOM menu is showing. */
export type ProjectMenuView = "actions" | "branches" | "worktrees" | "new-worktree";

/**
 * Rows in the branch page's loading shape. Eight is what the list shows once the
 * branches arrive in a normal window, so the menu is born at the height it keeps.
 */
const BRANCH_SKELETON_ROWS = 8;
/**
 * How long the panel stays invisible while a branch list is in flight before it
 * shows the loading shape. The fetch lands in tens of milliseconds, and painting
 * a shape the real list resizes is the flash; a slow fetch gets the shape, at the
 * height the list settles at.
 */
/** Exported so a test can assert the reveal is timed in code (a CSS animation a
 *  reduced-motion rule cancels would strand the panel invisible). */
export const MENU_SKELETON_REVEAL_MS = 120;
/** Below this many branches, reading the list is faster than typing in a box. */
const BRANCH_FILTER_THRESHOLD = 6;

/**
 * The branch list narrowed by the filter box: a case-insensitive substring of the
 * branch name, across local and remote rows alike. A blank query keeps the list as
 * the server sent it (the order the user reads from the top: current branch first).
 */
export function filterBranchRows<T extends { name: string }>(rows: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

/** A pending worktree removal; `force` once git said it needs --force. */
export interface WorktreeRemoval {
  path: string;
  force: boolean;
}

type Translate = (key: string, params?: TranslationParams) => string;

/** A project's local and remote branches plus its worktrees; empty when the read fails. */
export async function fetchProjectBranchMenu(cwd: string): Promise<ProjectBranchMenuState> {
  try {
    const res = await fetch(`/api/worktrees?cwd=${encodeURIComponent(cwd)}&branches=1`);
    const data = await res.json().catch(() => ({})) as {
      projectRoot?: string;
      isGit?: boolean;
      branches?: string[];
      remoteBranches?: string[];
      worktrees?: WorktreeEntry[];
    };
    const worktrees = Array.isArray(data.worktrees) ? data.worktrees : [];
    // The answer must belong to the checkout that was asked about — a stale response
    // for another project must not paint this menu. A linked worktree answers with the
    // repository's main root, so the check is "the cwd is that root, or one of the
    // worktrees it lists". The old `data.projectRoot === cwd` rejected every worktree,
    // and a repository with a dozen branches read as "No other branches".
    const belongs = Boolean(data.projectRoot)
      && (data.projectRoot === cwd || worktrees.some((entry) => entry.path === cwd));
    if (!res.ok || !belongs) throw new Error(`HTTP ${res.status}`);
    return {
      root: cwd,
      projectRoot: data.projectRoot as string,
      isGit: data.isGit === true,
      branches: Array.isArray(data.branches) ? data.branches : [],
      remoteBranches: Array.isArray(data.remoteBranches) ? data.remoteBranches : [],
      worktrees,
      loaded: true,
    };
  } catch {
    return {
      root: cwd, projectRoot: cwd, isGit: false, branches: [], remoteBranches: [], worktrees: [], loaded: true,
    };
  }
}

async function readError(res: Response): Promise<{ error?: string; dirty?: boolean; [key: string]: unknown }> {
  return await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
}

/** `git fetch --prune`, then the fresh branch lists. Throws with git's message on failure. */
export async function fetchRemoteBranches(projectRoot: string): Promise<{ branches: string[]; remoteBranches: string[] }> {
  const res = await fetch("/api/worktrees/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: projectRoot }),
  });
  const data = await readError(res) as { error?: string; branches?: unknown; remoteBranches?: unknown };
  if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
  return {
    branches: Array.isArray(data.branches) ? data.branches as string[] : [],
    remoteBranches: Array.isArray(data.remoteBranches) ? data.remoteBranches as string[] : [],
  };
}

/** `git worktree add` for an existing or new branch, from `baseBranch` when the
 *  branch is new. Throws with git's message on failure. */
export async function createProjectWorktree(projectRoot: string, branch: string, baseBranch?: string): Promise<{ path: string; branch: string }> {
  const res = await fetch("/api/worktrees", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: projectRoot, branch, ...(baseBranch ? { baseBranch } : {}) }),
  });
  const data = await readError(res) as { error?: string; path?: string; branch?: string };
  if (!res.ok || data.error || !data.path) throw new Error(data.error ?? `HTTP ${res.status}`);
  return { path: data.path, branch: data.branch ?? branch };
}

/**
 * Removes a worktree checkout (the branch is kept). Resolves `"needs-force"`
 * when git refuses because the checkout is dirty or has submodules, so the
 * caller can ask again before forcing.
 */
export async function removeProjectWorktree(projectRoot: string, path: string, force: boolean): Promise<"removed" | "needs-force"> {
  const res = await fetch("/api/worktrees", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: projectRoot, path, force }),
  });
  if (res.ok) return "removed";
  const data = await readError(res);
  if (data.dirty && !force) return "needs-force";
  throw new Error(data.error ?? `HTTP ${res.status}`);
}

/** The checkout a project's menu treats as current: the selected worktree, else the main one. */
export function currentCheckout(worktrees: WorktreeEntry[], selectedCwd: string | null): WorktreeEntry | undefined {
  return worktrees.find((w) => w.path === selectedCwd) ?? worktrees.find((w) => w.isMain);
}

function worktreeLabel(worktree: WorktreeEntry): string {
  return worktree.branch ?? worktree.path;
}

/** Desktop shell: the branch list as a native popup, led by "Fetch from remote"
 *  and (for the composer's chip) by "Worktrees…", which opens the worktree list
 *  at the same point. */
export async function showNativeProjectBranchMenu({
  projectRoot, at, selectedCwd, switchingBranch, t, onSwitch, onFetch, onWorktrees,
}: {
  projectRoot: string;
  at: NativeMenuPoint;
  selectedCwd: string | null;
  switchingBranch: string | null;
  t: Translate;
  onSwitch: (projectRoot: string, branch: string, loaded: ProjectBranchMenuState) => void;
  onFetch: (projectRoot: string) => void;
  onWorktrees?: (projectRoot: string, at: NativeMenuPoint, loaded: ProjectBranchMenuState) => void;
}) {
  const data = await fetchProjectBranchMenu(projectRoot);
  const checkout = currentCheckout(data.worktrees, selectedCwd);
  // The same order the DOM list gives: the branch this checkout is on, then the
  // branches that have a folder of their own, then the rest. A native popup has no
  // glyphs, so the folder is a word on the row.
  const rows = buildBranchRows({
    branches: data.branches,
    remoteBranches: data.remoteBranches,
    worktrees: data.worktrees,
    checkoutPath: checkout?.path ?? null,
  });
  const fetchEntry: NativeMenuEntry[] = data.isGit
    ? [{ label: t("sidebar.fetchBranches"), onSelect: () => onFetch(projectRoot) }, { kind: "separator" }]
    : [];
  const worktreesEntry: NativeMenuEntry[] = data.isGit && onWorktrees
    ? [{ label: t("sidebar.worktrees"), onSelect: () => onWorktrees(projectRoot, at, data) }, { kind: "separator" }]
    : [];
  await showNativeMenu(
    [
      ...fetchEntry,
      ...worktreesEntry,
      ...(rows.length === 0
        ? [{ label: t("sidebar.noOtherBranches"), disabled: true }]
        : rows.map((row) => {
            const tag = row.kind === "worktree"
              ? "worktree"
              : row.remote && !row.holderPath
                ? t("sidebar.remoteBranchTag")
                : "";
            return {
              label: tag ? `${row.name}  ·  ${tag}` : row.name,
              checked: row.kind === "current",
              disabled: switchingBranch !== null,
              onSelect: () => onSwitch(projectRoot, row.name, data),
            };
          })),
    ],
    at,
  );
}

/**
 * Desktop shell: the worktree list as a native popup. Picking a worktree
 * switches to it; "New worktree…" and "Remove worktree" open the DOM menu at
 * the same point, because a native menu can neither take a branch name nor
 * show the confirmation.
 */
export async function showNativeProjectWorktreeMenu({
  projectRoot, at, selectedCwd, t, onSelect, onNew, onRemove,
}: {
  projectRoot: string;
  at: NativeMenuPoint;
  selectedCwd: string | null;
  t: Translate;
  onSelect: (path: string) => void;
  onNew: (projectRoot: string, at: NativeMenuPoint, loaded: ProjectBranchMenuState) => void;
  onRemove: (projectRoot: string, path: string, at: NativeMenuPoint, loaded: ProjectBranchMenuState) => void;
}) {
  const data = await fetchProjectBranchMenu(projectRoot);
  if (!data.isGit) {
    await showNativeMenu([{ label: t("sidebar.worktreesNeedGit"), disabled: true }], at);
    return;
  }
  const checkout = currentCheckout(data.worktrees, selectedCwd);
  const removable = data.worktrees.filter((w) => !w.isMain);
  await showNativeMenu(
    [
      ...data.worktrees.map((worktree) => ({
        label: worktree.isMain ? `${worktreeLabel(worktree)}  ·  ${t("sidebar.main")}` : worktreeLabel(worktree),
        checked: checkout?.path === worktree.path,
        onSelect: () => onSelect(worktree.path),
      })),
      { kind: "separator" },
      { label: t("sidebar.newWorktree"), onSelect: () => onNew(projectRoot, at, data) },
      ...(removable.length > 0
        ? [{
            kind: "submenu" as const,
            label: t("sidebar.removeWorktree"),
            items: removable.map((worktree) => ({
              label: worktreeLabel(worktree),
              onSelect: () => onRemove(projectRoot, worktree.path, at, data),
            })),
          }]
        : []),
    ],
    at,
  );
}

interface ProjectContextMenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  projectRoot: string;
  pos: { top: number; left: number };
  /** The "…" button the menu belongs to. The menu flips above it when the
   *  space below is too small for its measured height. */
  anchor: MenuAnchor | null;
  view?: ProjectMenuView;
  /** The branch and worktree pages' data. A menu that shows only its actions
   *  page (the sidebar's "…") passes none of it, so these stay optional. */
  branchMenu?: ProjectBranchMenuState | null;
  branchLoading?: boolean;
  selectedCwd?: string | null;
  switchingBranch?: string | null;
  fetching?: boolean;
  worktreeBusy?: boolean;
  worktreeError?: string | null;
  confirmRemove?: WorktreeRemoval | null;
  newBranch?: string;
  canReveal: boolean;
  revealLabel: string;
  projectRevealError: string | null;
  t: Translate;
  onShowNewWorktree?: () => void;
  onOpenTerminal?: () => void;
  onReveal: () => void;
  /** The project sits in the Archive group: the menu is Restore + Reveal. */
  archived?: boolean;
  onArchive: () => void;
  onRestore: () => void;
  /** S2: the project sits above the others while pinned. */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** S6: deletes every session of the project that is not running; null hides it (none to delete). */
  deleteSessionsCount?: number;
  onDeleteSessions?: () => void;
  onSwitchBranch?: (branch: string) => void;
  /** The composer's branch chip: two buttons after every branch name — check it
   *  out, or make a worktree from it. Their absence keeps the plain row the
   *  sidebar's own branch page always had. */
  onCreateWorktreeFromBranch?: (branch: string) => void;
  /** Set on the new-worktree page: the branch the new branch starts from. */
  worktreeBaseBranch?: string | null;
  onFetch?: () => void;
  onSelectWorktree?: (path: string) => void;
  onRequestRemove?: (path: string) => void;
  onConfirmRemove?: (removal: WorktreeRemoval) => void;
  onCancelRemove?: () => void;
  onNewBranchChange?: (value: string) => void;
  onCreateWorktree?: () => void;
  onClose?: () => void;
}

/** The menu itself; ProjectContextMenu portals it to the document body. */
export function ProjectContextMenuPanel({
  menuRef, projectRoot, pos, anchor, view = "actions", branchMenu = null, branchLoading = false, selectedCwd = null, switchingBranch = null,
  fetching = false, worktreeBusy = false, worktreeError = null, confirmRemove = null, newBranch = "",
  canReveal, revealLabel, projectRevealError, t,
  onShowNewWorktree = () => {}, onOpenTerminal, onReveal, archived = false, onArchive, onRestore,
  pinned = false, onTogglePin, deleteSessionsCount = 0, onDeleteSessions,
  onSwitchBranch = () => {}, onFetch = () => {}, onSelectWorktree = () => {}, onRequestRemove = () => {}, onConfirmRemove = () => {}, onCancelRemove = () => {},
  onNewBranchChange = () => {}, onCreateWorktree = () => {}, onCreateWorktreeFromBranch, worktreeBaseBranch = null,
  onClose = () => {},
}: ProjectContextMenuProps) {
  useMenuNavigation(view !== "new-worktree" && !confirmRemove, menuRef, onClose);
  const data = branchMenu?.root === projectRoot ? branchMenu : null;
  const loaded = Boolean(data?.loaded);
  // The composer's chip opens the branch page before the list has arrived. The
  // panel is invisible for the first beat of that fetch (the `data-loading` rule
  // in app/native-theme.css), so the user sees one final rectangle instead of a
  // shape that jumps; see MENU_SKELETON_REVEAL_MS and hooks/useMenuPlacement.ts.
  const loadingShape = branchLoading && !loaded;
  // The menu is far taller than the row that opened it, so its real height is
  // measured after rendering: a row near the bottom of the window flips the menu
  // upward instead of letting it run off the screen. `growing` tells the hook the
  // list is in flight, so the panel is placed for the height it settles at.
  const placed = useMenuPlacement(anchor, menuRef, { growing: loadingShape });
  const position = placed ?? pos;
  const [showLoadingShape, setShowLoadingShape] = useState(false);
  // Hidden only until the shape is shown: the shape is the panel's content on a
  // slow fetch, and hiding it would make the wait silent.
  const hiddenPanel = loadingShape && !showLoadingShape;
  const hiddenPhaseRef = useRef(false);
  useEffect(() => {
    if (!loadingShape) {
      setShowLoadingShape(false);
      return;
    }
    hiddenPhaseRef.current = true;
    const timer = window.setTimeout(() => setShowLoadingShape(true), MENU_SKELETON_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [loadingShape]);
  useEffect(() => {
    if (!hiddenPhaseRef.current) return;
    hiddenPhaseRef.current = false;
    // Focusing an invisible element is a no-op, so useMenuNavigation's focus on
    // open lands nowhere. Hand focus to the first row as the panel shows.
    const panel = menuRef.current;
    const first = panel?.querySelector<HTMLElement>('button[role="menuitem"]:not(:disabled)');
    (first ?? panel)?.focus({ preventScroll: true });
  }, [loadingShape, menuRef]);

  const checkout = data ? currentCheckout(data.worktrees, selectedCwd) : undefined;
  // The branch page's filter text. A menu opened on another page (or re-opened)
  // starts with an empty box: a leftover word would hide branches silently.
  const [branchFilter, setBranchFilter] = useState("");
  const lastViewRef = useRef(view);
  if (lastViewRef.current !== view) {
    // Leaving the branch page drops the filter: coming back must not show a list
    // quietly narrowed by a word typed a page ago.
    lastViewRef.current = view;
    setBranchFilter("");
  }
  const loadingHint = branchLoading && !loaded && (
    <div className="sidebar-project-context-menu-hint">…</div>
  );
  const errorHint = worktreeError && (
    <div className="sidebar-project-context-menu-hint sidebar-project-context-menu-error" role="alert">{worktreeError}</div>
  );
  /** The prefixes the user folded away on the branch page. Empty means everything
   *  is open, which is how a tree is first read; the menu is unmounted when it
   *  closes, so a fold is a decision about the list that is open. */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const toggleBranchGroup = useCallback((prefix: string) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(prefix)) {
        next.delete(prefix);
      } else {
        next.add(prefix);
      }
      return next;
    });
  }, []);

  /** What a row's glyph promises, in the row's own words. */
  const branchTitle = (row: BranchRow) => {
    if (row.kind === "current") {
      // The row of the branch this folder is on says which folder it is in too: the
      // glyph is a worktree there, and the title has to say the same thing.
      return row.holderIsMain
        ? t("sidebar.currentBranchTitle", { branch: row.name })
        : t("sidebar.currentWorktreeBranchTitle", { branch: row.name });
    }
    if (row.holderPath) {
      return row.holderIsMain
        ? t("sidebar.mainCheckoutBranchTitle", { branch: row.name })
        : t("sidebar.branchInWorktreeTitle", { branch: row.name });
    }
    return row.remote
      ? t("sidebar.branchRemoteTitle")
      : t("sidebar.switchBranchTitle", { branch: row.name });
  };

  /** The glyph of a branch: the checkout glyph for the branch this linked worktree is
   *  on and for a branch a linked worktree holds, the project's folder for a branch the
   *  project's own folder holds (this checkout included), the branch glyph for every
   *  other name. The three are the same three glyphs the header and the composer's
   *  project chip use, and they answer the same question the chips do: what kind of
   *  folder is this. A branch carried into a worktree folder does not downgrade the
   *  folder — the user's `main-bak` in `auto-toc-worktrees/main-bak3-test-wt` is a
   *  worktree, and the current row says so. */
  const branchMark = (row: BranchRow) => (
    <span className={`sidebar-project-context-menu-branch-mark${row.kind === "branch" ? " is-plain" : ""}`}>
      {row.kind === "worktree" || (row.kind === "current" && !row.holderIsMain)
        ? <WorktreeIcon />
        : row.kind === "branch"
          ? <BranchIcon />
          : <ProjectFolderIcon />}
    </span>
  );

  /** The strip a removal asks for, in the row that asked for it. The row owns the
   *  path: it is the row's button that put the request in `confirmRemove`. */
  const removalStrip = () => (
    <div className="sidebar-project-context-menu-confirm" role="group">
      <span>{confirmRemove?.force ? t("sidebar.forceRemoveCheckout") : t("sidebar.confirmRemoveWorktree")}</span>
      <div className="sidebar-project-context-menu-confirm-actions">
        <button
          type="button"
          className="sidebar-project-context-menu-danger"
          disabled={worktreeBusy}
          onClick={() => confirmRemove && onConfirmRemove(confirmRemove)}
        >
          {confirmRemove?.force ? t("sidebar.force") : t("i18n.remove")}
        </button>
        <button type="button" onClick={onCancelRemove}>
          {t("sidebar.cancel")}
        </button>
      </div>
    </div>
  );

  /**
   * One branch of the list.
   *
   * The glyph says what the branch *is*, the name is the switch (check it out
   * here, or take the session to the folder that already holds it), and the
   * buttons at the row's trailing edge are the two things only this row can do:
   * start a worktree from this branch, or take away the checkout a worktree
   * branch already has. A branch git would refuse (`already checked out`) gets
   * neither worktree button, because the row's name is what opens that folder.
   */
  const branchLine = (row: BranchRow, label: string, depth: number) => {
    const key = `${row.remote ? "remote:" : "local:"}${row.name}`;
    const removable = row.kind === "worktree" ? row.holderPath : null;
    if (removable && confirmRemove?.path === removable) {
      return <div key={key}>{removalStrip()}</div>;
    }
    const button = (
      <button
        type="button"
        role="menuitem"
        aria-current={row.kind === "current" ? "true" : undefined}
        disabled={switchingBranch !== null}
        onClick={() => onSwitchBranch(row.name)}
        title={branchTitle(row)}
      >
        {branchMark(row)}
        <span className="sidebar-project-context-menu-branch-name" data-branch={row.name}>{label}</span>
        {row.remote && <span className="sidebar-project-context-menu-branch-tag">{t("sidebar.remoteBranchTag")}</span>}
        {switchingBranch === row.name && <span className="sidebar-project-context-menu-branch-spinner" aria-hidden="true">↻</span>}
      </button>
    );
    const actions = (
      <span className="sidebar-project-context-menu-branch-actions">
        {onCreateWorktreeFromBranch && !row.holderPath && (
          <button
            type="button"
            className="sidebar-project-context-menu-branch-action"
            disabled={worktreeBusy}
            title={t("sidebar.worktreeFromBranchTitle", { branch: row.name })}
            aria-label={t("sidebar.worktreeFromBranchTitle", { branch: row.name })}
            onClick={() => onCreateWorktreeFromBranch(row.name)}
          >
            <WorktreeIcon />
          </button>
        )}
        {removable && (
          <button
            type="button"
            className="worktree-remove-button"
            disabled={worktreeBusy}
            title={t("sidebar.removeWorktreeTitle", { path: removable })}
            aria-label={t("sidebar.removeWorktreeTitle", { path: removable })}
            onClick={() => onRequestRemove(removable)}
          >
            <WorktreeRemoveIcon />
          </button>
        )}
      </span>
    );
    return (
      <div
        key={key}
        className={`sidebar-project-context-menu-row sidebar-project-context-menu-row--branch${depth > 0 ? " sidebar-project-context-menu-row--tree" : ""}`}
        style={{ "--branch-depth": depth } as CSSProperties}
      >
        {button}
        {actions}
      </div>
    );
  };

  /** A group of the tree: the arrow folds it, the folder glyph says the branches
   *  under it share this prefix, and a folded group says how many are hiding. */
  const branchGroupLine = (item: Extract<BranchListItem, { type: "group" }>) => {
    const expanded = !item.collapsed;
    const label = t(expanded ? "sidebar.branchGroupCollapse" : "sidebar.branchGroupExpand", { group: item.group.prefix });
    return (
      <button
        key={`group:${item.group.prefix}`}
        type="button"
        role="menuitem"
        aria-expanded={expanded}
        aria-label={label}
        title={label}
        className="sidebar-project-context-menu-branch-group"
        style={{ "--branch-depth": item.depth } as CSSProperties}
        onClick={() => toggleBranchGroup(item.group.prefix)}
      >
        <span className={`sidebar-project-context-menu-branch-chevron${expanded ? "" : " is-collapsed"}`} aria-hidden="true">
          <ChevronIcon />
        </span>
        <span className="sidebar-project-context-menu-branch-mark is-plain"><ProjectFolderIcon /></span>
        <span className="sidebar-project-context-menu-branch-name" data-group={item.group.prefix}>{item.label}</span>
        {!expanded && (
          <span className="sidebar-project-context-menu-branch-tag">{t("sidebar.branchGroupCount", { count: item.count })}</span>
        )}
      </button>
    );
  };

  let body;
  if (archived) {
    body = (
      <>
        <button type="button" role="menuitem" onClick={onRestore}>
          {t("sidebar.restoreProject")}
        </button>
        {canReveal && (
          <button type="button" role="menuitem" onClick={onReveal}>
            {revealLabel}
          </button>
        )}
        {projectRevealError && (
          <div className="sidebar-project-context-menu-hint" role="alert">{projectRevealError}</div>
        )}
      </>
    );
  } else if (view === "actions") {
    // No branch/worktree entries: the composer's branch chip
    // (components/ComposerBranchMenu.tsx) is where a branch is switched and a
    // worktree is made, so this menu keeps only the project's folder actions.
    body = (
      <>
        {onOpenTerminal && (
          <button type="button" role="menuitem" onClick={onOpenTerminal}>
            {t("sidebar.openTerminalHere")}
          </button>
        )}
        {canReveal && (
          <button type="button" role="menuitem" onClick={onReveal}>
            {revealLabel}
          </button>
        )}
        {projectRevealError && (
          <div className="sidebar-project-context-menu-hint" role="alert">{projectRevealError}</div>
        )}
        {onTogglePin && (
          <button type="button" role="menuitem" onClick={onTogglePin}>
            {t(pinned ? "sidebar.unpinProject" : "sidebar.pinProject")}
          </button>
        )}
        <button type="button" role="menuitem" onClick={onArchive}>
          {t("sidebar.archiveProject")}
        </button>
        {onDeleteSessions && deleteSessionsCount > 0 && (
          <button type="button" role="menuitem" className="is-danger" onClick={onDeleteSessions}>
            {t("sidebar.deleteProjectSessions", { count: deleteSessionsCount })}
          </button>
        )}
      </>
    );
  } else if (view === "branches") {
    // The list a project can have: 4 branches, or 40. The filter box is what
    // makes the long case usable, so it appears once the list is long enough to
    // need it (and the menu stays a plain list for a small repository).
    const allRows = data
      ? buildBranchRows({
        branches: data.branches,
        remoteBranches: data.remoteBranches,
        worktrees: data.worktrees,
        checkoutPath: checkout?.path ?? null,
      })
      : [];
    const needle = branchFilter.trim().toLowerCase();
    const visibleRows = filterBranchRows(allRows, branchFilter);
    // The three questions a scanned list answers, in the order they are asked:
    // *where am I* (the branch this folder is on), *which branches have a folder
    // of their own*, and only then the rest — grouped by the path each name
    // already carries, in a tree the user folds. Forty names turn into six folders.
    const topRows = visibleRows.filter((row) => row.kind !== "branch");
    const treeItems = flattenBranchTree(
      buildBranchTree(visibleRows.filter((row) => row.kind === "branch")),
      collapsedGroups,
      // A filter box is the narrowing the fold is standing in for: a search that
      // answers from inside a folded group is a dead end, so a query opens them all.
      { expandAll: needle.length > 0 },
    );
    body = (
      <>
        <div className="sidebar-project-context-menu-heading">{t("sidebar.switchBranch")}</div>
        {/* The branch list arrives a moment after the menu opens. Showing a short
            "…" line and growing into the list afterwards moves the menu (the
            placement is recomputed from the measured height) — the composer chip
            sits at the bottom of the window, so that growth flips it from below the
            composer to above it, which reads as a flash. The list's shape is here
            from the first paint instead, at the height it settles at. */}
        {!loaded && showLoadingShape && (
          <div className="sidebar-project-context-menu-branch-skeletons" aria-hidden="true">
            {Array.from({ length: BRANCH_SKELETON_ROWS }, (_, index) => (
              <div className="sidebar-project-context-menu-row sidebar-project-context-menu-row--branch" key={index}>
                <span className="sidebar-project-context-menu-branch-skeleton" />
              </div>
            ))}
          </div>
        )}
        {loaded && data && (
          <>
            {data.isGit && (
              <button
                type="button"
                role="menuitem"
                className="sidebar-project-context-menu-fetch"
                disabled={fetching}
                onClick={onFetch}
                title={t("sidebar.fetchBranchesTitle")}
              >
                <span className={fetching ? "sidebar-project-context-menu-branch-spinner" : undefined} aria-hidden="true">↻</span>
                <span>{fetching ? t("sidebar.fetchingBranches") : t("sidebar.fetchBranches")}</span>
              </button>
            )}
            {data.isGit && allRows.length > BRANCH_FILTER_THRESHOLD && (
              <input
                className="sidebar-project-context-menu-filter"
                type="text"
                value={branchFilter}
                placeholder={t("sidebar.filterBranches")}
                aria-label={t("sidebar.filterBranches")}
                title={t("sidebar.filterBranchesTitle")}
                onChange={(event) => setBranchFilter(event.target.value)}
              />
            )}
            {topRows.map((row) => branchLine(row, row.name, 0))}
            {treeItems.map((item) => item.type === "group"
              ? branchGroupLine(item)
              : branchLine(item.row, item.label, item.depth))}
            {data.branches.length === 0 && data.remoteBranches.length === 0 && (
              <div className="sidebar-project-context-menu-hint">{t("sidebar.noOtherBranches")}</div>
            )}
            {needle && visibleRows.length === 0 && (
              <div className="sidebar-project-context-menu-hint">{t("sidebar.noBranchMatches", { query: branchFilter.trim() })}</div>
            )}
            {/* No "Worktrees…" row any more: every branch that has a folder of its
                own is in this list with the worktree glyph in front of it, its name
                opens that folder, and its row carries the removal the worktree page
                used to own. The desktop shell's right-click keeps its native
                "Worktrees…" popup. */}
          </>
        )}
        {errorHint}
      </>
    );
  } else if (view === "worktrees") {
    body = (
      <>
        {/* No "Project actions" step back: the menu is closed by Escape, a click
            outside, or the row's own action. A page of a menu is not a screen. */}
        <div className="sidebar-project-context-menu-heading">{t("sidebar.switchWorktree")}</div>
        {loadingHint}
        {loaded && data && !data.isGit && (
          <div className="sidebar-project-context-menu-hint">{t("sidebar.worktreesNeedGit")}</div>
        )}
        {loaded && data?.isGit && (
          <>
            {data.worktrees.map((worktree) => {
              if (confirmRemove?.path === worktree.path) {
                return <div key={worktree.path}>{removalStrip()}</div>;
              }
              return (
                <div key={worktree.path} className="sidebar-project-context-menu-row">
                  <button
                    type="button"
                    role="menuitem"
                    title={worktree.path}
                    aria-current={checkout?.path === worktree.path ? "true" : undefined}
                    onClick={() => onSelectWorktree(worktree.path)}
                  >
                    <span className="sidebar-project-context-menu-label">{worktreeLabel(worktree)}</span>
                    {worktree.isMain && <span className="sidebar-project-context-menu-branch-tag">{t("sidebar.main")}</span>}
                  </button>
                  {!worktree.isMain && (
                    <button
                      type="button"
                      className="worktree-remove-button"
                      disabled={worktreeBusy}
                      title={t("sidebar.removeWorktreeTitle", { path: worktree.path })}
                      aria-label={t("sidebar.removeWorktreeTitle", { path: worktree.path })}
                      onClick={() => onRequestRemove(worktree.path)}
                    >
                      <WorktreeRemoveIcon />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              role="menuitem"
              title={t("sidebar.createWorktreeTitle")}
              onClick={onShowNewWorktree}
            >
              {t("sidebar.newWorktree")}
            </button>
          </>
        )}
        {errorHint}
      </>
    );
  } else {
    const branchOptions = data?.branches ?? [];
    const canCreate = !worktreeBusy && newBranch.trim().length > 0;
    // The folder git will create, read straight off the name being typed:
    // `<repo>-worktrees/<branch>` is the rule `lib/worktree.ts`'s addWorktree()
    // applies, and the form is where a person decides whether that is the folder
    // they want. `projectRoot` is the repository's main checkout, which is what the
    // menu's own read answers with (a linked worktree answers with the repository).
    const folder = worktreePathForBranch(data?.projectRoot ?? projectRoot, newBranch, worktreeDirNameForBranch);
    body = (
      <>
        {/* No "Switch worktree" heading and no step back: the sentence below names
            the branch and the folder, which is the whole page, and Escape, Cancel or
            a click outside closes the menu the way every other menu in the app
            closes. A page of a menu is not a screen with its own back button. */}
        <div className="sidebar-project-context-menu-hint sidebar-project-context-menu-worktree-hint">
          <div className="sidebar-project-context-menu-worktree-sentence">
            {worktreeBaseBranch
              ? t("sidebar.newWorktreeFrom", { branch: worktreeBaseBranch })
              : t("sidebar.newWorktreeInto")}
          </div>
          {/* The folder gets the second row to itself. It is an absolute path (with
              the `…` that stands for the name not typed yet) and a folder one is being
              asked to create is not a thing to cut in half at the end of a sentence;
              `~` for the home folder is the shape every other path label in the app
              uses, and the whole path stays in the row's title. */}
          <div className="sidebar-project-context-menu-worktree-path" title={folder}>
            {shortenPath(folder)}
          </div>
        </div>
        <div className="sidebar-project-context-menu-form">
          <AppCombobox
            autoFocus
            value={newBranch}
            options={branchOptions}
            placeholder={t("sidebar.branchName")}
            aria-label={t("sidebar.branchName")}
            onValueChange={onNewBranchChange}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Enter") {
                e.preventDefault();
                if (canCreate) onCreateWorktree();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
          />
          <div className="sidebar-project-context-menu-confirm-actions">
            <button
              type="button"
              className="sidebar-project-context-menu-primary"
              disabled={!canCreate}
              onClick={onCreateWorktree}
            >
              {worktreeBusy ? t("sidebar.creating") : t("sidebar.create")}
            </button>
            <button type="button" onClick={onClose}>
              {t("sidebar.cancel")}
            </button>
          </div>
        </div>
        {errorHint}
      </>
    );
  }

  return (
    <div
      ref={menuRef}
      className={`sidebar-project-context-menu native-popover app-menu${view === "actions" ? "" : " sidebar-project-context-menu--wide"}`}
      data-loading={hiddenPanel ? "true" : undefined}
      style={{ top: position.top, left: position.left, maxHeight: MENU_MAX_HEIGHT_CSS, overflowY: "auto" }}
      role="menu"
    >
      {body}
    </div>
  );
}

export function ProjectContextMenu(props: ProjectContextMenuProps) {
  return createPortal(<ProjectContextMenuPanel {...props} />, document.body);
}
