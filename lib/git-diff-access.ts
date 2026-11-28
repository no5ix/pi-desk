import { lstatSync, realpathSync } from "fs";
import path from "path";
import { hasParentDirectorySegment, isPathWithinRoots, resolveRealRoots } from "./path-security";

/**
 * The gate a git diff request answers with, and the reason it says.
 *
 * The panel asks for a file's diff with the path **git printed**, and git prints
 * a checkout's path with symlinks resolved (`git rev-parse --show-toplevel`
 * answers the symlink-free path). The allowed roots record the folder the user
 * picked, spelling and all — through a link when the project lives under one: a
 * linked worktree under a linked parent, a home under a link, `/tmp` on macOS, a
 * case-differing volume. Both spellings name the same file, so a gate that reads
 * only the spelling rejects the diff of a file the panel has just listed and
 * read. That is the split this module closes: containment is decided on the
 * resolved path against the resolved roots, which is what `isExistingFilePathAllowed`
 * already does for reads.
 *
 * The rejection is not one answer, because it is not one situation. A path that
 * leaves the project through a link inside it is the case the check exists for;
 * a path outside every root is a plain refusal; a `..` segment is a shape that
 * authorizes on paper and lands somewhere else on disk; a dangling link has no
 * file to read at all. Naming them lets the panel say which one happened,
 * instead of a bare "Access denied" on a file in the user's own working tree.
 */
export type DiffPathDenial = "parent-segment" | "outside-root" | "link-escapes-root" | "unresolvable";

/** Why reading `filePath` under `allowedRoots` is refused; null when it may be read. */
export function readDiffPathDenial(filePath: string, allowedRoots: Set<string>): DiffPathDenial | null {
  if (!filePath || hasParentDirectorySegment(filePath)) return "parent-segment";
  const realRoots = resolveRealRoots(allowedRoots);
  // A deleted file — and any path under a directory that is gone — has no real
  // path of its own, so the nearest existing entry decides. The walk never
  // crosses a dangling link: that is reported, not stepped over.
  let candidate = filePath;
  for (;;) {
    let exists = true;
    try {
      lstatSync(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return "unresolvable";
      exists = false;
    }
    if (exists) {
      let real: string;
      try {
        real = realpathSync(candidate);
      } catch {
        return "unresolvable";
      }
      if (isPathWithinRoots(real, realRoots)) return null;
      return isPathWithinRoots(candidate, allowedRoots) ? "link-escapes-root" : "outside-root";
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return "outside-root";
    candidate = parent;
  }
}
