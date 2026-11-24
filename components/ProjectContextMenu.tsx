"use client";

// Fork-owned: the "…" menu on a project row of the sidebar's project tree —
// open a terminal, reveal in the file manager, archive. Since the composer's
// branch chip took over branching (components/ComposerBranchMenu.tsx), the
// actions page no longer offers Switch branch / Worktrees…; the branch and
// worktree pages below stay here because that chip renders them (with its two
// per-branch buttons), and the sidebar's worktree page is still where a
// checkout is removed. Rendered as a DOM menu here, or as native popups in the
// desktop shell (showNative*); the steps a native menu cannot do (typing a
// branch name, confirming a removal) open the DOM menu at the same point
// (openDomProjectMenu in SessionSidebar).

import { AppCombobox } from "./AppCombobox";
import { BranchIcon, WorktreeIcon } from "./GitIcons";
import type { RefObject } from "react";
import { useEffect, useState } from "react";
import { useRef } from "react";
import { createPortal } from "react-dom";
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
  const names = [
    ...data.branches.map((name) => ({ name, remote: false })),
    ...data.remoteBranches.map((name) => ({ name, remote: true })),
  ];
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
      ...(names.length === 0
        ? [{ label: t("sidebar.noOtherBranches"), disabled: true }]
        : names.map(({ name, remote }) => {
            const holder = data.worktrees.find((w) => w.branch === name && w.path !== checkout?.path);
            const tag = holder ? "worktree" : remote ? t("sidebar.remoteBranchTag") : "";
            return {
              label: tag ? `${name}  ·  ${tag}` : name,
              checked: checkout?.branch === name,
              disabled: switchingBranch !== null,
              onSelect: () => onSwitch(projectRoot, name, data),
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
  onShowWorktrees?: () => void;
  onShowNewWorktree?: () => void;
  onBackToActions?: () => void;
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
  onShowWorktrees = () => {}, onShowNewWorktree = () => {}, onBackToActions = () => {}, onOpenTerminal, onReveal, archived = false, onArchive, onRestore,
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
  const back = (label: string, onClick: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="sidebar-project-context-menu-back"
      onClick={onClick}
    >
      <span aria-hidden="true">‹</span> {label}
    </button>
  );

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
    const branchRows = [
      ...data?.branches.map((name) => ({ name, remote: false })) ?? [],
      ...data?.remoteBranches.map((name) => ({ name, remote: true })) ?? [],
    ];
    const needle = branchFilter.trim().toLowerCase();
    const visibleRows = filterBranchRows(branchRows, branchFilter);
    body = (
      <>
        {back(t("sidebar.moreActions"), onBackToActions)}
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
            {data.isGit && branchRows.length > BRANCH_FILTER_THRESHOLD && (
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
            {visibleRows
              .map(({ name, remote }) => {
                const isCurrent = checkout?.branch === name;
                const holder = data.worktrees.find((w) => w.branch === name && w.path !== checkout?.path);
                const switching = switchingBranch === name;
                const row = (
                  <button
                    key={`${remote ? "remote:" : "local:"}${name}`}
                    type="button"
                    role="menuitem"
                    aria-current={isCurrent ? "true" : undefined}
                    disabled={switchingBranch !== null}
                    onClick={() => onSwitchBranch(name)}
                    title={holder
                      ? t("sidebar.branchInWorktreeTitle", { branch: name })
                      : remote
                        ? t("sidebar.branchRemoteTitle")
                        : t("sidebar.switchBranchTitle", { branch: name })}
                  >
                    <span className="sidebar-project-context-menu-branch-name">{name}</span>
                    {holder && <span className="sidebar-project-context-menu-branch-tag">worktree</span>}
                    {remote && !holder && <span className="sidebar-project-context-menu-branch-tag">{t("sidebar.remoteBranchTag")}</span>}
                    {switching && <span className="sidebar-project-context-menu-branch-spinner" aria-hidden="true">↻</span>}
                  </button>
                );
                if (!onCreateWorktreeFromBranch) return row;
                // The composer's chip: the name checks the branch out, and the two
                // buttons after it say what else the same branch can become — a
                // checkout here, a worktree of its own next to the folder, or (when a
                // worktree already holds it) that checkout itself.
                return (
                  <div key={`${remote ? "remote:" : "local:"}${name}`} className="sidebar-project-context-menu-row sidebar-project-context-menu-row--branch">
                    {row}
                    <span className="sidebar-project-context-menu-branch-actions">
                      <button
                        type="button"
                        className="sidebar-project-context-menu-branch-action"
                        disabled={switchingBranch !== null || isCurrent}
                        title={holder
                          ? t("sidebar.openWorktreeForBranchTitle", { branch: name })
                          : t("sidebar.checkOutBranchTitle", { branch: name })}
                        aria-label={holder
                          ? t("sidebar.openWorktreeForBranchTitle", { branch: name })
                          : t("sidebar.checkOutBranchTitle", { branch: name })}
                        onClick={() => onSwitchBranch(name)}
                      >
                        <BranchIcon />
                      </button>
                      <button
                        type="button"
                        className="sidebar-project-context-menu-branch-action"
                        disabled={worktreeBusy}
                        title={t("sidebar.worktreeFromBranchTitle", { branch: name })}
                        aria-label={t("sidebar.worktreeFromBranchTitle", { branch: name })}
                        onClick={() => onCreateWorktreeFromBranch(name)}
                      >
                        <WorktreeIcon />
                      </button>
                    </span>
                  </div>
                );
              })}
            {data.branches.length === 0 && data.remoteBranches.length === 0 && (
              <div className="sidebar-project-context-menu-hint">{t("sidebar.noOtherBranches")}</div>
            )}
            {needle && visibleRows.length === 0 && (
              <div className="sidebar-project-context-menu-hint">{t("sidebar.noBranchMatches", { query: branchFilter.trim() })}</div>
            )}
            {/* The composer's chip is the app's one branching surface, so the
                worktree list (switch a checkout, remove one) hangs off it too. */}
            {onCreateWorktreeFromBranch && data.isGit && (
              <button type="button" role="menuitem" onClick={onShowWorktrees}>
                {t("sidebar.worktrees")}
              </button>
            )}
          </>
        )}
        {errorHint}
      </>
    );
  } else if (view === "worktrees") {
    body = (
      <>
        {back(t("sidebar.moreActions"), onBackToActions)}
        <div className="sidebar-project-context-menu-heading">{t("sidebar.switchWorktree")}</div>
        {loadingHint}
        {loaded && data && !data.isGit && (
          <div className="sidebar-project-context-menu-hint">{t("sidebar.worktreesNeedGit")}</div>
        )}
        {loaded && data?.isGit && (
          <>
            {data.worktrees.map((worktree) => {
              if (confirmRemove?.path === worktree.path) {
                return (
                  <div key={worktree.path} className="sidebar-project-context-menu-confirm" role="group">
                    <span>{confirmRemove.force ? t("sidebar.forceRemoveCheckout") : t("sidebar.confirmRemoveWorktree")}</span>
                    <div className="sidebar-project-context-menu-confirm-actions">
                      <button
                        type="button"
                        className="sidebar-project-context-menu-danger"
                        disabled={worktreeBusy}
                        onClick={() => onConfirmRemove(confirmRemove)}
                      >
                        {confirmRemove.force ? t("sidebar.force") : t("i18n.remove")}
                      </button>
                      <button type="button" onClick={onCancelRemove}>
                        {t("sidebar.cancel")}
                      </button>
                    </div>
                  </div>
                );
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
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
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
    body = (
      <>
        {back(t("sidebar.switchWorktree"), onShowWorktrees)}
        <div className="sidebar-project-context-menu-heading">{t("sidebar.newWorktree")}</div>
        {worktreeBaseBranch && (
          <div className="sidebar-project-context-menu-hint">
            {t("sidebar.newWorktreeFrom", { branch: worktreeBaseBranch })}
          </div>
        )}
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
                onShowWorktrees();
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
            <button type="button" onClick={onShowWorktrees}>
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
