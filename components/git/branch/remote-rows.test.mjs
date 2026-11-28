// The Git panel's remote rows, against the shape the server actually answers.
//
// Why this file exists: `getRemoteBranches` answers per remote
// (`{ remote: "origin", branches: ["main"] }`), the panel read it as a list of
// `BranchInfo`, every row's `name` came out `undefined`, and `branchSegments`
// threw `TypeError: undefined is not an object (evaluating 'name.split')` inside
// the branch tree — which took the whole panel down on the first click of the Git
// button, in the browser, with the row list in front of the user. The crash is
// reproduced here as the path the stack trace took.
import assert from "node:assert/strict"
import test from "node:test"

const { remoteBranchNames, remoteBranchRows } = await import("./remote-rows.ts")
const { buildBranchTree, flattenBranchTree, branchSegments } = await import("../../../lib/branch-tree.ts")

/** Exactly what `GitService.getRemoteBranches` answers. */
const ANSWER = [
  { remote: "origin", branches: ["main", "feat/branch-tree", "fix/wt-test-first-click"] },
  { remote: "upstream", branches: ["main", "docs/notes"] },
]

await test("the names carry their remote, because PushDialog reads the remote out of them", () => {
  const names = remoteBranchNames(ANSWER)
  assert.deepEqual(names, [
    "origin/main",
    "origin/feat/branch-tree",
    "origin/fix/wt-test-first-click",
    "upstream/main",
    "upstream/docs/notes",
  ])
  const remotes = new Set(names.map((name) => name.split("/")[0]))
  assert.deepEqual([...remotes], ["origin", "upstream"], "the dialog's remote picker has both")
})

await test("every row has a name the branch tree can split — the crash, stated as an assertion", () => {
  const rows = remoteBranchRows(ANSWER)
  assert.ok(rows.length > 0)
  for (const row of rows) {
    assert.equal(typeof row.name, "string", "a row without a name is what killed the panel")
    assert.ok(row.name.length > 0)
    assert.equal(row.remote, true, "the section is the Remote section")
    assert.equal(row.kind, "branch", "no checkout holds a remote branch")
    assert.equal(row.holderPath, null)
    assert.ok(row.info.fullRef.startsWith("refs/remotes/"), `the log filters on the full ref: ${row.info.fullRef}`)
    assert.equal(row.info.isRemote, true)
  }
  // The path from the stack trace: buildBranchTree → branchSegments → name.split.
  const tree = buildBranchTree(rows)
  const items = flattenBranchTree(tree, new Set(), { expandAll: true })
  assert.ok(items.length >= rows.length, "the tree has the rows, and the folders their names carry")
  assert.deepEqual(branchSegments("feat/branch-tree"), ["feat", "branch-tree"], "a / is a folder that collapses")
  const groups = items.filter((item) => item.type === "group").map((item) => item.label)
  assert.ok(groups.includes("feat"), "feat/… is a group, as in the local tree")
  assert.ok(groups.includes("fix"), "fix/… is a group")
  const leaves = items.filter((item) => item.type === "leaf").map((item) => item.label)
  assert.ok(leaves.includes("main"), "a name without a / is a row of its own")
  assert.ok(leaves.includes("branch-tree"), "inside the group, the row is named by what is left")
})

await test("the name a row hands to git is the short one, so checkout tracks the remote", () => {
  const rows = remoteBranchRows([{ remote: "origin", branches: ["feature"] }])
  assert.equal(rows[0].name, "feature", "git checkout feature is git's own DWIM: it creates the tracking branch")
  assert.equal(rows[0].info.fullRef, "refs/remotes/origin/feature")
})

await test("a short name under two remotes is offered once", () => {
  const rows = remoteBranchRows(ANSWER)
  const mains = rows.filter((row) => row.name === "main")
  assert.equal(mains.length, 1, "git refuses an ambiguous checkout, and so does the list")
  assert.equal(mains[0].info.fullRef, "refs/remotes/origin/main", "the first remote wins")
})

await test("an answer with nothing in it is no rows, not a crash", () => {
  for (const empty of [[], [{ remote: "origin", branches: [] }], [{ remote: "", branches: ["x"] }], [{}], null]) {
    assert.deepEqual(remoteBranchRows(empty ?? []), [])
    assert.deepEqual(remoteBranchNames(empty ?? []), [])
  }
})

await test("the components do not claim BranchInfo for this answer again", async () => {
  // The type parameter was the bug: it said `BranchInfo[]`, so every reader of
  // the query believed a group had a `name`. The guard is the same one the repo
  // uses for moves a merge can undo — the source, read.
  const { readFile } = await import("node:fs/promises")
  for (const file of ["components/GitPanel.tsx", "components/git/branch/BranchSidebar.tsx"]) {
    const source = await readFile(new URL(`../../../${file}`, import.meta.url), "utf8")
    const query = source.match(/useGitQuery<[^>]*>\(target, "getRemoteBranches"/)
    assert.ok(query, `${file} asks for the remote branches`)
    assert.match(query[0], /RemoteBranchGroup/, `${file} types the answer as the groups the server sends`)
  }
})

await test("the panel's e2e fixture answers the server's shape, not the component's wish", async () => {
  // The harness is only a proof if its answer comes from the server. This one
  // used to hand back `BranchInfo` objects, which matched the component's
  // (wrong) assumption exactly, so the crash it now covers was invisible.
  const { readFile } = await import("node:fs/promises")
  const fixture = await readFile(new URL("../../../e2e/git-panel.fixture.jsx", import.meta.url), "utf8")
  const answer = fixture.match(/const REMOTE_BRANCHES = \[([\s\S]*?)\n\];/)
  assert.ok(answer, "the fixture answers getRemoteBranches")
  assert.match(answer[1], /remote: REMOTE, branches: \[/, "per remote, as GitService answers")
  assert.ok(!/isRemote: true/.test(answer[1]), "no BranchInfo fields in the answer")
})
