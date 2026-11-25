import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const chipSource = await readFile(new URL("./ComposerBranchMenu.tsx", import.meta.url), "utf8");
const hookSource = await readFile(new URL("../hooks/useProjectWorktreeActions.ts", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const messages = Object.fromEntries(await Promise.all(["en", "zh-CN", "zh-TW"].map(async (locale) => [
  locale,
  await readFile(new URL(`../lib/i18n/messages/${locale}.ts`, import.meta.url), "utf8"),
])));

test("the branch chip opens the app's menu, where a row carries buttons", () => {
  const click = chipSource.match(/function openChipMenu\(\) \{[\s\S]*?\n  \}/);
  assert.ok(click, "the chip's click handler");
  assert.doesNotMatch(click[0], /canUseNativeMenu\(\)/,
    "a native popup cannot host the two buttons per branch, so the click opens the in-app menu");
  assert.match(click[0], /openMenu\(\);/, "the click opens the app's menu");
  // The desktop shell keeps the OS popup, one gesture away, for a plain list.
  assert.match(chipSource, /onContextMenu=\{\(event\) => \{[\s\S]*?canUseNativeMenu\(\)[\s\S]*?openNativeMenu\(\);/);
});

test("a branch checked out in a worktree takes the session to that worktree", () => {
  // git would only refuse, and the row's tip already promises the worktree.
  assert.match(hookSource, /const holder = loaded\?\.worktrees\.find\(\(w\) => w\.branch === branch && w\.path !== \(checkoutOf \?\? cwd\)\);/);
  const body = hookSource.slice(hookSource.indexOf("const holder = loaded"), hookSource.indexOf("}, [onBranchSwitched, onBranchInWorktree, switchingBranch]);"));
  assert.match(body, /if \(holder\) \{\s*worktreePath = holder\.path;\s*\} else \{/,
    "the holder branch never reaches git");
  assert.match(body, /onBranchInWorktree\?\.\(cwd, branch, worktreePath\);/);
  assert.doesNotMatch(body, /already checked out at/, "git's refusal is not shown as an error");
  // The chip answers by selecting the worktree: same project, that folder, so the
  // header's branch icon becomes the worktree's (the topbar reads the cwd).
  assert.match(chipSource, /onBranchInWorktree: \(_cwd, _branch, path\) => \{[\s\S]*?close\(\);\s*onWorktreeSelected\?\.\(path\);/);
});

test("a plain branch is checked out in this checkout as before", () => {
  assert.ok(hookSource.includes('body: JSON.stringify({ cwd, branch }),'), "the checkout is a PUT to the worktree route");
  assert.match(hookSource, /if \(checkedOut\) onBranchSwitched\?\.\(cwd, checkedOut\);/);
  assert.match(hookSource, /return \{ branch: checkedOut, worktreePath: null \};/);
});

test("a row's worktree button opens the new-worktree form for that branch", () => {
  // The user's report: pressing the row's worktree button answered with a plain list of
  // branch names. The form is the page that says which branch the new one starts from and
  // which folder it lands in, so the button goes there and nowhere else.
  assert.match(chipSource, /onCreateWorktreeFromBranch=\{openWorktreeForm\}/);
  const form = chipSource.match(/const openWorktreeForm = useCallback\(\(from: string\) => \{[\s\S]*?\n  \}, \[actions\]\);/);
  assert.ok(form, "the chip owns the step into the form");
  assert.match(form[0], /setView\(NEW_WORKTREE_VIEW\);/, "the new-worktree page, not the branch list");
  assert.match(form[0], /setBaseBranch\(from \|\| null\);/, "the row's branch is the base");
  assert.match(chipSource, /worktreeBaseBranch=\{baseBranch\}/, "so the form can name what it starts from");
  assert.match(chipSource, /actions\.create\(cwd, baseBranch \?\? undefined\)/, "and create from it");
  // The branch page carries no "Worktrees…" item and no "back to Project actions": the
  // worktree branches are rows of the list, and the native popup keeps its own page.
  assert.ok(!chipSource.includes("onShowWorktrees="), "the list has no Worktrees… row to wire");
  assert.ok(!chipSource.includes("onBackToActions="), "and no back row to wire");
});

test("the composer's branch chip follows the project a new session starts in", () => {
  // The bug: the project chip showed the new session's project while the branch
  // chip listed the previously selected session's project.
  const line = shellSource.match(/onBranchChipCwd=\{([^\n]*)\}/);
  assert.ok(line, "the composer's branch chip is wired in AppShell");
  assert.match(line[1], /newSessionCwd \?\? activeCwd/,
    "the chip reads the new-session folder, the same one the project chip names");
  assert.match(line[1], /!selectedSession && !pageOpen/, "and only on a new-session composer");
});

test("the new branch words exist in every language", () => {
  for (const locale of ["en", "zh-CN", "zh-TW"]) {
    for (const key of [
      "sidebar.filterBranches",
      "sidebar.filterBranchesTitle",
      "sidebar.noBranchMatches",
      "sidebar.openWorktreeForBranchTitle",
    ]) {
      assert.match(messages[locale], new RegExp(`"${key.replace(/\./g, "\\.")}":`), `${locale} ${key}`);
    }
  }
  // The filter's value is the query; the worktree-opening tip names the branch.
  assert.match(messages["en"], /"sidebar\.noBranchMatches": "No branch matches “\{query\}”"/);
  assert.match(messages["en"], /"sidebar\.openWorktreeForBranchTitle": "\{branch\} is checked out in a worktree/);
});

test("every locale can say the branch tree's words", async () => {
  // The tree's glyphs are only half the story: each row also says what it will do, and
  // the new-worktree form's sentence carries a {branch} and a {path}.
  const source = await readFile(new URL("../lib/i18n/locale-plugins.ts", import.meta.url), "utf8");
  for (const key of [
    "sidebar.currentBranchTitle",
    "sidebar.mainCheckoutBranchTitle",
    "sidebar.branchGroupExpand",
    "sidebar.branchGroupCollapse",
    "sidebar.branchGroupCount",
    "sidebar.newWorktreeFrom",
    "sidebar.newWorktreeInto",
  ]) {
    assert.equal(source.match(new RegExp(`"${key.replace(/\./g, "\\.")}":`, "g"))?.length, 3, `${key} in en, zh-CN and zh-TW`);
  }
  assert.match(source, /"sidebar\.newWorktreeFrom": "Create a new branch based on “\{branch\}”, in the folder"/,
    "the English sentence the user asked for: the base branch inside it, the folder on the row below");
});

test("the filter box is styled from the menu tokens, in the fork's theme file", async () => {
  const css = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".sidebar-project-context-menu-filter {"), css.indexOf("}", css.indexOf(".sidebar-project-context-menu-filter {")));
  for (const declaration of ["font-family: var(--font-mono);", "border: 0;", "border-radius: var(--radius-sm);", "background: var(--bg-selected);"]) {
    assert.ok(rule.includes(declaration), `the filter box keeps ${declaration}`);
  }
  assert.ok(!rule.includes("border: var(--hairline)"), "the box carries no border: in a flat panel a bordered box reads as a form field");
  assert.match(css, /\.sidebar-project-context-menu-filter:focus \{[\s\S]*?outline: 2px solid var\(--accent\);/,
    "the box shows the accent only while it has the caret");
});
