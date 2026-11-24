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

test("the filter box is styled from the menu tokens, in the fork's theme file", async () => {
  const css = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");
  const rule = css.slice(css.indexOf(".sidebar-project-context-menu-filter {"), css.indexOf("}", css.indexOf(".sidebar-project-context-menu-filter {")));
  for (const declaration of ["font-family: var(--font-mono);", "border: var(--hairline) solid var(--border);", "border-radius: var(--radius-sm);"]) {
    assert.ok(rule.includes(declaration), `the filter box keeps ${declaration}`);
  }
  assert.match(css, /\.sidebar-project-context-menu-filter:focus \{\s*border-color: var\(--accent\);/,
    "the box shows the accent only while it has the caret");
});
