import { useState } from "react";
import { createRoot } from "react-dom/client";
import { applySidebarFold, useProjectFold } from "@/lib/sidebar-fold-motion";

/**
 * The sidebar project fold, in a real browser.
 *
 * It reproduces the DOM contract the sidebar uses — `.sidebar-project-tree`,
 * `.sidebar-project-tree-group`, `.sidebar-project-tree-row`, and the folding
 * `.sidebar-project-tree-children` with the same `data-fold` values and the real CSS —
 * and drives it with the real module, one `useProjectFold` for the whole list as
 * components/SessionSidebar.tsx does. What matters here is the layout: the groups and
 * rows below a folding project are in the same column, so measuring this fixture measures
 * the sidebar's behaviour.
 */
const PROJECTS = [
  { root: "/repo/branchshift", name: "branchshift", sessions: 12 },
  { root: "/repo/pi-desk", name: "pi-desk", sessions: 3 },
];

function Project({ group, fold }) {
  const isCollapsed = fold.collapsed.has(group.root);
  const mounted = !isCollapsed || fold.closing.has(group.root);
  return (
    <div className="sidebar-project-tree-group">
      <button
        type="button"
        className="sidebar-project-tree-row"
        data-project={group.root}
        aria-expanded={!isCollapsed}
        onClick={() => fold.toggle(group.root)}
      >
        <span className="sidebar-project-tree-name">{group.name}</span>
      </button>
      {mounted ? (
        <div
          className="sidebar-project-tree-children"
          data-fold={isCollapsed ? "closing" : "opening"}
          ref={(element) => {
            if (!element) return;
            applySidebarFold(element, {
              closed: isCollapsed,
              animateOpen: fold.opening.has(group.root),
              onSettled: () => fold.settle(group.root),
            });
          }}
        >
          {Array.from({ length: group.sessions }, (_, index) => (
            <div key={index} className="session-item" data-sidebar-tree-row>
              {group.name} session {index + 1}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Fixture() {
  const [collapsed, setCollapsed] = useState(() => new Set());
  const fold = useProjectFold(collapsed);
  const view = {
    collapsed,
    closing: fold.closing,
    opening: fold.opening,
    settle: fold.settle,
    toggle: (root) => setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(root)) next.delete(root);
      else next.add(root);
      return next;
    }),
  };
  return (
    <div className="sidebar-project-tree">
      {PROJECTS.map((group) => (
        <Project key={group.root} group={group} fold={view} />
      ))}
      <div className="sidebar-footer-row" data-footer>
        Chats
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Fixture />);
