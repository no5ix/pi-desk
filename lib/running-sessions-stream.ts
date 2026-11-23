/**
 * The name of the shared stream that carries the set of running sessions to every tab.
 *
 * A browser allows only about six open connections to one host over HTTP/1.1, and each tab
 * of this app already holds several long-lived ones. The running-sessions stream is pure
 * browser chrome — every tab wants the same frames — so the tabs elect one leader and share
 * it (lib/scheduled-tasks/shared-stream.ts). The name is both the Web Lock name and the
 * BroadcastChannel name, so a tab of the desktop app and the phone's relay shell, which are
 * different origins, keep their own.
 */
export const RUNNING_SESSIONS_STREAM_NAME = "pi-web:running-sessions";
