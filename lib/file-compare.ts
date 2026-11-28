/**
 * Compare two files the way the file tree's "Select for Compare" does it: the
 * pair is read from disk, and Git — which the app already runs for everything
 * Git — writes the patch. `git diff --no-index` compares two paths as plain
 * files, so a comparison works inside a repository, outside one, and between
 * the two, and the answer is the unified patch `lib/patch.ts` already renders.
 *
 * Both paths go through the file API's authorization: a browsable root, resolved
 * through symlinks, and never a credential store.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { isCredentialPath } from "./credential-paths.ts";
import { getAllowedFileRoots } from "./file-access.ts";
import { isWriteProtectedPath } from "./file-write.ts";
import { GitExecutor } from "./git/core/git-executor.ts";
import { isPathWithinRoots, resolveRealRoots } from "./path-security.ts";
import { looksBinary } from "./file-write.ts";

/** The cap is per file. A bigger pair is a binary or a generated bundle, and a
 *  patch of it is not something a person reads. */
export const MAX_COMPARE_BYTES = 2 * 1024 * 1024;

export type CompareFailureCode = "DENIED" | "NOT_FOUND" | "TOO_LARGE" | "BINARY";

export type CompareResult =
  | { ok: true; patch: string; identical: boolean }
  | { ok: false; code: CompareFailureCode; message: string };

export const COMPARE_FAILURE_STATUS: Record<CompareFailureCode, number> = {
  DENIED: 403,
  NOT_FOUND: 404,
  TOO_LARGE: 413,
  BINARY: 415,
};

async function authorizedReadable(absolutePath: string, roots: Set<string>): Promise<boolean> {
  if (isCredentialPath(absolutePath) || isWriteProtectedPath(absolutePath)) return false;
  let real: string;
  try {
    real = await fs.realpath(absolutePath);
  } catch {
    return false;
  }
  return isPathWithinRoots(real, roots);
}

/** The patch between two files on disk. */
export async function compareFiles(
  left: string,
  right: string,
  options: { roots?: Set<string> } = {},
): Promise<CompareResult> {
  const roots = options.roots ?? resolveRealRoots(await getAllowedFileRoots());
  for (const target of [left, right]) {
    if (!await authorizedReadable(target, roots)) {
      return { ok: false, code: "DENIED", message: "Both files must be inside a browsable folder" };
    }
    const stat = await fs.stat(target).catch(() => null);
    if (!stat?.isFile()) return { ok: false, code: "NOT_FOUND", message: "The file is not on disk" };
    if (stat.size > MAX_COMPARE_BYTES) {
      return { ok: false, code: "TOO_LARGE", message: "Each file must be under 2 MB to compare" };
    }
    if (looksBinary(await fs.readFile(target, "utf8"))) {
      return { ok: false, code: "BINARY", message: "A binary file has no text diff" };
    }
  }
  const executor = new GitExecutor(path.dirname(left));
  const patch = await executor.text(
    ["-c", "core.quotepath=false", "diff", "--no-index", "--no-color", "--unified=3", "--", left, right],
    { allowedExitCodes: [0, 1], maxBuffer: 16 * 1024 * 1024 },
  );
  // Exit 0 means no difference, and git prints nothing for it.
  return { ok: true, patch, identical: patch.trim() === "" };
}
