import { randomUUID } from "crypto";
import { chmodSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";

/**
 * Replace a file atomically: the bytes land in a sibling temp file that is then
 * renamed onto the destination, so a process killed mid-write leaves the old
 * file whole. The caller must create the parent directory first.
 */
function writeFileAtomicSync(path: string, contents: string, mode: number, exactMode = false): void {
  const dir = dirname(path);
  const tempPath = join(dir, `.${basename(path)}-${randomUUID()}.tmp`);
  let operationFailed = false;

  try {
    writeFileSync(tempPath, contents, {
      encoding: "utf8",
      flag: "wx",
      mode,
      flush: true,
    });
    // The umask masked `mode`; a replaced file gets its exact bits back before it takes the name.
    if (exactMode) chmodSync(tempPath, mode);
    renameSync(tempPath, path);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    try {
      unlinkSync(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !operationFailed) {
        throw error;
      }
    }
  }
}

/**
 * Replace a file atomically without exposing credentials through default
 * process permissions. The caller must create the parent directory first.
 */
export function writePrivateFileAtomicSync(path: string, contents: string): void {
  writeFileAtomicSync(path, contents, 0o600);
}

/**
 * Replace an existing session file atomically, keeping the mode pi gave it
 * (a new file takes pi's 0644 default through the umask, never the private 0600).
 */
export function writeSessionFileAtomicSync(path: string, contents: string): void {
  // A symlinked session file keeps its link: the bytes replace the file it points at.
  let target = path;
  try { target = realpathSync(path); } catch { /* a new file */ }
  const existingMode = statSync(target, { throwIfNoEntry: false })?.mode;
  if (existingMode === undefined) writeFileAtomicSync(target, contents, 0o644);
  else writeFileAtomicSync(target, contents, existingMode & 0o777, true);
}

/**
 * Replace a file the user owns (a session transcript, settings.json, a SKILL.md,
 * auth.json) so that a crash or a full disk leaves either the old text or the
 * new one, never a truncated file. A symlinked file is replaced at its target,
 * keeping the link (dotfiles setups link ~/.pi/agent files), and the file keeps
 * its permission bits unless `mode` is given.
 */
export function replaceFileAtomicSync(path: string, contents: string, options: { mode?: number } = {}): void {
  let target = path;
  let mode = options.mode;
  try {
    target = realpathSync(path);
    mode ??= statSync(target).mode & 0o7777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  // A new file keeps pi's 0644 default through the umask; a replaced file keeps its exact bits.
  if (mode === undefined) writeFileAtomicSync(target, contents, 0o644);
  else writeFileAtomicSync(target, contents, mode, true);
}
