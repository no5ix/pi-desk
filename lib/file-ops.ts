/**
 * The file tree's own operations: rename, new file, new folder, delete, and the
 * copy/cut a paste finishes.
 *
 * The rules are the write path's rules, in one place:
 *
 *  - both ends of every operation stay inside a browsable root, resolved through
 *    symlinks, so a link inside a project cannot move a file out of it (or bring
 *    one in from outside);
 *  - a protected path — a credential store, a `.git`, a key file — is never a
 *    target, because a rename is a write to the parent directory and a delete is
 *    a write to the tree;
 *  - a name is one path segment: no separator, no `..`, no dot-only name, no
 *    control character, no trailing space or dot (Windows drops them, which is
 *    how a "hidden" name is born);
 *  - nothing is erased silently: a taken name is refused, and a delete goes to
 *    the system Trash (the same rule that removed chats follow).
 *
 * The browser never names a destination outside what it was given: the source
 * path comes from the URL, the name from the body, and a paste's folder from the
 * body's `targetDirectory`, which is checked against the roots like the source.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { isCredentialPath } from "./credential-paths.ts";
import { getAllowedFileRoots } from "./file-access.ts";
import { isWriteProtectedPath } from "./file-write.ts";
import { moveFolderToTrash } from "./trash.ts";
import { isPathWithinRoots, resolveRealRoots } from "./path-security.ts";
import { samePath } from "./paths.ts";

export type FileOperation = "rename" | "create" | "mkdir" | "delete" | "copy" | "move";

export interface FileOperationRequest {
  op: FileOperation;
  /** The new name, for rename, create and mkdir. One path segment. */
  name?: string;
  /** The folder a paste writes into, for copy and move. */
  targetDirectory?: string;
  /** Replace an existing name. Off by default: a taken name is a question, not an overwrite. */
  overwrite?: boolean;
}

export type FileOperationFailureCode =
  | "BAD_REQUEST"
  | "INVALID_NAME"
  | "DENIED"
  | "NOT_FOUND"
  | "EXISTS"
  | "TOO_LARGE"
  | "FAILED";

export type FileOperationResult =
  | { ok: true; path: string; kind: "file" | "directory"; renamed?: string }
  | { ok: false; code: FileOperationFailureCode; message: string };

export const FILE_OPERATION_FAILURE_STATUS: Record<FileOperationFailureCode, number> = {
  BAD_REQUEST: 400,
  INVALID_NAME: 400,
  DENIED: 403,
  NOT_FOUND: 404,
  EXISTS: 409,
  TOO_LARGE: 413,
  FAILED: 500,
};

/** A folder copy of this size is a mistake, not an edit: refuse and say so. */
export const MAX_OPERATED_TREE_BYTES = 512 * 1024 * 1024;
const MAX_OPERATED_TREE_ENTRIES = 20_000;

const INVALID_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/;
const RESERVED_NAMES = new Set([".", "..", ".git", ".gitignore", ".gitmodules"]);

/** A single, portable path segment. `null` means the name is unusable. */
export function validateOperationName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  if (!name || name.length > 255) return null;
  if (INVALID_NAME_CHARACTERS.test(name)) return null;
  // Windows drops a trailing dot or space, so "notes." and "notes" are the same
  // file there, and a name that ends in a space can end up invisible. The check
  // runs on the input as typed: trimming first, as this function used to, made
  // the rule unreachable for the one name it exists for.
  if (/[. ]$/.test(name)) return null;
  const trimmed = name.trim();
  if (!trimmed || RESERVED_NAMES.has(trimmed)) return null;
  if (path.basename(trimmed) !== trimmed) return null;
  return trimmed;
}

function denied(message: string): FileOperationResult {
  return { ok: false, code: "DENIED", message };
}

/** The roots as the filesystem sees them, for a check that survives a symlink. */
async function realRoots(): Promise<Set<string>> {
  return resolveRealRoots(await getAllowedFileRoots());
}

/** A path that exists, resolved through its links, inside the roots. */
async function resolveAuthorizedPath(absolutePath: string, roots: Set<string>): Promise<string | null> {
  let real: string;
  try {
    real = await fs.realpath(absolutePath);
  } catch {
    return null;
  }
  return isPathWithinRoots(real, roots) ? real : null;
}

/** Where a new name would land, when its folder is authorized and the name is free. */
async function resolveNewPath(directory: string, name: string, roots: Set<string>): Promise<string | null> {
  const realDirectory = await resolveAuthorizedPath(directory, roots);
  if (!realDirectory) return null;
  return path.join(realDirectory, name);
}

function isProtected(target: string): boolean {
  return isWriteProtectedPath(target) || isCredentialPath(target);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/** The size and entry count of a tree, stopped at the caps so a huge folder is
 *  answered with a refusal instead of a long freeze. */
async function measureTree(root: string, isDirectory: boolean): Promise<{ bytes: number; entries: number } | null> {
  if (!isDirectory) {
    const stat = await fs.stat(root);
    return { bytes: stat.size, entries: 1 };
  }
  let bytes = 0;
  let entries = 0;
  const queue = [root];
  while (queue.length) {
    const directory = queue.pop() as string;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > MAX_OPERATED_TREE_ENTRIES) return null;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        queue.push(child);
        continue;
      }
      if (entry.isSymbolicLink()) continue;
      bytes += (await fs.stat(child)).size;
      if (bytes > MAX_OPERATED_TREE_BYTES) return null;
    }
  }
  return { bytes, entries };
}

