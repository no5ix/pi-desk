/**
 * The remote branches, in the shape the panel reads.
 *
 * `getRemoteBranches` answers **per remote** — `{ remote: "origin", branches:
 * ["main", "feature"] }` — because a remote branch is a name under a remote, not
 * a `BranchInfo`. Reading that answer as a flat list of `BranchInfo` yields rows
 * whose `name` is `undefined`, and the branch tree splits the name into path
 * segments, so the whole Git panel goes down on it. The mapping lives here, away
 * from the components, so a test can read the shape without a browser.
 */
import type { BranchInfo, RemoteBranchGroup } from "@/lib/git/types";
import type { BranchRow } from "@/lib/branch-tree";

/** A remote row, with the `BranchInfo` the menu needs (its ref, above all). */
export type GitRemoteRow = BranchRow & { info: BranchInfo };

/**
 * The names as git takes them in a remote context: `origin/feature`. `PushDialog`
 * reads the remote out of these (`name.split("/")[0]`), so the prefix is not
 * decoration.
 */
export function remoteBranchNames(groups: RemoteBranchGroup[]): string[] {
  const names: string[] = [];
  for (const group of groups) {
    const remote = group?.remote;
    if (typeof remote !== "string" || !remote) continue;
    for (const branch of group.branches ?? []) {
      if (typeof branch !== "string" || !branch) continue;
      names.push(`${remote}/${branch}`);
    }
  }
  return names;
}

/**
 * The rows of the Remote section.
 *
 * `name` is the **short** branch name, because that is what the row's operations
 * hand to git: `checkoutBranch { branch: "feature" }` is git's own DWIM, which
 * creates the tracking branch. The full ref — `refs/remotes/origin/feature` — is
 * what the log filters on, and it lives in `info.fullRef`.
 *
 * A short name that appears under two remotes keeps its first group. git refuses
 * an ambiguous `git checkout feature` for exactly that reason, so the panel does
 * not offer two rows the user cannot tell apart; the second remote is visible in
 * the branch's own tracking information.
 */
export function remoteBranchRows(groups: RemoteBranchGroup[]): GitRemoteRow[] {
  const rows: GitRemoteRow[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    const remote = group?.remote;
    if (typeof remote !== "string" || !remote) continue;
    for (const branch of group.branches ?? []) {
      if (typeof branch !== "string" || !branch) continue;
      if (seen.has(branch)) continue;
      seen.add(branch);
      rows.push({
        name: branch,
        remote: true,
        kind: "branch",
        holderPath: null,
        holderIsMain: false,
        info: {
          name: branch,
          fullRef: `refs/remotes/${remote}/${branch}`,
          isRemote: true,
          isCurrent: false,
          ahead: 0,
          behind: 0,
          lastCommitHash: "",
        },
      });
    }
  }
  return rows;
}
