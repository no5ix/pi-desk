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
  assert.match(appShell, /import \{ useProjectBranch, invalidateProjectBranch \} from "@\/hooks\/useProjectBranch";/);
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
  const narrow = css.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/);
  assert.ok(narrow, "the narrow-screen block exists");
  assert.match(narrow[0], /\.app-topbar-title > small \{\s*display: none;/, "the one-line subtitle the row replaced stays hidden");
  assert.doesNotMatch(narrow[0], /\.app-topbar-subtitle-row \{\s*display: none;/,
    "the row shows on a phone: it carries the project, the branch and the running clock under the session name");
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

test("the hydration render shows no branch, so React keeps the tree", () => {
  // The server has no session state and the client's first render must not have one
  // either: a warm module cache read during the first render paints a branch the HTML
  // does not contain, and React throws the topbar subtree away (the same class of failure
  // hooks/useResizablePanel.ts and hooks/useI18n.tsx guard with a mounted flag).
  assert.match(hook, /const \[branch, setBranch\] = useState<string \| null>\(null\);/);
  assert.ok(!/useState<string \| null>\(\(\) =>/.test(hook), "the first render reads no cache");
  assert.match(hook, /const fresh = cache\.get\(cwd\);\n\s*if \(fresh && Date\.now\(\) - fresh\.at < CLIENT_CACHE_TTL_MS\) \{\n\s*setBranch\(fresh\.branch\);/,
    "the cache is still served, from the effect");
  assert.match(appShell, /<div className="app-topbar-title" title=\{topBarTitle\}>\n\s*<span>\{topBarTitle\}<\/span>/,
    "the title stays the first child: e2e/title-feedback reads it");
  assert.match(appShell, /<span className="app-topbar-subtitle-row">\n\s*<small className="app-topbar-project">/);
});

test("the branch name says which checkout it is: branch glyph, worktree glyph", () => {
  // The same branch name can live in the repo and in a linked worktree, and the
  // header is the only place a session says where it runs.
  assert.match(appShell, /\{selectedSession\?\.isWorktree \? <WorktreeIcon \/> : <BranchIcon \/>\}/);
  assert.match(appShell, /selectedSession\?\.isWorktree \? "chat\.gitWorktreeBranchTitle" : "chat\.gitBranchTitle"/);
  assert.match(appShell, /import \{ BranchIcon, WorktreeIcon \} from "\.\/GitIcons";/,
    "the glyphs are the sidebar's own, shared with the composer's chip");
});

test("the project row ends with the clock, then the subagent counts", () => {
  const row = appShell.match(/<span className="app-topbar-subtitle-row">[\s\S]*?<\/span>\s*\)\}/);
  assert.ok(row, "the project row renders");
  const at = (needle) => row[0].indexOf(needle);
  assert.ok(at('className="app-topbar-project"') < at('className="app-topbar-branch"'), "project, then branch");
  assert.ok(at('className="app-topbar-branch"') < at("<TopbarElapsed"), "branch, then the clock");
  assert.ok(at("<TopbarElapsed") < at("<TopbarSubagents"), "the counts come last: they are what wraps");
});

test("the subagent counts are the active family's, and clicking opens the agents panel", () => {
  assert.match(appShell, /countSubagents\(activeSessionFamily, runningSessionIds\)/);
  assert.match(appShell, /<TopbarSubagents\n\s*counts=\{topBarSubagents\}\n\s*onOpenAgents=\{\(\) => toggleTopPanel\("agents"\)\}/);
  // The buckets are exclusive and read the live running set first.
  const counter = readFileSync(new URL("./TopbarSubagents.tsx", import.meta.url), "utf8");
  // A session with no subagent runs renders nothing — the row is not a scoreboard.
  assert.match(counter, /if \(counts\.total === 0\) return null;/);
  assert.match(counter, /if \(runningIds\.has\(session\.id\) \|\| status === "running" \|\| status === "queued"\) \{\n\s*counts\.running \+= 1;/);
  assert.match(counter, /status === "aborted" \|\| status === "failed" \|\| status === "interrupted"/,
    "a failed or stopped run is not a completed one");
  assert.match(counter, /session\.relation\?\.kind === "subagent" \? session\.relation\.status : undefined/,
    "only a subagent relation carries a status");
});

test("the chip prints the buckets, not a total", () => {
  const counter = readFileSync(new URL("./TopbarSubagents.tsx", import.meta.url), "utf8");
  // [subagent icon] [completed icon]N [aborted icon]N [running icon]N. The three
  // buckets are the total; a number after the glyph only took width from the row.
  assert.ok(!counter.includes("app-topbar-subagents-total"), "no total number");
  assert.ok(!css.includes(".app-topbar-subagents-total"), "and no rule for it");
  assert.match(counter, /<AgentIcon \/>\s*\{counts\.completed > 0 && \(/, "the glyph is followed by the completed bucket");
  assert.match(counter, /className="app-topbar-subagent-count is-aborted"[\s\S]*?<svg/, "the aborted bucket carries the Agents panel's stop glyph");
  assert.ok(!counter.includes("app-topbar-subagent-dot"), "the status dot is not the aborted icon");
  assert.match(counter, /title=\{translate\("chat\.subagentsAborted", counts\)\}/, "each bucket says what it counts");
});

test("a full row wraps the counts to a second line, and the bar grows with them", () => {
  assert.match(css, /\.app-topbar-subtitle-row \{\n\s*flex-wrap: wrap;/, "the row wraps");
  assert.match(css, /\.app-topbar-subagents \{[\s\S]*?flex: 0 0 auto;/, "the chip is never squeezed away");
  assert.match(css, /\.app-topbar-subagent-count\.is-completed \{\n\s*color: var\(--success\);/, "the palette of the sidebar's dots");
  assert.match(css, /\.app-topbar-subagent-count\.is-aborted \{\n\s*color: var\(--warning\);/);
  assert.match(css, /\.app-topbar-subagent-count\.is-running \{\n\s*color: var\(--color-accent\);/);
  // A fixed height would clip the wrapped line into the chat; the bar is a floor.
  assert.match(appShell, /flexShrink: 0, minHeight: "calc\(36px \+ env\(safe-area-inset-top\)\)"/);
  assert.doesNotMatch(appShell, /flexShrink: 0, height: "calc\(36px \+ env\(safe-area-inset-top\)\)"/);
  assert.match(css, /html\[data-standalone-safe-area\] \.app-topbar:has\(\.app-topbar-subtitle-row > :nth-child\(4\)\) \{[\s\S]*?height: auto !important;/,
    "the phone's bar, which is pinned to 48px, is released when the row wraps");
});

test("the header's branch is polled, so a checkout outside pi shows up", () => {
  assert.match(hook, /const POLL_INTERVAL_MS = 3_000;/);
  assert.match(hook, /fetch\(`\/api\/worktrees\/branch\?cwd=\$\{encodeURIComponent\(cwd\)\}`/,
    "the poll reads the cheap branch endpoint, not the whole project resolve");
  assert.match(hook, /setBranch\(\(previous\) => \(previous === value \? previous : value\)\)/,
    "an unchanged branch never re-renders the shell");
  assert.match(hook, /document\.addEventListener\("visibilitychange", onVisible\)/, "a tab that comes back checks at once");
  const route = readFileSync(new URL("../app/api/worktrees/branch/route.ts", import.meta.url), "utf8");
  assert.match(route, /readCurrentBranch/, "one short git rev-parse");
  assert.match(route, /isCwdAllowed/, "the endpoint is behind the file-access gate");
});
