// Fork-owned: the shape of the composer's branch list.
//
// The branch page used to be one long column of names in git's order, and the
// eye had nothing to hold: the branch being worked on sat next to a branch that
// belongs to another folder, and forty `fix/…` names read as forty unrelated
// words. The user reads the list as three questions — *where am I*, *which
// branches have a folder of their own*, *what is the rest* — so this module
// answers them in that order, and groups the rest by the path a branch name
// already carries (`fix/wt-test-first-click-delayed-scroll` is `fix` → `wt-test-…`).
//
// Pure on purpose: the order and the tree are the behaviour, and a unit test can
// read them without a browser. The panel (`components/ProjectContextMenu.tsx`)
// owns the collapse state; the glyphs it picks per row are the same three facts
// (`current` / `worktree` / `branch`).

/** A worktree as the menu reads it (the same shape `ProjectContextMenu` calls `WorktreeEntry`). */
export interface BranchTreeWorktree {
  path: string;
  branch: string | null;
  isMain: boolean;
}

/** What a row is, which is what its glyph says.
 *
 * `current` — the branch this checkout is on: the project's own folder, so the
 * project glyph. `worktree` — a *linked* worktree holds it, so the worktree
 * glyph, and the row opens that folder. `project` — the main checkout holds it
 * while we are standing in a linked folder: the same project glyph, because that
 * is the folder the row leads to. `branch` — an ordinary branch. */
export type BranchRowKind = "current" | "worktree" | "project" | "branch";

export interface BranchRow {
  /** The full branch name — the only name a git call takes. */
  name: string;
  /** Remote-only: no local branch yet, so checking it out creates a tracking branch. */
  remote: boolean;
  kind: BranchRowKind;
  /** The checkout that already holds this branch, when one does (the main checkout
   *  counts: git refuses to check a branch out twice, so the row opens that folder). */
  holderPath: string | null;
  /** True when that holder is the repository's main checkout. */
  holderIsMain: boolean;
}

/**
 * The rows in the order the list is read:
 * the branch this checkout is on first, then the branches that have a folder of
 * their own, then everything else in the order the server sent (git's own recency).
 *
 * `checkoutPath` is the folder the menu was asked about (`currentCheckout()` in
 * `components/ProjectContextMenu.tsx`), so "current" means *this folder's* branch.
 */
export function buildBranchRows(options: {
  branches: string[];
  remoteBranches: string[];
  worktrees: BranchTreeWorktree[];
  checkoutPath: string | null;
}): BranchRow[] {
  const { branches, remoteBranches, worktrees, checkoutPath } = options;
  const checkout = worktrees.find((worktree) => worktree.path === checkoutPath)
    ?? worktrees.find((worktree) => worktree.isMain);
  const currentBranch = checkout?.branch ?? null;
  /** Every checkout that holds a branch, the main one included: that is what git
   *  refuses to check out twice, and what the row's click resolves by moving the
   *  session to that folder. The current branch is not a holder of itself. */
  const holderOf = new Map<string, { path: string; isMain: boolean }>();
  for (const worktree of worktrees) {
    if (!worktree.branch || worktree.branch === currentBranch) continue;
    holderOf.set(worktree.branch, { path: worktree.path, isMain: worktree.isMain });
  }
  const rows: BranchRow[] = [];
  const rowFor = (name: string, remote: boolean): BranchRow => {
    const holder = name === currentBranch
      // The current branch is held by *this* folder: git refuses to check it out
      // twice, and a worktree from it would collide with the folder it already
      // lives in. So the row gets no worktree button, and no removal either (the
      // folder you are standing in is not one to take away).
      ? (checkout ? { path: checkout.path, isMain: checkout.isMain } : null)
      : holderOf.get(name) ?? null;
    const kind: BranchRowKind = name === currentBranch
      ? "current"
      : holder ? (holder.isMain ? "project" : "worktree") : "branch";
    return {
      name,
      remote,
      kind,
      holderPath: holder?.path ?? null,
      holderIsMain: holder?.isMain ?? false,
    };
  };
  // Current first, and never twice: the server lists the current branch among the
  // local ones, so the split has to take it out of the rest.
  const currentRow = currentBranch ? rowFor(currentBranch, false) : null;
  if (currentRow) rows.push(currentRow);
  const seen = new Set(currentRow ? [currentRow.name] : []);
  const rest: BranchRow[] = [];
  for (const name of branches) {
    if (seen.has(name)) continue;
    seen.add(name);
    rest.push(rowFor(name, false));
  }
  for (const name of remoteBranches) {
    if (seen.has(name)) continue;
    seen.add(name);
    rest.push(rowFor(name, true));
  }
  // The branches that live in a folder of their own come straight after the current
  // one: that is the second question a person scanning the list asks, and the rows
  // are the ones a glyph can answer it for.
  const hasItsOwnFolder = (row: BranchRow) => row.kind === "worktree" || row.kind === "project";
  rows.push(...rest.filter(hasItsOwnFolder));
  rows.push(...rest.filter((row) => !hasItsOwnFolder(row)));
  return rows;
}

