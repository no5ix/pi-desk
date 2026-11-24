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
const gitIcons = readFileSync(new URL("./GitIcons.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const hook = readFileSync(new URL("../hooks/useProjectBranch.ts", import.meta.url), "utf8");

test("the title and the project line keep their positions in the title block", () => {
  const block = appShell.match(/<div className="app-topbar-title"[\s\S]*?<\/div>/);
  assert.ok(block, "topbar title block found");
  assert.match(block[0], /<span>\{topBarTitle\}<\/span>/, "the title stays the first span child");
  assert.match(block[0], /className="app-topbar-subtitle-row"/, "the project line is a row inside the title block");
  assert.match(block[0], /<TopbarProjectChip name=\{topBarSubtitle\} path=\{visibleProjectCwd \?\? ""\} branch=\{topBarBranch\} isWorktree=\{headerProjectIsWorktree\} \/>/,
    "the project name is a chip, its path is the folder the session works in, and its glyph is asked of the branch");
  assert.match(projectChip, /<small className="app-topbar-project app-topbar-project--chip">[\s\S]*<span>\{name\}<\/span>/,
    "it stays a <small>, so the narrow-screen rule that hid the row still hides it");
});

test("the branch label reads the session first, then the project directory", () => {
  assert.match(appShell, /import \{ useProjectBranch, useProjectIdentity, invalidateProjectBranch \} from "@\/hooks\/useProjectBranch";/);
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
  assert.match(css, /\.app-topbar-branch-hit:hover,[\s\S]*?background: var\(--bg-hover\);/,
    "the branch chip's hover wash, shared by the project and context chips");
});

test("the project label opens the same tip with the folder it points at", () => {
  // The branch tip used to carry the folder line; the user wants it on the project label
  // that names the folder, where it belongs, and the branch tip left with one value.
  assert.match(projectChip, /<TopbarTipRow label=\{t\("chat\.projectTipPathLabel"\)\} value=\{path\} \/>/);
  assert.match(projectChip, /className="app-topbar-project-hit"/);
  assert.match(projectChip, /aria-label=\{t\("chat\.projectTipTitle", \{ projectRoot: path \}\)\}/, "and says it to a screen reader");
  assert.match(projectChip, /\{open && path \? \(/, "no path, no tip");
  assert.match(projectChip, /\{isWorktree && branchOwnsWorktreeFolder\(path, branch\) \? <WorktreeIcon size=\{13\} \/> : \(\s*<ProjectFolderIcon size=\{13\} \/>\s*\)\}/,
    "the project label is the chip that says which folder this is: the checkout glyph in a linked worktree, the project folder everywhere else");
  assert.match(gitIcons, /m6 14 1\.5-2\.9/,
    "the sidebar's folder shape, so the header, the project tree and the branch list's project glyph are one drawing in one file");
  assert.match(css, /\.app-topbar-project-hit,\n\.app-topbar-branch-hit,\n\.app-topbar-context-hit \{/,
    "all three header controls share one styling block — a new chip joins the family, it does not grow its own");
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

test("the branch name wears the branch glyph, and the folder is the words' job", () => {
  // The screenshot: `[folder] pi-desk  [worktree] wt/wt-branch-picker-header-worktrees`.
  // One row, the same glyph twice, and a claim about the folder made in front of a
  // branch name — the project chip in front already says which folder this session
  // works in, with its own tip. What sits in front of a branch is "this is a branch",
  // and the branch glyph is the shape the sidebar, the composer's chip and the branch
  // list all use for that. The folder fact stays in the words, where a phone can read it.
  assert.match(chip, /<BranchIcon \/>\s*<span>\{branch\}<\/span>/,
    "one glyph, the branch's, on every branch");
  assert.ok(!chip.includes("WorktreeIcon"), "no worktree glyph in the branch chip");
  assert.ok(!chip.includes("branchOwnsWorktreeFolder"), "and no folder rule for it to ask");
  assert.match(chip, /t\(isWorktree \? "chat\.gitWorktreeBranchTitle" : "chat\.gitBranchTitle",/, "and says it to a screen reader too");
  assert.match(chip, /label=\{t\(isWorktree \? "chat\.branchTipWorktreeLabel" : "chat\.branchTipBranchLabel"\)\}/,
    "the tip names the kind, in words");
  assert.match(appShell, /isWorktree=\{Boolean\(selectedSession\?\.isWorktree\)\}/, "the shell only says which kind this is");
  assert.match(chip, /import \{ BranchIcon \} from "\.\/GitIcons";/,
    "the glyph is the sidebar's own, shared with the composer's chip and the branch list");
});

test("the project row carries the runs, then the clock, then the context", () => {
  const row = appShell.match(/<span className="app-topbar-subtitle-row">[\s\S]*?<\/span>\s*\)\}/);
  assert.ok(row, "the project row renders");
  const at = (needle) => row[0].indexOf(needle);
  assert.ok(at("<TopbarProjectChip") < at("<TopbarBranchChip"), "project, then branch");
  assert.ok(at("<TopbarBranchChip") < at("<TopbarSubagents"), "then the family's runs, right behind the branch");
  assert.ok(at("<TopbarSubagents") < at("<TopbarElapsed"), "then the clock: the counts are the work, the clock is its tail");
  assert.ok(at("<TopbarElapsed") < at("<TopbarContextChip"), "and the context ring closes the row");
});

test("the family chip counts subagents and side chats apart, in one button", () => {
  assert.match(appShell, /countSubagents\(activeSessionFamily, runningSessionIds\)/);
  assert.match(appShell, /countSideChats\(activeSessionFamily, runningSessionIds\)/);
  assert.match(appShell, /<TopbarSubagents\n\s*subagents=\{topBarSubagents\}\n\s*sideChats=\{topBarSideChats\}\n\s*onOpenAgents=\{\(\) => toggleTopPanel\("agents"\)\}/);
  const counter = readFileSync(new URL("./TopbarSubagents.tsx", import.meta.url), "utf8");
  // A family with neither kind of member renders nothing — the row is not a scoreboard.
  assert.match(counter, /if \(subagents\.total \+ sideChats\.total === 0\) return null;/);
  // A family's list carries both kinds (ADR 0007); a member is counted in one kind only,
  // so "6 runs" never mixes a delegated run with a conversation the user opened.
  assert.match(counter, /if \(relation\?\.kind !== kind\) continue;/);
  assert.match(counter, /countFamilyMembers\(family, runningIds, "subagent"\)/);
  assert.match(counter, /export function countSideChats[\s\S]*?countFamilyMembers\(family, runningIds, "side"\)/);
  // The buckets are exclusive and read the live running set first.
  assert.match(counter, /if \(runningIds\.has\(session\.id\) \|\| status === "running" \|\| status === "queued"\) \{\n\s*counts\.running \+= 1;/);
  assert.match(counter, /status === "aborted" \|\| status === "failed" \|\| status === "interrupted"/,
    "a failed or stopped run is not a completed one");
  // One button: the two groups open the same panel, so one control. Two would be two
  // targets for one action and two tab stops on the phone's keyboard.
  assert.equal((counter.match(/\n\s*role="button"/g) ?? []).length, 1, "one button, not one per kind");
  assert.equal((counter.match(/onClick=\{onOpenAgents\}/g) ?? []).length, 1);
  assert.match(counter, /const title = parts\.join\(" · "\);\n\s*return \(/,
    "the accessible name says both sentences, so a screen reader hears the whole chip");
  // Two groups, each led by the glyph its kind already wears elsewhere in the app.
  assert.match(counter, /className="app-topbar-family-group"[^>]*>\s*<AgentIcon \/>/);
  assert.match(counter, /className="app-topbar-family-group app-topbar-family-group--side"[^>]*>\s*<SideChatIcon \/>/);
  assert.match(counter, /<path d="M21 12a8 8 0 0 1-8 8H5\.5a2 2 0 0 1-1\.4-3\.4A8 8 0 1 1 21 12z" \/>\s*<path d="M13 8\.5v7M9\.5 12h7" \/>/,
    "the side-chat glyph is the composer's and the sidebar's, not a new drawing");
  // The chip is a control, so it takes the row's pill: hovering it washes both groups,
  // the same way the branch's label does.
  const chipRule = css.match(/\.app-topbar-subagents \{[^}]*\}/);
  assert.ok(chipRule, "the chip has its rule");
  assert.match(chipRule[0], /padding: 1px 4px;/, "the same pill the project and the branch wear");
  assert.match(chipRule[0], /color: var\(--text-muted\);/, "muted at rest");
  const chipHover = css.match(/\.app-topbar-subagents:hover \{[^}]*\}/);
  assert.ok(chipHover, "hover has a rule");
  assert.match(chipHover[0], /background: var\(--bg-hover\);/, "the row's wash, across the whole chip");
  assert.match(chipHover[0], /color: var\(--text\);/);
  // The side-chat group is gray in the row of gray glyphs — an accent glyph inside a chip
  // that is one control reads as a second, live control — and the hover lights it.
  const side = css.match(/\.app-topbar-family-group--side \{[^}]*\}/);
  assert.ok(side, "the side group has a rest colour");
  assert.match(side[0], /color: var\(--text-dim\);/, "gray at rest");
  assert.ok(!/color: var\(--accent\);/.test(side[0]), "not accent at rest");
  const sideLit = css.match(/\.app-topbar-subagents:hover \.app-topbar-family-group--side,[\s\S]*?\{[^}]*\}/);
  assert.ok(sideLit, "the hover lights the side-chat glyph and its count");
  assert.match(sideLit[0], /color: var\(--accent\);/);
  assert.match(sideLit[0], /:focus-visible/, "and the keyboard does the same");
  // The keyboard gets the pointer's answer, not a bare outline: the pill is the pressed
  // state, and Tab reaches the chip exactly once.
  const focusRule = css.match(/\.app-topbar-subagents:focus-visible \{[^}]*\}/);
  assert.ok(focusRule, "focus has a rule");
  assert.match(focusRule[0], /background: var\(--bg-hover\);/, "focus wears the pill");
  assert.match(focusRule[0], /outline: 2px solid var\(--focus-ring\);/);
  assert.match(css, /\.app-topbar-subagents:focus-visible \.app-topbar-family-group--side \{\s*color: var\(--accent\);\s*\}/,
    "and lights the side-chat group");
  const groups = css.match(/\.app-topbar-family-group \+ \.app-topbar-family-group \{[^}]*\}/);
  assert.ok(groups, "the groups sit apart: two sentences, not six numbers");
  assert.match(groups[0], /margin-left: 10px;/);
  // No rule between the groups: they are one control, and a divider inside a button reads
  // as two controls (the row the user pointed at).
  assert.ok(!groups[0].includes("border-left"), "no divider inside the one button");
  assert.ok(!css.includes(".app-topbar-family-group--side::before"), "no divider pseudo-element");
  for (const loc of ["en", "zh-CN", "zh-TW"]) {
    const messages = readFileSync(new URL(`../lib/i18n/messages/${loc}.ts`, import.meta.url), "utf8");
    for (const key of ["chat.sideChatsTitle", "chat.sideChatsRunning"]) {
      assert.ok(messages.includes(`"${key}"`), `${key} is translated in ${loc}`);
    }
    // A conversation has no outcome: only a subagent relation carries a status
    // (lib/session-family.ts), so the side-chat group states its count and its live runs,
    // and invents no completed / aborted buckets.
    for (const key of ["chat.sideChatsCompleted", "chat.sideChatsAborted"]) {
      assert.ok(!messages.includes(`"${key}"`), `${loc}: ${key} would be a fabricated state`);
    }
  }
  assert.match(counter, /<SideChatIcon \/>[\s\S]{0,200}?<span className="app-topbar-subagent-count">\{sideChats\.total\}<\/span>/,
    "the side-chat group is its glyph and its count");
  assert.match(counter, /const status = relation\.kind === "subagent" \? relation\.status : undefined;/);
  assert.match(counter, /<Bucket kind="running" count=\{sideChats\.running\}/, "plus the live ones");
});

test("the chip prints the buckets, not a total", () => {
  const counter = readFileSync(new URL("./TopbarSubagents.tsx", import.meta.url), "utf8");
  // [kind glyph] [completed glyph]N [aborted glyph]N [running glyph]N, per kind. The three
  // buckets are the total; a number after the glyph only took width from the row.
  assert.ok(!counter.includes("app-topbar-subagents-total"), "no total number");
  assert.ok(!css.includes(".app-topbar-subagents-total"), "and no rule for it");
  assert.match(counter, /function Bucket\(\{ kind, count, title \}[\s\S]*?if \(count === 0\) return null;/,
    "a zero bucket renders nothing: \"\u27130\" is a claim about runs that do not exist");
  assert.match(counter, /<AgentIcon \/>\s*<Buckets/, "the kind's glyph is followed by its buckets");
  assert.match(counter, /className=\{`app-topbar-subagent-count is-\$\{kind\}`\}/,
    "the buckets keep the classes the row colours by");
  assert.match(counter, /kind === "aborted" && \([\s\S]*?<circle cx="12" cy="12" r="9" \/>/,
    "the aborted bucket carries the Agents panel's stop glyph");
  assert.ok(!counter.includes("app-topbar-subagent-dot"), "the status dot is not the aborted icon");
  assert.match(counter, /title=\{title\}/, "each bucket says what it counts");
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
test("the Agents panel opens under the count it belongs to, not over the project tree", () => {
  const block = appShell.match(/if \(activeTopPanel === "agents"\) \{[\s\S]*?\n      \}/);
  assert.ok(block, "the agents branch of the top-panel placement exists");
  assert.match(block[0], /left: Math\.max\(topBarRect\.left, topBarRect\.right - width\)/,
    "a 420px card pinned to the topbar's left edge landed on the project tree on a desktop and a pad, under the pointer's start");
  assert.match(block[0], /const width = Math\.min\(AGENT_PANEL_WIDTH, available\);/,
    "the cap is the topbar's width, which is what keeps a phone's panel at the column's left edge");
});
