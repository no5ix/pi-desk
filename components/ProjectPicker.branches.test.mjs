import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (file) => (await readFile(new URL(file, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

/**
 * A project list that says which branch each project is on.
 *
 * The picker lists projects by path, and in a worktree setup the paths are the
 * names a user typed: eight folders, one repository, all of them plausible. The
 * sidebar's rows and the Git panel's switcher already carried the branch; the
 * list that decides which folder the next session works in did not. These
 * assertions keep the list, the fetch and the ink on the same side of that.
 */

test("the picker asks for the branches of the projects it is about to show", async () => {
  const picker = await read("./ProjectPicker.tsx");
  assert.match(picker, /const \{ branches, refresh: refreshBranches \} = useProjectBranches\(recentProjects, dropdownOpen\);/,
    "the list asks for the paths it renders, and only while the dropdown is open");
  assert.match(picker, /if \(!dropdownOpen\) void refreshBranches\(\);/,
    "opening the dropdown re-reads: a branch is something the user moves by hand");
  assert.match(picker, /branches\[project\]\?\.isRepo \? \(/,
    "a folder that is not a checkout says nothing, and a folder the app may not read says the same");
  assert.match(picker, /\{branches\[project\]\?\.branch \?\? t\("git\.detached"\)\}/,
    "a detached checkout is shown as detached, not as a branch named HEAD");
  assert.match(picker, /data-project-branch=\{branches\[project\]\?\.branch \?\? "detached"\}/,
    "the row carries its branch for the browser-side check");
});

test("the branch's ink is the app's, in the fork stylesheet", async () => {
  const css = await read("../app/native-theme.css");
  const rule = css.match(/\.project-picker-branch \{[\s\S]*?\}/);
  assert.ok(rule, "the branch is a class, not an inline style");
  assert.match(rule[0], /color: var\(--text-dim\);/);
  assert.match(rule[0], /font-family: var\(--font-mono\);/);
  assert.match(rule[0], /max-width: \d+%;/, "it never eats the row: the path keeps the leading half");
  assert.doesNotMatch(rule[0], /#[0-9a-fA-F]{3,8}/, "no invented palette");
});

test("the fetch accumulates, and a slow answer for an older list cannot land on the current one", async () => {
  const hook = await read("../hooks/useProjectBranches.ts");
  assert.match(hook, /const key = active \? paths\.join\("\\n"\) : "";/,
    "the list's identity, not the array's: the picker rebuilds the array on every keystroke of its filter");
  assert.match(hook, /if \(!active \|\| key === ""\) return;/,
    "nothing is fetched for a closed dropdown");
  assert.match(hook, /for \(const cwd of list\) params\.append\("cwd", cwd\);/,
    "one request for the whole list, not one per row");
  assert.match(hook, /if \(!mountedRef\.current \|\| requestId !== requestIdRef\.current\) return;/,
    "a stale answer is dropped");
  assert.match(hook, /const next = \{ \.\.\.previous \};[\s\S]*?next\[entry\.cwd\] = entry;/,
    "answers accumulate: a row that is answered keeps its branch while another list is fetched");
  assert.match(hook, /if \(!response\.ok\) return;[\s\S]*?catch \{/,
    "a failure leaves the list as it was: a list without branches is a list");
});

test("the endpoint speaks the same shape the picker reads", async () => {
  const lib = await read("../lib/project-branches.ts");
  const route = await read("../app/api/projects/branches/route.ts");
  const hook = await read("../hooks/useProjectBranches.ts");
  const fields = lib.match(/export interface ProjectBranch \{([\s\S]*?)\}/)[1].match(/\w+/g);
  for (const field of ["cwd", "branch", "isWorktree", "isRepo"]) {
    assert.ok(fields.includes(field), `the answer carries ${field}`);
    assert.ok(hook.includes("ProjectBranch"), "the client reads the lib's type, so the two cannot drift");
  }
  assert.match(route, /const projects = await readProjectBranches\(cwds\);\s*return NextResponse\.json\(\{ projects \}\);/,
    "the route answers `projects`, which is what the hook reads");
  assert.match(route, /if \(url\.searchParams\.get\("refresh"\) === "1"\) invalidateProjectBranch\(\);/,
    "the refresh the picker asks for is the cache's end");
  assert.match(route, /if \(!isApiRequestAllowed\(request\)\)/, "a cross-origin page cannot ask this machine for its project branches");
});
