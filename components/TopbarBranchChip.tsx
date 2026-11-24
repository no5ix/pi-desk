"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BranchIcon, WorktreeIcon } from "./GitIcons";

const TIP_GAP = 6;
/** The tip never touches the window's edge. */
const TIP_MARGIN = 8;
/** A tip wider than this on a phone is clamped; long paths wrap instead. */
const TIP_MAX_WIDTH = 420;

/**
 * The conversation header's branch, and the tip that explains it.
 *
 * The branch name is the shortest thing in the header and the only one the user
 * cannot read anywhere else, so it is the label worth touching. It used to carry a
 * native `title`: Safari showed the raw i18n key (the key was missing), and on a
 * phone a native tooltip never opens, so the full name was unreachable exactly
 * where the name is cut in half. This is a real control: hover or focus on desktop,
 * tap on a phone, and a small tip appears with the whole branch name and the folder
 * it lives in — the same information the native tooltip was supposed to carry, in
 * the app's own surface.
 */
export function TopbarBranchChip({
  branch,
  projectRoot,
  isWorktree,
}: {
  branch: string;
  projectRoot: string;
  isWorktree: boolean;
}) {
  const { t } = useI18n();
  const tipId = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  // A phone has no hover: the tap is what opens the tip, and it stays until the
  // user taps it again, taps away, or presses Escape.
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pinned || hovered || focused;

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = tipRef.current?.getBoundingClientRect().width ?? 240;
    const left = Math.min(
      Math.max(TIP_MARGIN, rect.left),
      Math.max(TIP_MARGIN, window.innerWidth - width - TIP_MARGIN),
    );
    setPos({ top: rect.bottom + TIP_GAP, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, branch, projectRoot, isWorktree, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchorRef.current?.contains(target) || tipRef.current?.contains(target)) return;
      setPinned(false);
      setHovered(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPinned(false);
      setHovered(false);
      setFocused(false);
      anchorRef.current?.blur();
    };
    const onReflow = () => place();
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, place]);

  return (
    <span className="app-topbar-branch app-topbar-branch--chip">
      <button
        ref={anchorRef}
        type="button"
        className="app-topbar-branch-hit"
        aria-label={t(isWorktree ? "chat.gitWorktreeBranchTitle" : "chat.gitBranchTitle", {
          gitBranch: branch,
          projectRoot,
        })}
        aria-describedby={open ? tipId : undefined}
        onPointerEnter={(event) => {
          // A touch pointer enters and leaves with the tap; the click owns that case.
          if (event.pointerType === "touch") return;
          setHovered(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "touch") return;
          setHovered(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => setPinned((current) => !current)}
      >
        {/* The sidebar's branch glyph in a checkout, the worktree glyph in a linked
            worktree: the same branch name can mean both folders, and the header has to
            say which one this session works in. */}
        {isWorktree ? <WorktreeIcon /> : <BranchIcon />}
        <span>{branch}</span>
      </button>
      {open ? (
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          className="app-topbar-branch-tip"
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            maxWidth: `min(70vw, ${TIP_MAX_WIDTH}px)`,
            visibility: pos ? "visible" : "hidden",
          }}
        >
          <span className="app-topbar-branch-tip-label">
            {t(isWorktree ? "chat.branchTipWorktreeLabel" : "chat.branchTipBranchLabel")}
          </span>
          <span className="app-topbar-branch-tip-name">{branch}</span>
          {projectRoot ? (
            <span className="app-topbar-branch-tip-path">
              <span className="app-topbar-branch-tip-path-label">{t("chat.branchTipFolderLabel")}</span>
              {projectRoot}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
