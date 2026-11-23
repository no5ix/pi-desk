import { openSharedEventStream } from "./scheduled-tasks/shared-stream";

/**
 * One file-watch stream for every file a browser has open, shared by its tabs.
 *
 * A browser allows about six open connections to one host over HTTP/1.1. Each open file
 * tab used to take one for its own `?type=watch` stream, on top of the open session, the
 * running-session stream and any terminal: four files and a terminal left nothing for a
 * refresh's document request, and the service worker answered the starved navigation with
 * a fallback page on a healthy server (e2e/offline-navigation.mjs).
 *
 * So: one stream carries every watched file (`?type=watch-all`, lib/file-watch-stream.ts),
 * and the tabs of a browser elect a leader with the Web Locks API through
 * lib/scheduled-tasks/shared-stream.ts, which forwards the frames to the other tabs over a
 * BroadcastChannel. Two file tabs of the same file share one subscription, as do ten.
 *
 * The URL carries the whole watched set, so opening a file tab reopens the stream. The
 * leader's reconnect costs a resync per file (the same read the `connected` event already
 * triggered per file before), and a short debounce keeps a burst of opens, closes and
 * re-renders to one reopen.
 */

export const FILE_WATCH_STREAM_NAME = "pi-web:file-watch";

/**
 * The most files one stream will watch: the server's fan-in answers a list of at most this
 * many (`lib/file-watch-stream.ts`), and a URL it refuses would leave the shared stream
 * retrying every few seconds, taking the watchers of every tab down with it.
 */
export const MAX_WATCHED_FILES = 64;

export interface FileWatchTarget {
  filePath: string;
  sourceSessionId?: string | null;
}

export interface FileWatchHandlers {
  /** The stream is open (this tab leads, or the leader of the browser reconnected). */
  onConnected?: () => void;
  onChange?: (info: { mtime?: string; size?: number }) => void;
  /** The file is gone. */
  onRemoved?: () => void;
  /** The stream dropped: show the disconnected state, the shared stream reconnects. */
  onDisconnect?: () => void;
}

type FileWatchFrame =
  | { type: "connected"; paths: string[] }
  | { type: "change"; filePath: string; sessionId: string | null; mtime: string; size: number }
  | { type: "removed"; filePath: string; sessionId: string | null }
  | { type: "error"; message: string };

export interface FileWatchChannelEnv {
  openStream?: typeof openSharedEventStream;
  /** Coalesces a burst of opens and closes into one reopen of the shared stream. */
  debounceMs?: number;
}

export interface FileWatchChannel {
  subscribe(target: FileWatchTarget, handlers: FileWatchHandlers): () => void;
  /** The URL of the live shared stream, null when nothing is watched. A label, for tests and the debug view. */
  streamUrl(): string | null;
  watchedFiles(): string[];
  stop(): void;
}

function keyOf(target: FileWatchTarget): string {
  return `${target.sourceSessionId ?? ""}\u0000${target.filePath}`;
}

export function createFileWatchChannel(env: FileWatchChannelEnv = {}): FileWatchChannel {
  const openStream = env.openStream ?? openSharedEventStream;
  const debounceMs = env.debounceMs ?? 300;
  const subscribers = new Map<string, Set<FileWatchHandlers>>();
  const targets = new Map<string, FileWatchTarget>();
  let stopShared: (() => void) | null = null;
  let liveUrl: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const handlersOf = (key: string) => subscribers.get(key) ?? new Set<FileWatchHandlers>();

  const notify = (key: string, apply: (handlers: FileWatchHandlers) => void) => {
    for (const handlers of [...handlersOf(key)]) {
      try {
        apply(handlers);
      } catch {
        // One view's handler must not stop the others.
      }
    }
  };

  const notifyEverywhere = (apply: (handlers: FileWatchHandlers) => void) => {
    for (const key of [...subscribers.keys()]) notify(key, apply);
  };

  const buildUrl = (): string => {
    const entries = [...targets.values()].slice(0, MAX_WATCHED_FILES).map((target) => ({
      filePath: target.filePath,
      sessionId: target.sourceSessionId ?? null,
    }));
    const params = new URLSearchParams({ type: "watch-all", paths: JSON.stringify(entries) });
    return `/api/files/watch-all?${params.toString()}`;
  };

  const dispatch = (frame: FileWatchFrame) => {
    if (frame.type === "connected") {
      // The leader resnapshots every file it watches; so do the tabs that only listen.
      notifyEverywhere((handlers) => handlers.onConnected?.());
      return;
    }
    if (frame.type === "change") {
      notify(keyOf({ filePath: frame.filePath, sourceSessionId: frame.sessionId }),
        (handlers) => handlers.onChange?.({ mtime: frame.mtime, size: frame.size }));
      return;
    }
    if (frame.type === "removed") {
      notify(keyOf({ filePath: frame.filePath, sourceSessionId: frame.sessionId }),
        (handlers) => handlers.onRemoved?.());
      return;
    }
    if (frame.type === "error") {
      notifyEverywhere((handlers) => handlers.onDisconnect?.());
    }
  };

  const open = () => {
    if (subscribers.size === 0) {
      const previous = stopShared;
      stopShared = null;
      liveUrl = null;
      previous?.();
      return;
    }
    const url = buildUrl();
    if (url === liveUrl) return;
    const previous = stopShared;
    liveUrl = url;
    // Stop the old stream only after the new one is open: the leader's lock is released
    // and retaken in the same tick, and a gap would let another tab take the lead and open
    // a second stream for the same files.
    stopShared = openStream<FileWatchFrame>({
      url,
      name: FILE_WATCH_STREAM_NAME,
      onEvent: (event) => dispatch(event as FileWatchFrame),
      onError: () => notifyEverywhere((handlers) => handlers.onDisconnect?.()),
    });
    previous?.();
  };

  const refresh = (immediate: boolean) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (immediate || subscribers.size <= 1) {
      open();
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      open();
    }, debounceMs);
  };

  return {
    subscribe(target, handlers) {
      const key = keyOf(target);
      const set = subscribers.get(key) ?? new Set<FileWatchHandlers>();
      subscribers.set(key, set);
      targets.set(key, { filePath: target.filePath, sourceSessionId: target.sourceSessionId ?? null });
      set.add(handlers);
      // The first file of a page opens the stream at once; every file after it coalesces.
      // A burst of opens, closes and re-renders is then one reopen of one URL, and a
      // burst of reconnects is exactly what the browser's connection pool cannot afford.
      refresh(false);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const current = subscribers.get(key);
        if (!current) return;
        current.delete(handlers);
        if (current.size === 0) {
          subscribers.delete(key);
          targets.delete(key);
        }
        refresh(false);
      };
    },
    streamUrl() {
      return liveUrl;
    },
    watchedFiles() {
      return [...targets.values()].map((target) => target.filePath);
    },
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      subscribers.clear();
      targets.clear();
      const previous = stopShared;
      stopShared = null;
      liveUrl = null;
      previous?.();
    },
  };
}

const pageChannel = createFileWatchChannel();

/** Watch one file. The returned function releases the subscription; the stream closes with the last one. */
export function subscribeFileWatch(target: FileWatchTarget, handlers: FileWatchHandlers): () => void {
  return pageChannel.subscribe(target, handlers);
}
