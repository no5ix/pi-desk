import fs from "fs";
import path from "path";
import { registerFileWatch } from "./file-watch-registry";
import { pageStreamLabel, registerPageStream } from "./page-stream-registry";

/**
 * One file-watch stream for many files.
 *
 * A browser allows about six open connections to one host over HTTP/1.1, and every open
 * file tab used to take one of them for its own `?type=watch` stream (the reason
 * lib/scheduled-tasks/shared-stream.ts exists). Four open files and a terminal left the
 * browser's pool empty: a refresh's document request queued behind them, the service
 * worker's navigation budget ran out, and a healthy local server was shown as offline
 * (e2e/offline-navigation.mjs). The client opens one stream for every file it watches, and
 * this fan-in keeps one `fs.watch` per file behind it.
 *
 * The frames are unnamed (`data:` only) on purpose: the client shares the stream between
 * tabs through lib/scheduled-tasks/shared-stream.ts, which forwards `onmessage`, and named
 * events never reach it.
 *
 * Every path is authorized by the caller (app/api/files/[...path]/route.ts) before it gets
 * here; nothing in this file decides access.
 */

export interface FileWatchEntry {
  filePath: string;
  sessionId: string | null;
}

/** More files than anyone has open in tabs; a longer list is a client bug, not a use case. */
export const MAX_WATCHED_FILES_PER_STREAM = 64;

export type FileWatchFrame =
  | { type: "connected"; paths: string[] }
  | { type: "change"; filePath: string; sessionId: string | null; mtime: string; size: number }
  | { type: "removed"; filePath: string; sessionId: string | null }
  | { type: "error"; message: string };

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** The fields the per-file `?type=watch` stream compares before it reports a change. */
interface FileSignature {
  exists: boolean;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  size: number;
}

const ABSENT: FileSignature = { exists: false, mtimeMs: 0, ctimeMs: 0, ino: 0, size: 0 };

function signatureOf(filePath: string): FileSignature {
  try {
    const stat = fs.statSync(filePath);
    return { exists: true, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino, size: stat.size };
  } catch {
    return ABSENT;
  }
}

/** Two entries may watch the same file for two sessions; the map keys keep them apart. */
function watchKey(entry: FileWatchEntry): string {
  return `${entry.sessionId ?? ""}\u0000${entry.filePath}`;
}

// The route bundle and this module are separate graphs, so this mirrors the route's
// samePath rather than importing it.
function isSameFile(left: string, right: string): boolean {
  const normalize = (value: string) =>
    path.resolve(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
}

export function createFileWatchStream(entries: FileWatchEntry[], request: Request): Response {
  const watchers = new Map<string, fs.FSWatcher>();
  let closed = false;

  const closeWatchers = () => {
    for (const watcher of watchers.values()) {
      try {
        watcher.close();
      } catch {
        // Already closed.
      }
    }
    watchers.clear();
  };

  // One connection, one entry in the debug panel's count of open streams: what the
  // browser's pool spends is the connection, not the watchers behind it. Counted from the
  // call, before the stream's start runs, so a request that never streams is still counted
  // and released like every other.
  const releaseWatch = registerFileWatch();
  const releasePage = registerPageStream(pageStreamLabel("file-watch", request));
  const release = () => {
    if (closed) return;
    closed = true;
    closeWatchers();
    releaseWatch();
    releasePage();
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = (frame: FileWatchFrame) => {
        try {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch {
          // The client is gone; the request's abort signal closes the watchers.
        }
      };

      for (const entry of entries) {
        const watchedDirectory = path.dirname(entry.filePath);
        let last = signatureOf(entry.filePath);
        let watcher: fs.FSWatcher;
        try {
          watcher = fs.watch(watchedDirectory, (_eventType, changedName) => {
            if (
              changedName != null
              && !isSameFile(path.join(watchedDirectory, changedName.toString()), entry.filePath)
            ) {
              return;
            }
            const current = signatureOf(entry.filePath);
            if (!current.exists) {
              if (!last.exists) return;
              last = ABSENT;
              send({ type: "removed", filePath: entry.filePath, sessionId: entry.sessionId });
              return;
            }
            // Some platforms report a change for reads and attribute access. The per-file
            // stream ignores those so a client's own refresh read cannot loop.
            if (
              last.exists
              && current.mtimeMs === last.mtimeMs
              && current.ctimeMs === last.ctimeMs
              && current.ino === last.ino
              && current.size === last.size
            ) {
              return;
            }
            last = current;
            send({
              type: "change",
              filePath: entry.filePath,
              sessionId: entry.sessionId,
              mtime: new Date(current.mtimeMs).toISOString(),
              size: current.size,
            });
          });
        } catch (error) {
          send({ type: "error", message: `Failed to watch ${path.basename(entry.filePath)}: ${String(error)}` });
          continue;
        }
        watcher.on("error", () => {
          try {
            watcher.close();
          } catch {
            // Already closed.
          }
          watchers.delete(watchKey(entry));
          // The client has no way to know which file this watcher belonged to, so the
          // stream ends and the client's EventSource reconnects.
          release();
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        });
        watchers.set(watchKey(entry), watcher);
      }

      // After the watchers exist, as the per-file stream does: the client snapshots
      // between the two steps, and a change in that gap must not be dropped.
      send({ type: "connected", paths: entries.map((entry) => entry.filePath) });

      if (request.signal.aborted) {
        release();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
        return;
      }
      request.signal.addEventListener("abort", () => {
        release();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }, { once: true });
    },
    cancel() {
      release();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
