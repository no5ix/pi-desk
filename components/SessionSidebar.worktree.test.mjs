import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");

test("uses the server-resolved current worktree identity", () => {
  assert.match(source, /currentWorktreePath: string \| null/);
  assert.match(
    source,
    /const currentWorktree =[\s\S]*?worktreeState\.currentWorktreePath[\s\S]*?worktree\.path === worktreeState\.currentWorktreePath/,
  );
  // The active project's branch subtitle reads the same identity.
  assert.match(source, /const currentWt = currentWorktree \?\? null;/);
  assert.doesNotMatch(source, /const isCurrent = wt\.path === selectedCwd/);
});

test("the project row's \"…\" menu is folder actions only", () => {
  // Branching moved to the composer's branch chip, so the sidebar keeps none of
  // it: no branch page, no worktree page, no native branch/worktree popups.
  for (const symbol of [
    "showNativeProjectBranchMenu",
    "showNativeProjectWorktreeMenu",
    "useProjectWorktreeActions",
    "handleSwitchProjectBranch",
    "showProjectMenuView",
    "openDomProjectMenu",
    "wtSwitchingBranch",
  ]) {
    assert.ok(!source.includes(symbol), `${symbol} is gone from the sidebar`);
  }
});

test("a removed worktree leaves the composer on the project's main checkout", async () => {
  // What the sidebar's worktree page used to do for its selected cwd, now done
  // for the composer that was pointing at the folder.
  const chip = await readFile(new URL("./ComposerBranchMenu.tsx", import.meta.url), "utf8");
  const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
  assert.match(chip, /const main = fresh\.worktrees\.find\(\(w\) => w\.isMain\)\?\.path \?\? null;/);
  assert.match(chip, /onWorktreeRemoved\?\.\(path, cwd === path \? main : null\);/);
  assert.match(shell, /if \(fallbackRoot && !selectedSession && activeCwd === path\) \{\s*handleNewSession\(`worktree-\$\{Date\.now\(\)\}`, fallbackRoot, "project"\);/,
    "the composer moves to the main checkout, not to a folder that is gone");
});
