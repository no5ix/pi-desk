"use client";

// Fork-owned: the branch chip in the composer's control row, right behind the
// project chip (components/ComposerProjectChip.tsx) and only on a new-session
// composer — the moment where "which branch do I work on, and in which folder"
// is still an open question.
//
// It renders the project menu's own pages (components/ProjectContextMenu.tsx)
// and drives them through hooks/useProjectWorktreeActions.ts, so the branch
// list, the "Fetch from remote" row, the worktree list and the new-worktree
// form are the same code the sidebar's "…" menu has always used. The chip adds
// the row's button: the worktree icon opens the new-worktree form for that
// branch — the branch it starts from and the folder it lands in are named in the
// form before anything is created — and the row's name is the switch: it checks
// that branch out in this checkout, or, when a worktree already holds it, takes
// the session to that worktree. A worktree made from a branch lives in
// `<repo>-worktrees/<branch>` and moves this new session into that folder,
// leaving the checkout the composer was opened from on its own branch.
//
// A click opens the app's menu, not the OS popup: the row carries buttons, and
// a long branch list is narrowable from its filter box. The desktop shell keeps
// the native popup on right-click.
//
// ChatInput (upstream-owned) mounts this and nothing else: the branch name, the
// git calls and the menu state all live here.

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useProjectBranch } from "@/hooks/useProjectBranch";
import { useProjectWorktreeActions } from "@/hooks/useProjectWorktreeActions";
import { canUseNativeMenu, menuPointBelow, type NativeMenuPoint } from "@/lib/desktop-menu";
import {
  MENU_GAP,
  MENU_MAX_HEIGHT_PX,
  menuExpectedHeight,
  placeMenuWithinViewport,
} from "@/lib/menu-placement";
import {
  fetchProjectBranchMenu,
  ProjectContextMenu,
  showNativeProjectBranchMenu,
  showNativeProjectWorktreeMenu,
  type ProjectBranchMenuState,
  type ProjectMenuView,
} from "./ProjectContextMenu";
import { BranchIcon } from "./GitIcons";

const BRANCHES_VIEW: ProjectMenuView = "branches";
const WORKTREES_VIEW: ProjectMenuView = "worktrees";
const NEW_WORKTREE_VIEW: ProjectMenuView = "new-worktree";
const MENU_WIDTH = 240;
/**
 * The height to place the menu for: the cap the panel carries, not the shape it
 * opens at. `hooks/useMenuPlacement.ts` starts from the same number, and
 * `ProjectContextMenuPanel` sizes itself by the same constant
 * (`MENU_MAX_HEIGHT_CSS`), so the first paint, the measured placement, and the
 * panel's own cap all agree. Placed from anything smaller, the panel lands on a
 * side and at a top the branch list does not fit, and jumps when it arrives.
 */
function menuExpectedHeightForViewport(): number {
  return typeof window === "undefined" ? MENU_MAX_HEIGHT_PX : menuExpectedHeight(window.innerHeight);
}

interface ComposerBranchChipProps {
  /** The composer's project folder — a new session starts in this checkout. */
  cwd: string;
  /** The chip's width cap, like the project chip's; the branch name ellipsizes. */
  maxWidth?: number;
  /** A branch was checked out in `cwd`; the owner refreshes what reads the branch. */
  onBranchSwitched?: (branch: string) => void;
  /** A worktree was created from a branch; the new session moves to `path`. */
  onWorktreeCreated?: (path: string, branch: string) => void;
  /** An existing worktree was picked; the new session works there. */
  onWorktreeSelected?: (path: string) => void;
  /** A worktree checkout was removed. `fallbackRoot` is the project's main
   *  checkout when the composer was sitting in the folder that went away. */
  onWorktreeRemoved?: (path: string, fallbackRoot: string | null) => void;
}