/** A `fix/wt/x` branch inside the `fix` group: `path` is `fix/wt`, `label` is `wt`. */
export interface BranchGroupNode {
  label: string;
  /** The full prefix, which is the group's identity and its collapse key. */
  prefix: string;
  /** The depth the group's row sits at: 0 for a top-level prefix. */
  depth: number;
  children: BranchGroupNode[];
  /** Branches that end one segment below this group (`fix/a` under `fix`). */
  leaves: BranchRow[];
  /** Every branch below this group, at any depth. */
  count: number;
}

export interface BranchTree {
  /** Names with no `/` at all: they belong to no group. */
  leaves: BranchRow[];
  groups: BranchGroupNode[];
}

const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });

/** A branch name's segments: `fix/wt/x` → `["fix", "wt", "x"]`. */
export function branchSegments(name: string): string[] {
  return name.split("/").map((segment) => segment.trim()).filter(Boolean);
}

/**
 * The rest of the list as a tree of the path each branch name already carries.
 *
 * A group is a folder: it says what the branches under it have in common, and it
 * collapses. A name with no `/` (`probe`, `main`) stays at the top of the tree,
 * where it reads as a name and not a folder.
 */
export function buildBranchTree(rows: BranchRow[]): BranchTree {
  const tree: BranchTree = { leaves: [], groups: [] };
  /** prefix → node, so a `fix/wt` branch finds the `fix` node it belongs under. */
  const nodes = new Map<string, BranchGroupNode>();
  for (const row of rows) {
    const segments = branchSegments(row.name);
    if (segments.length <= 1) {
      tree.leaves.push(row);
      continue;
    }
    let parent: BranchGroupNode | null = null;
    let prefix = "";
    let depth = 0;
    for (const segment of segments.slice(0, -1)) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      let node = nodes.get(prefix);
      if (!node) {
        node = { label: segment, prefix, depth, children: [], leaves: [], count: 0 };
        nodes.set(prefix, node);
        (parent ? parent.children : tree.groups).push(node);
      }
      parent = node;
      depth += 1;
    }
    if (parent) {
      parent.leaves.push(row);
    } else {
      tree.leaves.push(row);
    }
  }
  const sortNode = (node: BranchGroupNode): number => {
    node.children.sort(byLabel);
    node.leaves.sort((a, b) => branchSegments(a.name).slice(-1)[0].localeCompare(branchSegments(b.name).slice(-1)[0], undefined, { numeric: true, sensitivity: "base" }));
    node.count = node.leaves.length + node.children.reduce((total, child) => total + sortNode(child), 0);
    return node.count;
  };
  tree.groups.sort(byLabel);
  tree.leaves.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  for (const group of tree.groups) sortNode(group);
  return tree;
}

/** One line of the rendered list: a group's row, or a branch. */
export type BranchListItem =
  | { type: "group"; depth: number; group: BranchGroupNode; label: string; collapsed: boolean; count: number }
  | { type: "leaf"; depth: number; row: BranchRow; label: string };

/**
 * The tree as the rows the panel paints, in the order it paints them: a group's
 * row, then what is under it (its own branches, then its subgroups).
 *
 * `collapsed` holds the prefixes the user folded away. A filtered list expands
 * everything (`expandAll`): a search that answers from inside a folded folder is
 * a dead end, and the box is the narrowing the collapse is standing in for.
 */
export function flattenBranchTree(
  tree: BranchTree,
  collapsed: ReadonlySet<string> = new Set(),
  options: { expandAll?: boolean } = {},
): BranchListItem[] {
  const expandAll = options.expandAll === true;
  const items: BranchListItem[] = [];
  const suffixFor = (row: BranchRow, prefix: string) =>
    row.name.length > prefix.length + 1 ? row.name.slice(prefix.length + 1) : row.name;
  const walk = (node: BranchTree | BranchGroupNode, depth: number, prefix: string) => {
    const children = "groups" in node ? node.groups : node.children;
    for (const row of node.leaves) {
      items.push({ type: "leaf", depth, row, label: prefix ? suffixFor(row, prefix) : row.name });
    }
    for (const group of children) {
      const collapsedHere = !expandAll && collapsed.has(group.prefix);
      items.push({ type: "group", depth, group, label: group.label, collapsed: collapsedHere, count: group.count });
      if (!collapsedHere) walk(group, depth + 1, group.prefix);
    }
  };
  walk(tree, 0, "");
  return items;
}

/**
 * The folder a new worktree for `branch` will be created in: `<repo>-worktrees/<name>`.
 *
 * The same rule `lib/worktree.ts`'s `addWorktree()` applies server-side
 * (`sanitizeBranchForDir` and the `-worktrees` sibling), and `lib/worktree-folder.ts`
 * reads in reverse. Kept here so the form can show the folder *while the name is
 * being typed*, and a test can keep the two halves saying the same thing.
 */
export function worktreePathForBranch(projectRoot: string, branch: string, dirNameFor: (branch: string) => string): string {
  const trimmed = branch.trim();
  const root = projectRoot.replace(/[/\\]+$/, "");
  const dir = trimmed ? dirNameFor(trimmed) : "";
  return `${root}-worktrees/${dir || "…"}`;
}
