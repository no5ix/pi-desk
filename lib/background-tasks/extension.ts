/**
 * Getting `pi-background-tasks` into a pi-desk session, exactly once.
 *
 * The extension is the single source of truth for background tasks; pi-desk adds no task
 * registry of its own. For the panel to have anything to read, the extension has to be
 * *loaded in the session's extension runtime* — the same runtime whose EventBus the host
 * client talks to (lib/background-tasks/host-client.ts). Two ways that happens:
 *
 * 1. the user installed it for Pi (`pi install npm:pi-background-tasks`, i.e. an entry in
 *    `settings.json`'s `packages`), and the SDK's package manager loads it;
 * 2. pi-desk ships it as a dependency and registers its entrypoint through the loader's
 *    documented `additionalExtensionPaths`, so a plain `npm run dev` gets the panel with no
 *    setup in pi's own settings.
 *
 * When both are true the loader would create **two activations** in one session: two
 * registries, and a panel that shows the tasks of whichever one answered. `extensionsOverride`
 * is the documented hook for the app's opinion about the loaded set, and
 * `dedupeBackgroundTasksExtensions` is that opinion: one background-task activation per
 * session, preferring the copy the user installed (it follows `pi install` updates, and it is
 * the one the user's own `/bg`, `/tasks` and dock are attached to).
 *
 * The entrypoint is taken from the package's `pi.extensions` manifest, never hard-coded to a
 * `dist/src/**` chunk — those are private compiled modules the extension's own docs forbid
 * importing as roots.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import {
  DefaultPackageManager,
  getAgentDir,
  getPackageDir,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Extension, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { getProjectTrustStatus } from "../project-trust";

export const BACKGROUND_TASKS_PACKAGE_NAME = "pi-background-tasks";
/** The manifest entry that registers the task registry, the tools, the dock and the host interface. */
export const BACKGROUND_TASKS_ENTRY_RELATIVE_PATH = "dist/extensions/background-tasks.js";
/** The package's own name for that resource (`pi.extensions[].name` in its package.json). */
export const BACKGROUND_TASKS_EXTENSION_RESOURCE_NAME = "background-tasks";

/** Set to `1`/`true` to keep the extension out of every session — the panel then says so. */
export function isBackgroundTasksDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = (env.PI_WEB_DISABLE_BACKGROUND_TASKS ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

/** A checkout to load instead of the installed package, for developing against an unreleased version. */
export function backgroundTasksOverridePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = (env.PI_WEB_BACKGROUND_TASKS_PATH ?? "").trim();
  return value.length > 0 ? resolve(value) : undefined;
}

interface PackageManifest {
  name?: string;
  pi?: { extensions?: unknown };
}

/** A configured plugin package that points at this extension, and the scope it is installed in. */
export interface InstalledBackgroundTasksPackage {
  root: string;
  scope: "user" | "project";
}

function readPackageManifest(packageRoot: string): PackageManifest | undefined {
  try {
    return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as PackageManifest;
  } catch {
    return undefined;
  }
}

/**
 * The manifest resource that carries the task registry: the one named `background-tasks`, else
 * the file named `background-tasks*`. A package that lists several resources and names none of
 * them that is not used — loading an unrelated extension and calling it the task registry is
 * worse than the panel saying the extension is not installed.
 */
