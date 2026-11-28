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
  | "NOT_FOUND"
  | "FAILED";

export type FileWriteResult =
  | {
      ok: true;
      mtimeMs: number;
      size: number;
      etag: string;
      /** The file did not exist before this write. */
      created: boolean;
      /** A disk change the caller accepted with `allowOverwrite`. */
      overwritten: boolean;
    }
  | { ok: false; code: FileWriteFailureCode; message: string };

/** A file this API never writes, whatever the allow-list says: the credential
 *  stores the read path refuses to serve, and the repository's own object
 *  store, where a stray write corrupts the history. */
/**
 * A path the write API never touches, whatever the allow-list says.
 *
 * `isCredentialPath` is anchored at the home folders, which is right for the
 * read side. A project checkout can carry the same secrets — a vendored `.ssh`,
 * a key file, a repository's own internals — so the rule here is structural:
 * the secret directory names, the named credential files, and any `.git`
 * (git's hooks run as the user, so writing one is running code).
 */
const PROTECTED_DIRECTORIES = [
  ".ssh", ".gnupg", ".aws", ".azure", ".kube", ".password-store", ".git",
];
const PROTECTED_BASENAMES = [
  ".netrc", ".git-credentials", ".npmrc", ".pgpass", "id_rsa", "id_ed25519",
  "id_ecdsa", "id_dsa", "credentials", "htpasswd",
];

export function isWriteProtectedPath(filePath: string): boolean {
  if (isCredentialPath(filePath)) return true;
  const segments = path.resolve(filePath).split(path.sep).filter(Boolean).map((part) => part.toLowerCase());
  if (segments.some((part) => PROTECTED_DIRECTORIES.includes(part))) return true;
  const base = segments[segments.length - 1] ?? "";
  if (PROTECTED_BASENAMES.includes(base)) return true;
  if (base.endsWith(".pem") || base.endsWith(".p12") || base.endsWith(".key")) return true;
  // The named credentials that live inside a config folder.
  const tail = segments.slice(-3).join("/");
  return [".docker/config.json", ".config/gh/hosts.yml", ".pi/agent/auth.json"].some((suffix) => tail.endsWith(suffix));
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
/**
 * The path the write lands on, with the part that exists read through its links.
 *
 * A new file's folder may not exist yet, so the whole path cannot be realpath'd.
 * The walk goes up to the nearest existing ancestor, resolves that (a symlink
 * out of the project is visible here), and appends the missing segments — the
 * new folders the write is allowed to create.
 */
async function resolveWriteTarget(absolutePath: string): Promise<string | null> {
  const missing: string[] = [];
  let current = path.resolve(absolutePath);
  for (let depth = 0; depth < 64; depth++) {
    let exists = true;
    try {
      await fs.lstat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
      exists = false;
    }
    if (exists) {
      const realBase = await fs.realpath(current).catch(() => null);
      if (realBase === null) return null;
      return path.resolve(realBase, ...missing);
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    missing.unshift(path.basename(current));
    current = parent;
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
  const real = await resolveWriteTarget(target);
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
  // The caller read a file that is no longer there. Recreating it would invent
  // a file the user never asked for, so the save is refused.
  if (!previous && typeof options.baseMtimeMs === "number") {
    return { ok: false, code: "NOT_FOUND", message: "The file is no longer on disk." };
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
    // A new file in a folder the project has not created yet: the folders come
    // with it, which is what a save of a new source file means.
    if (previous === null) await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporary, content, "utf8");
    if (previous) await fs.chmod(temporary, previous.mode & 0o777);
    await fs.rename(temporary, real);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => {});
    return { ok: false, code: "FAILED", message: (error as Error).message };
  }
  const written = await fs.stat(real);
  return {
    ok: true,
    mtimeMs: written.mtimeMs,
    size: written.size,
    etag: fileEtag(written.mtimeMs, written.size),
    created: previous === null,
    overwritten: Boolean(
      previous
      && options.allowOverwrite
      && typeof options.baseMtimeMs === "number"
      && Math.round(previous.mtimeMs) !== Math.round(options.baseMtimeMs),
    ),
  };
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
