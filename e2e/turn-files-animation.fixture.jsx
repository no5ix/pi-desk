import { createRoot } from "react-dom/client";
import { TurnWrittenFiles } from "../components/TurnWrittenFiles";
import { I18nProvider } from "../hooks/useI18n";

/**
 * The real "Edited N files" card (`components/TurnWrittenFiles.tsx`) over the app's real
 * CSS, so the collapse is measured on the markup the transcript draws and not on a
 * hand-written copy of it.
 *
 * The card opens open (a finished turn shows its files). A click on the header folds the
 * rows away and unfolds them, and that is the whole of this fixture: the header band's
 * colour, the height transition, and the rows' fade.
 *
 * `/api/files/*` is answered by the harness (see `e2e/turn-files-animation.mjs`): the
 * card asks whether each file still exists, and a 404 there would mark every row as
 * removed — the dimmed, struck-through state, which is not what is being measured.
 */
const FILES = [
  { filePath: "/repo/app/native-theme.css", added: 14, removed: 15 },
  { filePath: "/repo/e2e/divider-hover.mjs", added: 77, removed: 23 },
  { filePath: "/repo/components/TurnWrittenFiles.tsx", added: 31, removed: 4 },
  { filePath: "/repo/docs/agents/fork-ui.md", added: 33, removed: 20 },
  { filePath: "/repo/lib/useResizablePanel.ts", added: 2, removed: 1 },
];

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "40px 20px" }}>
      <TurnWrittenFiles files={FILES} sessionId="fixture-session" onOpenFile={() => {}} />
    </main>
  </I18nProvider>,
);