/**
 * Run one operation on `sourcePath` (the path in the request URL).
 *
 * `roots` is injectable so a test can authorize a temporary folder.
 */
export async function runFileOperation(
  sourcePath: string,
  request: FileOperationRequest,
  options: { roots?: Set<string> } = {},
): Promise<FileOperationResult> {
  const roots = options.roots ?? await realRoots();
  const name = request.name === undefined ? undefined : validateOperationName(request.name);
  if (request.op !== "delete" && request.op !== "copy" && request.op !== "move" && name === undefined) {
    return { ok: false, code: "BAD_REQUEST", message: `${request.op} needs a name` };
  }
  if ((request.op === "rename" || request.op === "create" || request.op === "mkdir") && name === null) {
    return { ok: false, code: "INVALID_NAME", message: "The name must be one folder name, without a path separator" };
  }

  const source = await resolveAuthorizedPath(sourcePath, roots);
  if (!source) return { ok: false, code: "NOT_FOUND", message: "The path is not available" };
  if (isProtected(source)) return denied("That path is protected");

  const sourceStat = await fs.lstat(source);
  const kind = sourceStat.isDirectory() ? "directory" : "file";

  if (request.op === "delete") {
    // A root itself is not the tree's to delete.
    for (const root of roots) {
      if (samePath(root, source)) return denied("A project folder is not deleted here");
    }
    const trash = await moveFolderToTrash(source);
    return { ok: true, path: source, kind, renamed: trash };
  }

  if (request.op === "copy" || request.op === "move") {
    const directory = request.targetDirectory;
    if (typeof directory !== "string" || !directory.trim()) {
      return { ok: false, code: "BAD_REQUEST", message: "A paste needs the folder to paste into" };
    }
    const target = await resolveNewPath(directory, path.basename(source), roots);
    if (!target) return denied("The paste folder is not available");
    if (isProtected(target)) return denied("That folder is protected");
    if (samePath(target, source)) return denied("A folder cannot be pasted into itself");
    if (kind === "directory" && (target.startsWith(`${source}${path.sep}`) || samePath(target, source))) {
      return denied("A folder cannot be pasted inside itself");
    }
    if (!request.overwrite && await exists(target)) {
      return { ok: false, code: "EXISTS", message: `${path.basename(target)} is already in that folder` };
    }
    const measured = await measureTree(source, sourceStat.isDirectory());
    if (!measured) {
      return { ok: false, code: "TOO_LARGE", message: "That folder is too big to copy here" };
    }
    if (request.op === "copy") {
      await fs.cp(source, target, { recursive: true, force: Boolean(request.overwrite), errorOnExist: !request.overwrite, preserveTimestamps: true });
      return { ok: true, path: target, kind };
    }
    if (request.overwrite && await exists(target)) await removeTarget(target);
    await fs.rename(source, target);
    return { ok: true, path: target, kind };
  }

  // rename, create, mkdir: the target is a name in the source's folder (rename,
  // create) or in the folder named by the request (mkdir on a folder row).
  const directory = request.op === "rename" ? path.dirname(source) : source;
  const folderStat = await fs.stat(directory).catch(() => null);
  if (!folderStat?.isDirectory()) return { ok: false, code: "BAD_REQUEST", message: "The folder is not a folder" };
  const target = await resolveNewPath(directory, name as string, roots);
  if (!target) return denied("The folder is not available");
  if (isProtected(target)) return denied("That path is protected");
  const taken = await exists(target);
  if (taken && request.op !== "create" && !request.overwrite) {
    return { ok: false, code: "EXISTS", message: `${name} is already in that folder` };
  }
  if (request.op === "mkdir") {
    if (taken && !request.overwrite) return { ok: false, code: "EXISTS", message: `${name} is already in that folder` };
    await fs.mkdir(target, { recursive: Boolean(request.overwrite) });
    return { ok: true, path: target, kind: "directory" };
  }
  if (request.op === "create") {
    // A new file: never clobber, whatever the caller asked, because this is the
    // one operation whose target the user has not looked at yet.
    if (taken) return { ok: false, code: "EXISTS", message: `${name} is already in that folder` };
    const handle = await fs.open(target, "wx");
    await handle.close();
    return { ok: true, path: target, kind: "file" };
  }
  // rename: the file keeps its content and its folder; a directory rename is the
  // same one rename.
  if (samePath(target, source)) return { ok: true, path: source, kind };
  if (taken && kind === "directory") return { ok: false, code: "EXISTS", message: `${name} is already in that folder` };
  if (taken && !request.overwrite) return { ok: false, code: "EXISTS", message: `${name} is already in that folder` };
  if (taken) await removeTarget(target);
  await fs.rename(source, target);
  return { ok: true, path: target, kind };
}

/** Remove a single file, or a directory tree, to make room for an explicit
 *  overwrite. The Trash rule applies to the tree the user can see; an overwrite
 *  is a named action on one path, so it goes directly. */
async function removeTarget(target: string): Promise<void> {
  const stat = await fs.lstat(target);
  if (stat.isDirectory()) {
    await fs.rm(target, { recursive: true, force: true });
    return;
  }
  await fs.rm(target);
}