export function pickBackgroundTasksExtensionFile(
  manifest: PackageManifest | undefined,
  packageRoot: string,
): string | null {
  const declared = Array.isArray(manifest?.pi?.extensions) ? (manifest!.pi!.extensions as unknown[]) : [];
  const candidates: Array<{ name: string; file: string }> = [];
  for (const item of declared) {
    const spec = typeof item === "string"
      ? { name: undefined as string | undefined, path: item }
      : item && typeof item === "object"
        ? {
            name: typeof (item as { name?: unknown }).name === "string" ? (item as { name: string }).name : undefined,
            path: typeof (item as { path?: unknown }).path === "string" ? (item as { path: string }).path : "",
          }
        : { name: undefined, path: "" };
    if (spec.path.length === 0) continue;
    const file = isAbsolute(spec.path) ? spec.path : resolve(packageRoot, spec.path.replace(/^\.\//, ""));
    candidates.push({ name: spec.name ?? basename(file, extname(file)), file });
  }
  const named = candidates.find((candidate) => candidate.name === BACKGROUND_TASKS_EXTENSION_RESOURCE_NAME)
    ?? candidates.find((candidate) => basename(candidate.file).startsWith(BACKGROUND_TASKS_EXTENSION_RESOURCE_NAME));
  return named ? named.file : null;
}

/** True when a configured plugin source names this package (`npm:pi-background-tasks`, a git URL). */
export function backgroundTasksPackageSourceMatches(source: string, packageName = BACKGROUND_TASKS_PACKAGE_NAME): boolean {
  const tail = source.trim().replace(/\/+$/, "").split("/").pop() ?? "";
  const name = tail.startsWith("npm:") ? tail.slice("npm:".length) : tail;
  return name === packageName || name.endsWith(`/${packageName}`);
}

/**
 * The plugin packages the user configured for pi that are this package, in priority order: the
 * user/global install (`pi install npm:pi-background-tasks` → `~/.pi/agent/npm/node_modules/…`,
 * what Settings › Plugins shows) first, then a project-scoped one. An entry with resource
 * filters, or switched off in Settings, is skipped: that is the user's own decision about this
 * package's resources, and forcing it on would override it. A project-scoped package is project
 * code, so an untrusted project does not get it.
 */
export function configuredBackgroundTasksPackages(
  cwd: string,
  deps: { agentDir?: string; isProjectTrusted?: (cwd: string) => boolean } = {},
): InstalledBackgroundTasksPackage[] {
  const agentDir = deps.agentDir ?? getAgentDir();
  const isProjectTrusted = deps.isProjectTrusted ?? ((target: string) => getProjectTrustStatus(target, agentDir).trusted);
  try {
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: isProjectTrusted(cwd) });
    const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    const found: InstalledBackgroundTasksPackage[] = [];
    for (const pkg of packageManager.listConfiguredPackages()) {
      if (!pkg.installedPath || pkg.filtered) continue;
      if (pkg.scope !== "user" && pkg.scope !== "project") continue;
      if (!backgroundTasksPackageSourceMatches(pkg.source)) continue;
      if (pkg.scope === "project" && !isProjectTrusted(cwd)) continue;
      found.push({ root: pkg.installedPath, scope: pkg.scope });
    }
    return found.sort((a, b) => (a.scope === b.scope ? 0 : a.scope === "user" ? -1 : 1));
  } catch {
    return [];
  }
}

/** How long a cwd's resolved entrypoint is reused, so a plugin installed while the app runs appears. */
export const BACKGROUND_TASKS_ENTRY_TTL_MS = 30_000;
const entryPathCache = new Map<string, { at: number; entryPath: string | null }>();

/** Drop the per-cwd resolution (a plugin was installed, removed, or a test needs a clean slate). */
export function invalidateBackgroundTasksEntryCache(cwd?: string): void {
  if (cwd === undefined) entryPathCache.clear();
  else entryPathCache.delete(cwd);
}

/**
 * The extension path for one conversation's working directory: the copy the user installed for
 * pi wins, then the copy this checkout ships (`node_modules/pi-background-tasks`, so a plain
 * `npm run dev` from the app's own directory works with no setup in pi's settings).
 *
 * Only the app's `node_modules` is not enough: the app runs from any checkout — a linked
 * worktree has no dependency of its own — while `pi install npm:pi-background-tasks` lands under
 * the agent dir for every pi process on the machine. That is the copy the Plugins page shows as
 * Loaded, the one `/bg` runs, and the one the panel must talk to.
 */
export function resolveBackgroundTasksEntryForCwd(
  cwd: string,
  source: { resolveInstalledPackages?: (cwd: string) => InstalledBackgroundTasksPackage[] } = {},
): string | null {
  const cached = entryPathCache.get(cwd);
  if (cached && Date.now() - cached.at < BACKGROUND_TASKS_ENTRY_TTL_MS) return cached.entryPath;
  const installed = source.resolveInstalledPackages ?? ((target: string) => configuredBackgroundTasksPackages(target));
  let entryPath: string | null = null;
  for (const pkg of installed(cwd)) {
    const file = pickBackgroundTasksExtensionFile(readPackageManifest(pkg.root), pkg.root);
    if (file && existsSync(file)) {
      entryPath = file;
      break;
    }
  }
  if (!entryPath) {
    const shipped = resolveInstalledBackgroundTasksEntry();
    entryPath = shipped && existsSync(shipped) ? shipped : null;
  }
  entryPathCache.set(cwd, { at: Date.now(), entryPath });
  return entryPath;
}