export function ComposerBranchChip({
  cwd, maxWidth = 150, onBranchSwitched, onWorktreeCreated, onWorktreeSelected, onWorktreeRemoved,
}: ComposerBranchChipProps) {
  const { t } = useI18n();
  const branch = useProjectBranch(cwd);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** A native popup closed when it was picked; the DOM menu that takes over
   *  (a branch name to type, a removal to confirm, git's answer) lands here. */
  const nativeAtRef = useRef<NativeMenuPoint | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ProjectMenuView>(BRANCHES_VIEW);
  const [menu, setMenu] = useState<ProjectBranchMenuState | null>(null);
  const [loading, setLoading] = useState(false);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [anchor, setAnchor] = useState<{ top: number; bottom: number; right: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMenu(await fetchProjectBranchMenu(cwd));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  const close = useCallback(() => {
    setOpen(false);
    setView(BRANCHES_VIEW);
    setBaseBranch(null);
    nativeAtRef.current = null;
  }, []);

  /** Opens the DOM menu under the chip. */
  const openMenu = useCallback((next: ProjectMenuView = BRANCHES_VIEW) => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      // Place for the size the menu ends at, not the size it is born at: the
      // composer is at the bottom of the window, and a menu placed below the
      // loading shape flips above when the branch list arrives. That flip is the
      // flash the user saw, so the first paint already sits above.
      const placed = placeMenuWithinViewport(
        { top: rect.top, bottom: rect.bottom, right: rect.right },
        { width: MENU_WIDTH, height: menuExpectedHeightForViewport() },
        { width: window.innerWidth, height: window.innerHeight },
        { gap: MENU_GAP },
      );
      setPos(placed);
      setAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right });
    }
    setView(next);
    setOpen(true);
    void load();
  }, [load]);

  /** Opens the DOM menu at a native popup's point (the sidebar's own rule). */
  const openMenuAt = useCallback((next: ProjectMenuView, at: NativeMenuPoint) => {
    setPos({
      top: Math.max(8, Math.min(at.y, window.innerHeight - 160)),
      left: Math.max(8, Math.min(at.x, window.innerWidth - MENU_WIDTH - 8)),
    });
    setAnchor({ top: at.y, bottom: at.y, right: at.x + MENU_WIDTH });
    setView(next);
    setOpen(true);
  }, []);

  const actions = useProjectWorktreeActions({
    onBranchesFetched: (root, lists) => {
      setMenu((current) => (current && current.root === root
        ? { ...current, branches: lists.branches, remoteBranches: lists.remoteBranches }
        : current));
      // The native popup is gone by now, so the fetched list opens as the DOM
      // menu at the same point — the new branches have to appear somewhere.
      if (nativeAtRef.current) openMenuAt(BRANCHES_VIEW, nativeAtRef.current);
    },
    onWorktreeCreated: (_root, path, created) => {
      close();
      onWorktreeCreated?.(path, created);
    },
    onWorktreeRemoved: async (_root, path) => {
      // The list is the answer to "where does the composer go when the folder it
      // was in is gone": back to the project's main checkout.
      const fresh = await fetchProjectBranchMenu(cwd);
      setMenu(fresh);
      const main = fresh.worktrees.find((w) => w.isMain)?.path ?? null;
      onWorktreeRemoved?.(path, cwd === path ? main : null);
    },
    onBranchSwitched: (_cwd, switched) => {
      close();
      onBranchSwitched?.(switched);
    },
    onBranchInWorktree: (_cwd, _branch, path) => {
      // The branch lives in that worktree: the project label stays, the session
      // works in that folder, and the header's branch icon becomes the worktree's.
      close();
      onWorktreeSelected?.(path);
    },
  });

  const openWorktreeForm = useCallback((from: string) => {
    actions.setNewBranch("");
    setBaseBranch(from || null);
    setView(NEW_WORKTREE_VIEW);
  }, [actions]);

  const showWorktrees = useCallback((root: string, at: NativeMenuPoint, loaded: ProjectBranchMenuState) => {
    nativeAtRef.current = at;
    setMenu(loaded);
    void showNativeProjectWorktreeMenu({
      projectRoot: root,
      at,
      selectedCwd: cwd,
      t,
      onSelect: (path) => {
        close();
        onWorktreeSelected?.(path);
      },
      onNew: (_r, point, data) => {
        nativeAtRef.current = point;
        setMenu(data);
        setBaseBranch(null);
        actions.setNewBranch("");
        openMenuAt(NEW_WORKTREE_VIEW, point);
      },
      onRemove: (_r, path, point, data) => {
        nativeAtRef.current = point;
        setMenu(data);
        openMenuAt(WORKTREES_VIEW, point);
        actions.requestRemove(path);
      },
    });
  }, [actions, close, cwd, onWorktreeSelected, openMenuAt, t]);

  const openNativeMenu = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const at = menuPointBelow(button);
    nativeAtRef.current = at;
    void showNativeProjectBranchMenu({
      projectRoot: cwd,
      at,
      selectedCwd: cwd,
      switchingBranch: actions.switchingBranch,
      t,
      onWorktrees: showWorktrees,
      onSwitch: (_root, name, loaded) => {
        void actions.switchBranch(cwd, name, loaded, cwd).then((result) => {
          // A native popup has no place left for git's answer; the DOM menu at the
          // same point carries it. A branch that lives in another worktree is a
          // success (the session moved there), so there is nothing left to show.
          if (result.branch === null && result.worktreePath === null) openMenuAt(BRANCHES_VIEW, at);
        });
      },
      onFetch: (root) => void actions.fetchBranches(root),
    });
  }, [actions, cwd, openMenuAt, showWorktrees, t]);

  // Close on a click outside the chip and its menu, like the composer's other popups.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [close, open]);

  function openChipMenu() {
    if (open) {
      close();
      return;
    }
    actions.reset();
    setBaseBranch(null);
    // The app's own menu, on every platform: a branch row carries two buttons,
    // which a native popup cannot host. The desktop shell keeps the OS popup for
    // the right-click, where a plain list of names is what a pointer wants.
    openMenu();
  }

  // A plain folder has no branch, so there is nothing to show and nothing to switch.
  if (!branch) return null;

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>
      <button
        ref={buttonRef}
        type="button"
        className="chat-project-context chat-branch-context"
        style={{ maxWidth }}
        title={t("chat.branchChipTitle", { branch })}
        aria-label={t("chat.branchChip", { branch })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={openChipMenu}
        onContextMenu={(event) => {
          if (!canUseNativeMenu()) return;
          event.preventDefault();
          actions.reset();
          setBaseBranch(null);
          openNativeMenu();
        }}
      >
        <BranchIcon />
        <span>{branch}</span>
      </button>
      {open && (
        <ProjectContextMenu
          menuRef={menuRef}
          projectRoot={cwd}
          pos={pos}
          anchor={anchor}
          view={view}
          branchMenu={menu}
          branchLoading={loading}
          selectedCwd={cwd}
          switchingBranch={actions.switchingBranch}
          fetching={actions.fetching}
          worktreeBusy={actions.busy}
          worktreeError={actions.error}
          confirmRemove={actions.confirmRemove}
          newBranch={actions.newBranch}
          worktreeBaseBranch={baseBranch}
          canReveal={false}
          revealLabel=""
          projectRevealError={null}
          t={t}
          onShowNewWorktree={() => openWorktreeForm(baseBranch ?? "")}
          onReveal={() => {}}
          onArchive={() => {}}
          onRestore={() => {}}
          onSwitchBranch={(name) => void actions.switchBranch(cwd, name, menu ?? undefined, cwd)}
          onCreateWorktreeFromBranch={openWorktreeForm}
          onFetch={() => void actions.fetchBranches(cwd)}
          onSelectWorktree={(path) => {
            close();
            onWorktreeSelected?.(path);
          }}
          onRequestRemove={actions.requestRemove}
          onConfirmRemove={(removal) => void actions.remove(cwd, removal)}
          onCancelRemove={actions.cancelRemove}
          onNewBranchChange={actions.setNewBranch}
          onCreateWorktree={() => void actions.create(cwd, baseBranch ?? undefined)}
          onClose={close}
        />
      )}
    </div>
  );
}
