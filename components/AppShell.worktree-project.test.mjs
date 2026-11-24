import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// A linked worktree is not a new project. The header and the composer name the
// repository it belongs to — `tab-to-find`, not the worktree's folder
// `fix-wt-test-first-click-delayed-scroll` — and put the checkout glyph in front of the
// name, because what the row has to say is "this folder is one of that project's
// checkouts". The branch chip beside it carries the same glyph and names the branch, and
// the tip shows the worktree's own path.
//
// The branch list is the same fact seen from the menu: branches belong to the
// repository, so a worktree's menu lists all of them.

const jiti = (await import("jiti")).createJiti(import.meta.url, { tsconfigPaths: true });
const { readProjectIdentity } = await jiti.import("../hooks/useProjectBranch.ts");

const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const projectChip = await readFile(new URL("./ComposerProjectChip.tsx", import.meta.url), "utf8");
const topbarChip = await readFile(new URL("./TopbarProjectChip.tsx", import.meta.url), "utf8");
const menu = await readFile(new URL("./ProjectContextMenu.tsx", import.meta.url), "utf8");

const MAIN = { path: "/repo", branch: "main", isMain: true };
const LINKED = { path: "/repo-worktrees/fix-x", branch: "fix/x", isMain: false };

test("a linked worktree answers with its project, and says it is linked", () => {
  assert.deepEqual(readProjectIdentity({
    projectRoot: "/repo", currentWorktreePath: LINKED.path, isGit: true, worktrees: [MAIN, LINKED],
  }), { projectRoot: "/repo", isWorktree: true });
  assert.deepEqual(readProjectIdentity({
    projectRoot: "/repo", currentWorktreePath: MAIN.path, isGit: true, worktrees: [MAIN, LINKED],
  }), { projectRoot: "/repo", isWorktree: false }, "the checkout is the checkout");
  assert.deepEqual(readProjectIdentity({ isGit: false }), { projectRoot: null, isWorktree: false },
    "a folder that is not a repository invents nothing");
  assert.deepEqual(readProjectIdentity({ projectRoot: "/repo", currentWorktreePath: null, worktrees: [] }),
    { projectRoot: "/repo", isWorktree: false },
    "an unanswered current checkout never claims a worktree");
});

test("the shell resolves the composer's project and hands it to the header and the composer", () => {
  assert.match(appShell, /import \{ useProjectBranch, useProjectIdentity, invalidateProjectBranch \}/);
  assert.match(appShell, /const composerProjectIdentity = useProjectIdentity\(composerProjectCwd\);/);
  assert.match(appShell, /const composerProjectCwd = isChatWorkspaceActive \|\| pageOpen \|\| selectedSession\n\s*\? null\n\s*: newSessionCwd \?\? visibleProjectCwd;/,
    "a selected session carries its own project; a fresh composer resolves the folder it is pointed at");
  assert.match(appShell, /selectedSession\?\.projectRoot \?\? composerProjectIdentity\.projectRoot/,
    "a session's project comes from the session file, which knows the repository root");
  assert.match(appShell, /Boolean\(selectedSession\?\.isWorktree \?\? composerProjectIdentity\.isWorktree\)/);
  // The label: the repository's display name, and only for a linked worktree. A normal
  // checkout keeps its folder name (that is the project).
  assert.match(appShell, /headerProjectIsWorktree && headerProjectRoot\n\s*\? getProjectDisplayName\(headerProjectRoot, availableProjectRoots\)/,
    "the worktree's label is its project's name, resolved the way every project name is");
  assert.match(appShell, /<TopbarProjectChip name=\{topBarSubtitle\} path=\{visibleProjectCwd \?\? ""\} branch=\{topBarBranch\} isWorktree=\{headerProjectIsWorktree\} \/>/,
    "the header's project glyph is asked of the branch, and its tip keeps the worktree's own path");
  assert.match(appShell, /composerProjectRoot=\{composerProjectIdentity\.projectRoot\}\n\s*composerProjectIsWorktree=\{composerProjectIdentity\.isWorktree\}/,
    "the composer is told the same pair");
});

test("the composer's project chip names the repository and wears the checkout glyph", () => {
  assert.match(chatWindow, /projectPath=\{chatOnly \? undefined : session\?\.projectRoot \?\? composerProjectRoot \?\? newSessionCwd\}/,
    "the chip is labelled with the project, exactly as a session's projectRoot already labels it");
  assert.match(chatWindow, /projectIsWorktree=\{chatOnly \? false : Boolean\(session\?\.isWorktree \?\? composerProjectIsWorktree\)\}/);
  assert.match(chatInput, /isWorktree=\{projectIsWorktree\}/);
  assert.match(projectChip, /showsWorktreeGlyph \? <WorktreeIcon size=\{14\} \/>/, "the composer takes the checkout glyph, and only for a branch that owns the folder");
  assert.match(projectChip, /const projectBranch = useProjectBranch\(projectPath\);\s*\n\s*const showsWorktreeGlyph = isWorktree && branchOwnsWorktreeFolder\(projectPath, projectBranch\);/,
    "the chip reads the branch through the same cached hook the branch chip beside it uses");
  assert.match(topbarChip, /isWorktree && branchOwnsWorktreeFolder\(path, branch\) \? <WorktreeIcon size=\{13\} \/>/, "and so does the header");
  assert.match(topbarChip, /isWorktree = false/, "the glyph is opt-in: a plain checkout keeps the folder");
  // The rule the user asked for: a worktree folder switched to an ordinary branch wears
  // the folder glyph, because the glyph is a statement about the branch on the row.
  assert.match(topbarChip, /import \{ branchOwnsWorktreeFolder \} from "@\/lib\/worktree-folder";/);
  assert.match(projectChip, /import \{ branchOwnsWorktreeFolder \} from "@\/lib\/worktree-folder";/);
});

test("the branch menu is fetched by checkout, and a worktree's answer belongs to it", () => {
  assert.match(menu, /export async function fetchProjectBranchMenu\(cwd: string\)/);
  assert.match(menu, /const belongs = Boolean\(data\.projectRoot\)\n\s*&& \(data\.projectRoot === cwd \|\| worktrees\.some\(\(entry\) => entry\.path === cwd\)\);/,
    "the payload must belong to the checkout asked about — which a linked worktree answers as");
  assert.doesNotMatch(menu, /data\.projectRoot !== cwd/,
    "the old equality check rejected every worktree and the menu said \"No other branches\"");
  assert.match(menu, /root: cwd,\n\s*projectRoot: data\.projectRoot as string,/,
    "the actions run in the checkout the user stands in, and the project root rides along");
});