/** The path of the installed package's host entrypoint, from its own manifest. */
export function resolveInstalledBackgroundTasksEntry(packageName = BACKGROUND_TASKS_PACKAGE_NAME): string | null {
  try {
    const require = createRequire(join(process.cwd(), "package.json"));
    const manifestPath = require.resolve(`${packageName}/package.json`);
    const manifest = JSON.parse(require("node:fs").readFileSync(manifestPath, "utf8")) as PackageManifest;
    const declared = Array.isArray(manifest.pi?.extensions) ? (manifest.pi.extensions as unknown[]) : [];
    // Prefer the manifest's own ordering; fall back to the documented path when the
    // manifest lists nothing (an older package layout).
    const entries = declared.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    const candidate = entries.find((entry) => entry.includes("background-tasks"))
      ?? entries[entries.length - 1]
      ?? BACKGROUND_TASKS_ENTRY_RELATIVE_PATH;
    const entry = resolve(dirname(manifestPath), candidate.replace(/^\.\//, ""));
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

export interface BackgroundTasksExtensionSource {
  /** The absolute entrypoint the loader should load, or null when there is nothing to load. */
  entryPath: string | null;
  /** Why there is nothing, for the panel's "unavailable" state and the docs. */
  reason: "disabled" | "not-installed" | null;
}

export function resolveBackgroundTasksExtension(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  source: { resolveInstalledPackages?: (cwd: string) => InstalledBackgroundTasksPackage[] } = {},
): BackgroundTasksExtensionSource {
  if (isBackgroundTasksDisabled(env)) return { entryPath: null, reason: "disabled" };
  const override = backgroundTasksOverridePath(env);
  if (override) return existsSync(override) ? { entryPath: override, reason: null } : { entryPath: null, reason: "not-installed" };
  const installed = resolveBackgroundTasksEntryForCwd(cwd, source);
  return installed ? { entryPath: installed, reason: null } : { entryPath: null, reason: "not-installed" };
}

/** True for a loaded extension that is a `pi-background-tasks` activation. */
export function isBackgroundTasksExtension(
  extension: Pick<Extension, "path" | "resolvedPath">,
  packageName = BACKGROUND_TASKS_PACKAGE_NAME,
): boolean {
  const haystack = `${extension.path}\n${extension.resolvedPath}`;
  return haystack.includes(packageName) || haystack.includes(BACKGROUND_TASKS_ENTRY_RELATIVE_PATH);
}

/**
 * True for the copies the user installed for Pi — under pi's own package dir, or under the
 * agent dir's `node_modules` — as opposed to the copy pi-desk ships. The user's copy wins the
 * dedupe: it is what `pi update`, `/bg` and the extension's own update notice refer to.
 */
export function isUserInstalledBackgroundTasks(extension: Pick<Extension, "path" | "resolvedPath">): boolean {
  const packageDir = getPackageDir();
  const agentDir = getAgentDir();
  const candidates = [extension.resolvedPath, extension.path];
  return candidates.some(
    (candidate) => candidate.startsWith(packageDir) || candidate.startsWith(agentDir),
  );
}

/**
 * Keeps one background-task activation. With two, the session holds two registries and the
 * panel's lease lands on one of them, so a task started in the conversation would not appear
 * in the panel and a task in the panel would not be stoppable.
 */
export function dedupeBackgroundTasksExtensions(base: LoadExtensionsResult): LoadExtensionsResult {
  const indexes: number[] = [];
  base.extensions.forEach((extension, index) => {
    if (isBackgroundTasksExtension(extension)) indexes.push(index);
  });
  if (indexes.length <= 1) return base;
  const keep = indexes
    .map((index) => ({ index, extension: base.extensions[index] }))
    .find((entry) => isUserInstalledBackgroundTasks(entry.extension))
    ?? { index: indexes[0], extension: base.extensions[indexes[0]] };
  const drop = new Set(indexes.filter((index) => index !== keep.index));
  return {
    ...base,
    extensions: base.extensions.filter((_, index) => !drop.has(index)),
  };
}

/** Composes the app's dedupe with a caller's own `extensionsOverride`, keeping the caller's last word. */
export function withBackgroundTasksDedupe(
  next?: (base: LoadExtensionsResult) => LoadExtensionsResult,
): (base: LoadExtensionsResult) => LoadExtensionsResult {
  return (base) => (next ?? ((result) => result))(dedupeBackgroundTasksExtensions(base));
}

/**
 * The loader options the session gets when the extension resolves: its entrypoint as an extra
 * extension path, and the dedupe. `eventBus` is supplied by the caller — the same instance is
 * the panel's only way to the extension.
 */
export function backgroundTasksLoaderOptions(
  source: BackgroundTasksExtensionSource,
): { additionalExtensionPaths?: string[]; extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult } {
  if (!source.entryPath) return {};
  return {
    additionalExtensionPaths: [source.entryPath],
    extensionsOverride: withBackgroundTasksDedupe(),
  };
}
