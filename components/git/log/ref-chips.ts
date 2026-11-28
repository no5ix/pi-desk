/**
 * The chips on a commit row: where this commit is.
 *
 * git puts a ref on the commit it points at, so a row that carries both
 * `feat/x` and `origin/feat/x` is the branch and its remote **at the same
 * checkpoint** — the pair is one fact, and the reader wants it as one:
 * `origin & feat/x`, in a border colour that says "nothing to push". Two remotes
 * at the same checkpoint join in too (`origin, upstream & feat/x`).
 *
 * Kept out of the component because the pairing is the behaviour, and a test can
 * read it without a browser.
 */
export interface CommitRef {
  type: string;
  name: string;
}

export interface RefChip {
  key: string;
  label: string;
  /** The class suffix the chip is drawn with, plus `is-synced` when it is a pair. */
  className: string;
  synced: boolean;
}

const CHIP_CLASS: Record<string, string> = {
  HEAD: "git-ref-HEAD",
  branch: "git-ref-branch",
  tag: "git-ref-tag",
};

function remotePrefix(name: string): { remote: string; branch: string } | null {
  const slash = name.indexOf("/");
  if (slash <= 0) return null;
  return { remote: name.slice(0, slash), branch: name.slice(slash + 1) };
}

export function refChips(refs: CommitRef[]): RefChip[] {
  const locals = refs.filter((ref) => ref.type === "branch").map((ref) => ref.name);
  const localSet = new Set(locals);
  // The remote refs whose branch half is a local branch on this same commit.
  const remotesOf = new Map<string, string[]>();
  for (const ref of refs) {
    if (ref.type !== "remote-branch") continue;
    const parts = remotePrefix(ref.name);
    if (!parts || !localSet.has(parts.branch)) continue;
    const list = remotesOf.get(parts.branch) ?? [];
    if (!list.includes(parts.remote)) list.push(parts.remote);
    remotesOf.set(parts.branch, list);
  }

  const chips: RefChip[] = [];
  const consumed = new Set<string>();
  for (const ref of refs) {
    if (consumed.has(`${ref.type}:${ref.name}`)) continue;
    if (ref.type === "remote-branch") {
      const parts = remotePrefix(ref.name);
      if (parts && localSet.has(parts.branch)) {
        // The pair is drawn once, where it first appears.
        const firstLocalIndex = refs.findIndex(
          (other) => other.type === "branch" && other.name === parts.branch,
        );
        const appearsFirst = firstLocalIndex >= 0 && firstLocalIndex < refs.indexOf(ref);
        const remotes = remotesOf.get(parts.branch) ?? [];
        if (!appearsFirst) {
          chips.push({
            key: `synced-${parts.branch}`,
            label: `${remotes.join(", ")} & ${parts.branch}`,
            className: "git-ref-branch is-synced",
            synced: true,
          });
        }
        for (const other of refs) {
          if (other.type === "branch" && other.name === parts.branch) consumed.add(`branch:${other.name}`);
          if (other.type === "remote-branch" && remotePrefix(other.name)?.branch === parts.branch) {
            consumed.add(`remote-branch:${other.name}`);
          }
        }
        continue;
      }
      consumed.add(`remote-branch:${ref.name}`);
      chips.push({ key: `remote-branch:${ref.name}`, label: ref.name, className: "git-ref-remote", synced: false });
      continue;
    }
    if (ref.type === "branch" && (remotesOf.get(ref.name)?.length ?? 0) > 0) {
      const remotes = remotesOf.get(ref.name) ?? [];
      chips.push({
        key: `synced-${ref.name}`,
        label: `${remotes.join(", ")} & ${ref.name}`,
        className: "git-ref-branch is-synced",
        synced: true,
      });
      consumed.add(`branch:${ref.name}`);
      for (const other of refs) {
        if (other.type === "remote-branch" && remotePrefix(other.name)?.branch === ref.name) {
          consumed.add(`remote-branch:${other.name}`);
        }
      }
      continue;
    }
    consumed.add(`${ref.type}:${ref.name}`);
    chips.push({
      key: `${ref.type}:${ref.name}`,
      label: ref.name,
      className: CHIP_CLASS[ref.type] ?? "git-ref-branch",
      synced: false,
    });
  }
  return chips;
}
