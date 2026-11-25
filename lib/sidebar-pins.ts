/**
 * The sidebar's pins — sessions, chats, projects — read from the server's
 * session UI state (`lib/session-ui-state.ts`, `<agentDir>/pi-web-session-state.json`)
 * and the local pins an older build left in `localStorage`.
 *
 * One server serves several browsers and devices, so a pin kept in
 * `localStorage` shows in exactly one of them: a session pinned in Safari was
 * missing in Edge, and a phone showed none at all. The server file is the
 * single answer, and every window gets the same tree. This module holds the
 * pure rules — the sets the tree reads, the requests that move an older
 * browser's local pins onto the server — so `hooks/useSidebarPins.ts` stays
 * wiring and a test can drive both without a DOM.
 *
 * Client-safe: no Node imports.
 */

import { APP_PREF_KEYS, getPref, getPrefJson, removePref, setPref, type AppPrefKey } from "./app-prefs";
import {
  chunkForSessionUiRequests,
  MAX_PROJECT_STRING_LENGTH,
  MAX_SESSION_UI_IDS_PER_REQUEST,
  SESSION_ID_PATTERN,
  type SessionUiState,
  type SessionUiStateRequest,
} from "./session-ui-state-shared";

/** The id sets an older build kept per browser, before pins moved to the server. */
const LOCAL_SESSION_PIN_KEYS = [APP_PREF_KEYS.pinnedChats, APP_PREF_KEYS.pinnedSessions] as const;
const LOCAL_PROJECT_PIN_KEYS = [APP_PREF_KEYS.pinnedProjects] as const;

/** Family root session ids with a `pinnedAt`: what the tree checks per row. */
export function pinnedIdsOf(state: SessionUiState): Set<string> {
  const ids = new Set<string>();
  for (const [id, entry] of Object.entries(state.sessions)) {
    if (typeof entry?.pinnedAt === "number") ids.add(id);
  }
  return ids;
}

/**
 * Project roots of every `state.projects` entry. A project pin is the whole
 * entry (`{ pinnedAt, root }`), and the root is kept even for a project with
 * no live session, so the sidebar — which groups by root — can mark it.
 */
export function pinnedProjectRootsOf(state: SessionUiState): Set<string> {
  const roots = new Set<string>();
  for (const entry of Object.values(state.projects)) {
    if (typeof entry?.pinnedAt === "number" && typeof entry.root === "string" && entry.root) roots.add(entry.root);
  }
  return roots;
}

/** A project pin is keyed by the project root, the key `groupByProject` groups by. */
export function projectPinKeyOf(root: string): string {
  return root;
}

function readLocalIdSet(key: AppPrefKey): string[] {
  const stored = getPrefJson<unknown>(key);
  if (!Array.isArray(stored)) return [];
  return stored.filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * What this browser's older build pinned, before the first server sync. An
 * empty array for every key is normal: the browser pinned nothing, or the
 * pins are already on the server.
 */
export function readLocalPins(): { ids: string[]; roots: string[] } {
  const ids = new Set<string>();
  for (const key of LOCAL_SESSION_PIN_KEYS) for (const id of readLocalIdSet(key)) ids.add(id);
  const roots = new Set<string>();
  for (const key of LOCAL_PROJECT_PIN_KEYS) for (const root of readLocalIdSet(key)) roots.add(root);
  return { ids: [...ids], roots: [...roots] };
}

/**
 * The writes that move `local` onto the server: one `set` per chunk of session
 * ids, one `pin-project` per project root. Nothing pinned locally is a
 * nothing-to-migrate, and the caller marks the browser migrated for it.
 *
 * What the server would refuse is dropped here: one id that is not a session
 * id, or one root over the project-key length, refuses its whole request, and
 * a refused migration never finishes (the browser would push the same pins on
 * every load). Old prefs held what the sidebar wrote, so this is a guard, not
 * a parser.
 */
export function pinRequestsForLocalPins(
  local: { ids: readonly string[]; roots: readonly string[] },
  chunkSize = MAX_SESSION_UI_IDS_PER_REQUEST,
): SessionUiStateRequest[] {
  const ids = local.ids.filter((id) => SESSION_ID_PATTERN.test(id));
  const roots = local.roots.filter((root) => root.length > 0 && root.length <= MAX_PROJECT_STRING_LENGTH);
  const requests: SessionUiStateRequest[] = [];
  for (const chunk of chunkForSessionUiRequests(ids, chunkSize)) requests.push({ action: "set", ids: chunk, pinned: true });
  for (const root of roots) {
    requests.push({ action: "pin-project", projectKey: projectPinKeyOf(root), root, pinned: true });
  }
  return requests;
}

/** True once this browser has pushed (or skipped) its local pins. */
export function localPinsMigrated(): boolean {
  return getPref(APP_PREF_KEYS.pinsMigratedToServer) === "1";
}

export function markLocalPinsMigrated(): void {
  setPref(APP_PREF_KEYS.pinsMigratedToServer, "1");
}

/** Drop the retired per-browser keys, so a later build never re-pushes them. */
export function forgetLocalPins(): void {
  for (const key of [...LOCAL_SESSION_PIN_KEYS, ...LOCAL_PROJECT_PIN_KEYS]) removePref(key);
}
