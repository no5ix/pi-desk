import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProjectContextMenuPanel } from "@/components/ProjectContextMenu.tsx";
import { placeMenuWithinViewport } from "@/lib/menu-placement";

/**
 * The branch chip's open flow, in a real browser.
 *
 * The composer's control row sits at the bottom of the window, which is exactly
 * where the flash happened: the menu was placed below the chip for the height of
 * the loading shape, and flipped above when the branch list arrived. This mounts
 * the real panel at the bottom of the viewport, places it the way the chip places
 * it (the menu's own width and the height its list settles at), and swaps the
 * loading state for the loaded list 250ms later — the same delay the fixture's
 * stubbed `/api/worktrees` uses. e2e/branch-menu-rows.mjs measures the side the
 * menu is on before and after that swap: it must not change.
 */
const t = (key, params) => (params ? `${key}(${Object.values(params).join(",")})` : key);

const ROOT = "/repo";
const MENU_WIDTH = 240;
const MENU_EXPECTED_HEIGHT = Math.min(560, Math.round(window.innerHeight * 0.7));

const loadingMenu = { root: ROOT, isGit: true, branches: [], remoteBranches: [], worktrees: [], loaded: false, loading: true };
const loadedMenu = {
  root: ROOT,
  isGit: true,
  branches: ["main", "fix/first-click-delayed-scroll", "fix/heading-scroll-offset"],
  remoteBranches: [
    "claude/revert-readme-video-intro",
    "claude/github-readme-video-intro-303e64",
    "claude/settings-layout-review-8265af",
    "claude/conversation-list-optimization-9ec111",
  ],
  worktrees: [{ path: ROOT, branch: "main", isMain: true }],
  loaded: true,
};

function Chip() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [anchor, setAnchor] = useState(null);
  const [menu, setMenu] = useState(loadingMenu);

  const onClick = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    // The chip's own rule: place for the size the list settles at, so the first
    // paint is on the side the menu ends on.
    setPos(placeMenuWithinViewport(
      { top: rect.top, bottom: rect.bottom, right: rect.right },
      { width: MENU_WIDTH, height: MENU_EXPECTED_HEIGHT },
      { width: window.innerWidth, height: window.innerHeight },
    ));
    setAnchor({ top: rect.top, bottom: rect.bottom, right: rect.right });
    setMenu(loadingMenu);
    setOpen(true);
    setTimeout(() => setMenu(loadedMenu), 250);
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div style={{ display: "flex", gap: 6, padding: "8px 12px" }}>
        <button type="button" className="chat-project-context chat-branch-context" onClick={onClick}>
          <span>main</span>
        </button>
      </div>
      {open && anchor && (
        <ProjectContextMenuPanel
          menuRef={{ current: null }}
          projectRoot={ROOT}
          pos={pos}
          anchor={anchor}
          view="branches"
          branchMenu={menu}
          selectedCwd={ROOT}
          canReveal={false}
          revealLabel="Reveal"
          projectRevealError={null}
          t={t}
          onSwitchBranch={() => {}}
          onFetch={() => {}}
          onCreateWorktreeFromBranch={() => {}}
          onReveal={() => {}}
          onArchive={() => {}}
          onRestore={() => {}}
          onTogglePin={() => {}}
          onDeleteSessions={() => {}}
        />
      )}
    </div>
  );
}

export function renderFixture(root) {
  createRoot(root).render(<Chip />);
}

const mount = typeof document !== "undefined" ? document.getElementById("root") : null;
if (mount) renderFixture(mount);
