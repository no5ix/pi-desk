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
const chip = readFileSync(new URL("./TopbarBranchChip.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const projectChip = readFileSync(new URL("./TopbarProjectChip.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const tip = readFileSync(new URL("./TopbarTip.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const hook = readFileSync(new URL("../hooks/useProjectBranch.ts", import.meta.url), "utf8");

test("the title and the project line keep their positions in the title block", () => {
  const block = appShell.match(/<div className="app-topbar-title"[\s\S]*?<\/div>/);
  assert.ok(block, "topbar title block found");
  assert.match(block[0], /<span>\{topBarTitle\}<\/span>/, "the title stays the first span child");
  assert.match(block[0], /className="app-topbar-subtitle-row"/, "the project line is a row inside the title block");
  assert.match(block[0], /<TopbarProjectChip name=\{topBarSubtitle\} path=\{visibleProjectCwd \?\? ""\} \/>/,
    "the project name is a chip, and its path is the folder the session works in");
  assert.match(projectChip, /<small className="app-topbar-project app-topbar-project--chip">[\s\S]*<span>\{name\}<\/span>/,
    "it stays a <small>, so the narrow-screen rule that hid the row still hides it");
});

test("the branch label reads the session first, then the project directory", () => {
  assert.match(appShell, /import \{ useProjectBranch, invalidateProjectBranch \} from "@\/hooks\/useProjectBranch";/);
  assert.match(appShell, /const activeProjectBranch = useProjectBranch\(\s*isChatWorkspaceActive \|\| pageOpen \|\| selectedSession \? null : visibleProjectCwd,\s*\);/,
    "a selected session asks the endpoint for nothing: it already carries its branch");
  assert.match(appShell, /const topBarBranch = isChatWorkspaceActive \|\| pageOpen\s*\?\s*null\s*:\s*selectedSession\?\.branch \?\? activeProjectBranch;/);
  assert.match(chip, /className="app-topbar-branch app-topbar-branch--chip"/, "the row's branch label is the chip's");
});

test("the branch is a control that opens a tip, and nothing renders where there is no branch", () => {
  assert.match(appShell, /\{topBarBranch && \(\s*(?:\/\/[^\n]*\n\s*)*<TopbarBranchChip\n\s*branch=\{topBarBranch\}\n\s*projectRoot=\{activeCwd \?\? ""\}\n\s*isWorktree=\{Boolean\(selectedSession\?\.isWorktree\)\}\n\s*\/>/, "no branch, no element");
  assert.match(appShell, /const visibleProjectCwd = isChatWorkspaceActive \? null : activeCwd;/,
    "a chat has no project, so no branch");
  // The tip, not a native tooltip: Safari showed the raw i18n key (the key was
  // missing) and a phone never opens a native one, so the full name was
  // unreachable exactly where the row cuts it. The plumbing is shared with the
  // project chip, so it lives in TopbarTip.tsx.
  assert.ok(!/className="app-topbar-branch"[\s\S]{0,400}?title=\{/.test(appShell), "no native title is left in the shell");
  assert.match(tip, /role="tooltip"/);
  assert.match(tip, /"aria-describedby": open \? tipId : undefined,/);
  assert.match(tip, /onPointerEnter: \(event: React\.PointerEvent\) => \{[\s\S]*?if \(event\.pointerType === "touch"\) return;/,
    "a touch pointer is owned by the click, so a tap does not fight the hover");
  assert.match(tip, /onFocus: \(\) => setFocused\(true\)/, "the keyboard opens it");
  assert.match(tip, /onClick: \(\) => setPinned\(\(current\) => !current\)/, "a tap opens it on a phone");
  assert.match(tip, /if \(event\.key !== "Escape"\) return;/);
  assert.match(tip, /document\.addEventListener\("pointerdown", onPointerDown, true\)/, "a tap elsewhere closes it");
  assert.match(chip, /<TopbarTipRow\n\s*label=\{t\(isWorktree \? "chat\.branchTipWorktreeLabel" : "chat\.branchTipBranchLabel"\)\}\n\s*value=\{branch\}/,
    "the tip carries the whole name");
  assert.ok(!chip.includes("branchTipFolderLabel") && !chip.includes("projectRoot} }"),
    "the branch tip names the branch and nothing else: the project label in front of it carries the path");
  assert.match(tip, /maxWidth: `min\(70vw, \$\{TIP_MAX_WIDTH\}px\)`/, "the tip is clamped, so long values wrap inside it");
  assert.match(css, /\.app-topbar-tip \{\n\s*position: fixed;\n\s*z-index: var\(--z-popover\);/);
  assert.match(css, /\.app-topbar-tip-value \{[\s\S]*?white-space: normal;\n\s*overflow-wrap: anywhere;/,
    "the tip never ellipsizes — cutting the name in the tip defeats the tip");
  assert.ok(!/\.app-topbar-tip-value \{[^}]*text-overflow: ellipsis/.test(css), "no ellipsis in the tip");
  assert.match(css, /\.app-topbar-branch-hit:hover \{[\s\S]*?background: var\(--bg-hover\);/);
});

test("the project label opens the same tip with the folder it points at", () => {
  // The branch tip used to carry the folder line; the user wants it on the project label
  // that names the folder, where it belongs, and the branch tip left with one value.
  assert.match(projectChip, /<TopbarTipRow label=\{t\("chat\.projectTipPathLabel"\)\} value=\{path\} \/>/);
  assert.match(projectChip, /className="app-topbar-project-hit"/);
  assert.match(projectChip, /aria-label=\{t\("chat\.projectTipTitle", \{ projectRoot: path \}\)\}/, "and says it to a screen reader");
  assert.match(projectChip, /\{open && path \? \(/, "no path, no tip");
  assert.match(projectChip, /<svg width="13" height="13"[\s\S]*?m6 14 1\.5-2\.9/,
    "the sidebar's folder glyph, so the header and the project tree read as one object");
  assert.match(css, /\.app-topbar-project-hit,\n\.app-topbar-branch-hit \{/,
    "the project chip's button shares the branch chip's control styling");
});

test("every locale can say what the tip says", () => {
  // The header's native title once showed `chat.gitBranchTitle` because the key
  // existed in no catalogue. The tip's labels are keys too, so they are pinned.
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    const messages = readFileSync(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8");
    for (const key of ["chat.gitBranchTitle", "chat.gitWorktreeBranchTitle", "chat.branchTipBranchLabel",
      "chat.branchTipWorktreeLabel", "chat.projectTipPathLabel", "chat.projectTipTitle"]) {
      assert.match(messages, new RegExp(`"${key}": `), `${locale} has ${key}`);
    }
    assert.match(messages, /"chat\.projectTipPathLabel": "[^"]+"/, `${locale} labels the path row`);
    assert.match(messages, /"chat\.projectTipTitle": "[^"]*\{projectRoot\}[^"]*"/, `${locale} names the project's folder`);
    assert.match(messages, /"chat\.gitBranchTitle": "[^"]*\{gitBranch\}[^"]*\{projectRoot\}[^"]*"/, `${locale} names the branch and the folder`);
  }
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
  assert.match(appShell, /<span className="app-topbar-subtitle-row">\n\s*(?:\/\*[^]*?\*\/\s*)?\{topBarProjectIcon \? \(/);
});

test("the branch name says which checkout it is: branch glyph, worktree glyph", () => {
  // The same branch name can live in the repo and in a linked worktree, and the
  // header is the only place a session says where it runs.
  assert.match(chip, /\{isWorktree \? <WorktreeIcon \/> : <BranchIcon \/>\}/);
  assert.match(chip, /t\(isWorktree \? "chat\.gitWorktreeBranchTitle" : "chat\.gitBranchTitle",/, "and says it to a screen reader too");
  assert.match(appShell, /isWorktree=\{Boolean\(selectedSession\?\.isWorktree\)\}/, "the shell only says which kind this is");
  assert.match(chip, /import \{ BranchIcon, WorktreeIcon \} from "\.\/GitIcons";/,
    "the glyphs are the sidebar's own, shared with the composer's chip");
});

test("the project row ends with the clock, then the subagent counts", () => {
  const row = appShell.match(/<span className="app-topbar-subtitle-row">[\s\S]*?<\/span>\s*\)\}/);
  assert.ok(row, "the project row renders");
  const at = (needle) => row[0].indexOf(needle);
  assert.ok(at("<TopbarProjectChip") < at("<TopbarBranchChip"), "project, then branch");
  assert.ok(at("<TopbarBranchChip") < at("<TopbarElapsed"), "branch, then the clock");
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

test("the project row is not cut off while the bar has room", () => {
  // All four labels live inside `.app-topbar-title`, and the bar's actions push with
  // `margin-left: auto`, which takes the free space before flex-grow does — so this
  // column is sized by its own content and every cap on it truncated the row. It was
  // 420px, then 240px at 1120px (`pi-desk  fe…` in a window with room to spare).
  assert.match(css, /\.app-topbar-title \{[\s\S]*?max-width: none;/, "the desktop column is as wide as the bar allows");
  assert.ok(!/\.app-topbar-title \{\n\s*max-width: (420px|240px|160px);/.test(css), "no fixed cap is left on the column");
  // The session title is the label that gives way: its text is kept out of the
  // column's intrinsic width so the project row is what sizes it.
  assert.match(css, /\.app-topbar-title > span:not\(\.app-topbar-subtitle-row\) \{\n\s*width: 0;\n\s*min-width: 100%;/, "the title ellipsizes, not the row");
  // Nothing grows, so the labels sit together and the clock and the counts stay behind
  // the branch they describe.
  assert.match(css, /\.app-topbar-branch \{[\s\S]*?flex: 0 1 auto;/, "the branch takes its own width");
  assert.ok(!/\.app-topbar-branch \{\n\s*flex: 1 1 0;/.test(css), "a growing branch pushes the clock to the far edge");
  // A narrow window keeps the labels on one line and the branch is what shrinks.
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.app-topbar-title \{\s*(?:\/\*[\s\S]*?\*\/\s*)?max-width: min\(72vw, 560px\);/,
    "a 900px window gets room for the four labels");
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.app-topbar-title \{\s*(?:\/\*[\s\S]*?\*\/\s*)?max-width: min\(78vw, 420px\);/,
    "a phone gets the most the bar can spare");
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.app-topbar-subtitle-row \{[\s\S]*?flex-wrap: nowrap;/,
    "a phone keeps one line: three stacked header lines are worse than a cut branch, whose name the tip carries");
  assert.match(css, /\.app-topbar-project \{[\s\S]*?min-width: 5\.5em;/, "the project keeps a few characters and its icon");
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
