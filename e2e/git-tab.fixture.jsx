/**
 * Fixture for e2e/git-tab.mjs: the right panel's real tab strip, with the Git
 * tab among file and terminal tabs, mounted with the app's stylesheets.
 *
 * The strip is a scrollable row of shrink-to-fit tabs. A tab that carries a
 * count, plus the little `x` that closes it, is a row of boxes that the CSS has
 * to keep on one line and one baseline: measured, not eyeballed.
 */
import { createRoot } from "react-dom/client";
import { I18nProvider } from "@/hooks/useI18n";
import { TabBar } from "@/components/TabBar";

const TABS = [
  { id: "file-1", label: "session-file-diff.ts", filePath: "/repo/lib/session-file-diff.ts", kind: undefined, dirty: true },
  { id: "file-2", label: "native-theme.css", filePath: "/repo/app/native-theme.css" },
  { id: "terminal-1", label: "pi-desk", filePath: "/repo", kind: "terminal" },
  // The count the tab carries: the working tree's changed files. The query lets
  // the runner ask for a three-digit count and watch it cap.
  { id: "git:panel", label: "Git", filePath: "/repo", kind: "git", badge: Number(new URLSearchParams(window.location.search).get("badge") ?? 3) },
];

function App() {
  return (
    <I18nProvider>
      <div className="app-main-column" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        <div className="right-panel-tab-strip" data-testid="strip">
          <div className="file-tab-bar-slot">
            <TabBar
              tabs={TABS}
              activeTabId="file-1"
              onSelectTab={(id) => { window.pickedTab = id; }}
              onCloseTab={(id) => { window.closedTab = id; }}
              onNewTerminal={() => { window.pickedTab = "new-terminal"; }}
              onReorderTab={() => {}}
            />
          </div>
          <button type="button" className="file-workbench-icon-button file-tree-toggle"><span>files</span></button>
        </div>
      </div>
    </I18nProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
