import fs from "node:fs/promises";
import path from "node:path";
import { getAllowedFileRoots, isFilePathAllowed } from "./file-access.ts";
import { isCredentialPath } from "./credential-paths.ts";

/** The read endpoint's text preview cap; a save is a write of what can be read. */
export const MAX_WRITE_SIZE = 2 * 1024 * 1024;

export type FileWriteFailureCode =
  | "FORBIDDEN"
  | "OUTSIDE_ROOT"
  | "NOT_A_FILE"
  | "TOO_LARGE"
  | "BINARY"
  | "CONFLICT"
  | "READ_ONLY"
  | "FAILED";

export type FileWriteResult =
  | { ok: true; mtimeMs: number; size: number; etag: string }
  | { ok: false; code: FileWriteFailureCode; message: string };

/** A file this API never writes, whatever the allow-list says: the credential
 *  stores the read path refuses to serve, and the repository's own object
 *  store, where a stray write corrupts the history. */
export function isWriteProtectedPath(filePath: string): boolean {
  if (isCredentialPath(filePath)) return true;
  const normalized = path.resolve(filePath);
  return normalized.split(path.sep).includes(".git");
}

/** More than a NUL byte check: a save writes text, and a file full of control
 *  characters means a binary was opened and typed into. */
export function looksBinary(content: string): boolean {
  const probe = content.length > 8192 ? content.slice(0, 8192) : content;
  if (probe.includes("\u0000")) return true;
  let control = 0;
  for (let i = 0; i < probe.length; i++) {
    const code = probe.charCodeAt(i);
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 32 || code === 127) control++;
  }
  return control > probe.length * 0.02;
}

export function fileEtag(mtimeMs: number, size: number): string {
  return `W/"${Math.round(mtimeMs).toString(36)}-${size.toString(36)}"`;
}

/**
 * Resolve the real location of a path that may not exist yet, by walking to the
 * nearest existing ancestor. Writing through a symlink that leaves the allowed
 * roots must fail exactly as reading through one does.
 */
async function realAncestor(absolutePath: string): Promise<string | null> {
  let current = path.resolve(absolutePath);
  for (let depth = 0; depth < 64; depth++) {
    try {
      return await fs.realpath(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
  return null;
}

/**
 * Write a text file inside the allowed roots.
 *
 * The caller has already applied the request-level checks (allow-list,
 * credential paths). This is the write half: the same roots re-checked against
 * the resolved path, the size cap, the binary guard, the protected-path guard,
 * the "changed on disk" guard, and an atomic replace.
 *
 * `baseMtimeMs` is the modification time the editor read. When the file has
 * moved on since — a formatter, a git operation, another window — the write is
 * refused rather than silently overwriting what arrived.
 */
export async function writeProjectFile(
  filePath: string,
  content: string,
  options: { baseMtimeMs?: number; allowOverwrite?: boolean } = {},
): Promise<FileWriteResult> {
  const target = path.resolve(filePath);
  const allowedRoots = await getAllowedFileRoots();
  if (!isFilePathAllowed(target, allowedRoots)) {
    return { ok: false, code: "OUTSIDE_ROOT", message: "The file is outside the allowed project folders." };
  }
  if (isWriteProtectedPath(target)) {
    return { ok: false, code: "READ_ONLY", message: "Credential stores and repository internals are not writable." };
  }
  const real = await realAncestor(target);
  if (real === null) {
    return { ok: false, code: "FORBIDDEN", message: "The path could not be resolved." };
  }
  if (!isFilePathAllowed(real, allowedRoots) || isWriteProtectedPath(real)) {
    return {
      ok: false,
      code: "OUTSIDE_ROOT",
      message: "The path leaves the allowed project folders through a link.",
    };
  }

  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_SIZE) {
    return { ok: false, code: "TOO_LARGE", message: `The content is larger than ${MAX_WRITE_SIZE} bytes.` };
  }
  if (looksBinary(content)) {
    return { ok: false, code: "BINARY", message: "Binary content cannot be written as text." };
  }

  let previous: { mtimeMs: number; size: number; mode: number } | null = null;
  try {
    const stat = await fs.stat(real);
    if (!stat.isFile()) return { ok: false, code: "NOT_A_FILE", message: "The path is not a file." };
    previous = { mtimeMs: stat.mtimeMs, size: stat.size, mode: stat.mode };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return { ok: false, code: "FAILED", message: "The file could not be read." };
    }
  }
  if (
    previous
    && typeof options.baseMtimeMs === "number"
    && !options.allowOverwrite
    && Math.round(previous.mtimeMs) !== Math.round(options.baseMtimeMs)
  ) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "The file changed on disk since it was opened. Reload it before saving.",
    };
  }

  // Write beside the target and rename, so an interrupted write cannot leave a
  // half-written file where a complete one was. Same directory keeps the rename
  // atomic; a cross-device temp directory would not. The mode is carried over.
  const directory = path.dirname(real);
  const temporary = path.join(directory, `.${path.basename(real)}.pi-write-${process.pid}-${Date.now()}.tmp`);
  try {
    await fs.writeFile(temporary, content, "utf8");
    if (previous) await fs.chmod(temporary, previous.mode & 0o777);
    await fs.rename(temporary, real);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    return { ok: false, code: "FAILED", message: (error as Error).message };
  }
  const written = await fs.stat(real);
  return { ok: true, mtimeMs: written.mtimeMs, size: written.size, etag: fileEtag(written.mtimeMs, written.size) };
}

/** The metadata an editor needs to notice a change it did not make. */
export async function readFileFingerprint(absolutePath: string) {
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return null;
    return { mtimeMs: stat.mtimeMs, size: stat.size, etag: fileEtag(stat.mtimeMs, stat.size) };
  } catch {
    return null;
  }
}
