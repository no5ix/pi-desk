import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// The conversation header shows the git branch beside the project name:
// `[folder] project  [branch] main`. The header keeps its contract: the title stays the
// first `> span` child (components/message-search-anchors.test.mjs and the title
// feedback in e2e/desktop-extensions-build.mjs read it), and the project line stays a
// `<small>` inside the title block, so the mobile query that hides `> small` hides it.

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const hook = readFileSync(new URL("../hooks/useProjectBranch.ts", import.meta.url), "utf8");

test("the title and the project line keep their positions in the title block", () => {
  const block = appShell.match(/<div className="app-topbar-title"[\s\S]*?<\/div>/);
  assert.ok(block, "topbar title block found");
  assert.match(block[0], /<span>\{topBarTitle\}<\/span>/, "the title stays the first span child");
  assert.match(block[0], /className="app-topbar-subtitle-row"/, "the project line is a row inside the title block");
  assert.match(block[0], /<small className="app-topbar-project">[\s\S]*<span>\{topBarSubtitle\}<\/span>/,
    "the project name stays a <small>, so the narrow-screen rule that hid it still hides the row");
});

test("the branch label reads the session first, then the project directory", () => {
  assert.match(appShell, /import \{ useProjectBranch \} from "@\/hooks\/useProjectBranch";/);
  assert.match(appShell, /const activeProjectBranch = useProjectBranch\(\s*isChatWorkspaceActive \|\| pageOpen \|\| selectedSession \? null : visibleProjectCwd,\s*\);/,
    "a selected session asks the endpoint for nothing: it already carries its branch");
  assert.match(appShell, /const topBarBranch = isChatWorkspaceActive \|\| pageOpen\s*\?\s*null\s*:\s*selectedSession\?\.branch \?\? activeProjectBranch;/);
  assert.match(appShell, /className="app-topbar-branch"/);
});

test("the branch is a plain label, and nothing renders where there is no branch", () => {
  assert.match(appShell, /\{topBarBranch && \(\s*<small\s+className="app-topbar-branch"/, "no branch, no element");
  const chip = appShell.match(/<small\s+className="app-topbar-branch"[\s\S]*?<\/small>/);
  assert.ok(chip, "branch chip renders");
  assert.doesNotMatch(chip[0], /onClick|role="button"/, "it is a label, not a control");
  assert.match(appShell, /const visibleProjectCwd = isChatWorkspaceActive \? null : activeCwd;/,
    "a chat has no project, so no branch");
});

test("the branch line is styled in the fork CSS, like the sidebar's branch meta", () => {
  assert.match(css, /\.app-topbar-subtitle-row \{[\s\S]*?display: flex;/);
  assert.match(css, /\.app-topbar-branch \{[\s\S]*?font-family: var\(--font-mono\);/);
  assert.match(css, /\.app-topbar-title > small \{[\s\S]*?font-size: var\(--fs-caption\);/);
  assert.match(css, /\.app-topbar-subtitle-row \{\s*display: none;/, "the mobile query hides the whole row, as it hid <small>");
});

test("the branch endpoint and the client cache behind it", () => {
  const route = readFileSync(new URL("../app/api/worktrees/route.ts", import.meta.url), "utf8");
  assert.match(route, /branch: project\.branch/, "no extra git call for the header");
  assert.match(hook, /fetch\(`\/api\/worktrees\?cwd=\$\{encodeURIComponent\(cwd\)\}`, \{ cache: "no-store" \}\)/);
  assert.match(hook, /if \(!data \|\| data\.isGit !== true\) return null;/, "a plain folder answers null");
  assert.match(hook, /return typeof data\.branch === "string" && data\.branch \? data\.branch : null;/, "a detached HEAD answers null");
  assert.match(hook, /const CLIENT_CACHE_TTL_MS = 60_000;/, "the server caches the project for the same window");
  assert.match(hook, /export function invalidateProjectBranch\(cwd: string\)/, "a branch switch can drop the cached value");
});
