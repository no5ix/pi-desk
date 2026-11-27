import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const {
  BACKGROUND_TASKS_ENTRY_RELATIVE_PATH,
  BACKGROUND_TASKS_PACKAGE_NAME,
  backgroundTasksLoaderOptions,
  backgroundTasksOverridePath,
  dedupeBackgroundTasksExtensions,
  isBackgroundTasksDisabled,
  isBackgroundTasksExtension,
  isUserInstalledBackgroundTasks,
  backgroundTasksPackageSourceMatches,
  invalidateBackgroundTasksEntryCache,
  pickBackgroundTasksExtensionFile,
  resolveBackgroundTasksEntryForCwd,
  resolveBackgroundTasksExtension,
  resolveInstalledBackgroundTasksEntry,
  withBackgroundTasksDedupe,
} = await jiti.import("./extension.ts");

const extension = (path) => ({ path, resolvedPath: path });
const appCopy = () => extension(join(process.cwd(), "node_modules", BACKGROUND_TASKS_PACKAGE_NAME, BACKGROUND_TASKS_ENTRY_RELATIVE_PATH));
const userCopy = () => extension(join(process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? "/", ".pi/agent"), "node_modules", "pi-background-tasks-checkout", "dist", "extensions", "background-tasks.js"));

test("the panel's availability is a resolution, not a guess: installed, disabled, or missing", () => {
  assert.equal(isBackgroundTasksDisabled({}), false);
  for (const value of ["1", "true", "TRUE", " yes ", "on"]) {
    assert.equal(isBackgroundTasksDisabled({ PI_WEB_DISABLE_BACKGROUND_TASKS: value }), true);
  }
  // Anything else leaves the extension on: an unset switch is not a switch.
  assert.equal(isBackgroundTasksDisabled({ PI_WEB_DISABLE_BACKGROUND_TASKS: "0" }), false);
  assert.equal(isBackgroundTasksDisabled({ PI_WEB_DISABLE_BACKGROUND_TASKS: "" }), false);

  assert.deepEqual(resolveBackgroundTasksExtension({ PI_WEB_DISABLE_BACKGROUND_TASKS: "1" }), {
    entryPath: null,
    reason: "disabled",
  });
});

test("an override checkout is loaded when it is there, and named as missing when it is not", async () => {
  // Any existing file stands in for the checkout: the switch's job is to load exactly what it
  // names, installed package or not.
  const dir = await mkdtemp(join(tmpdir(), "bg-override-"));
  const entry = join(dir, "dist", "extensions", "background-tasks.js");
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(entry, "export default function extension() {}");
  assert.equal(backgroundTasksOverridePath({}), undefined);
  assert.equal(backgroundTasksOverridePath({ PI_WEB_BACKGROUND_TASKS_PATH: " /tmp/bg/dist/index.js " }), "/tmp/bg/dist/index.js");

  const fromOverride = resolveBackgroundTasksExtension({ PI_WEB_BACKGROUND_TASKS_PATH: entry });
  assert.deepEqual(fromOverride, { entryPath: entry, reason: null });
  assert.deepEqual(resolveBackgroundTasksExtension({ PI_WEB_BACKGROUND_TASKS_PATH: "/nope/index.js" }), {
    entryPath: null,
    reason: "not-installed",
  });
  // A checkout override outranks the installed copy: it is the whole point of the switch.
  assert.deepEqual(resolveBackgroundTasksExtension({
    PI_WEB_BACKGROUND_TASKS_PATH: entry,
    PI_WEB_DISABLE_BACKGROUND_TASKS: "1",
  }), { entryPath: null, reason: "disabled" });
  await rm(dir, { recursive: true, force: true });
});

// This one is about the published package's own manifest, so it runs where the package is
// installed: the app's dependency, or the plugin pi installs under the agent dir.
const installedHere = resolveInstalledBackgroundTasksEntry() ?? resolveBackgroundTasksEntryForCwd(process.cwd());
test("the installed entrypoint is the host entry, from the package's own manifest", {
  skip: installedHere ? false : "pi-background-tasks is not installed here: npm install pi-background-tasks, or pi install npm:pi-background-tasks",
}, () => {
  const entry = installedHere;
  assert.ok(entry);
  assert.ok(existsSync(entry));
  assert.ok(entry.includes(BACKGROUND_TASKS_PACKAGE_NAME));
  // The documented file: a manifest entry pointing elsewhere means the interface moved.
  assert.ok(entry.endsWith(BACKGROUND_TASKS_ENTRY_RELATIVE_PATH));
  assert.equal(resolveInstalledBackgroundTasksEntry("there-is-no-such-pi-package"), null);
});

test("a loaded extension is recognised by its package, and a stranger is not", () => {
  assert.equal(isBackgroundTasksExtension(extension(join("/x/node_modules/pi-background-tasks/dist/index.js"))), true);
  assert.equal(isBackgroundTasksExtension(extension(join("/x", BACKGROUND_TASKS_ENTRY_RELATIVE_PATH))), true);
  assert.equal(isBackgroundTasksExtension(extension("/x/dist/extensions/subagent.js")), false);
});

test("the user's own copy is the one that stays, and pi-desk's shipped copy is the duplicate", () => {
  assert.equal(isUserInstalledBackgroundTasks(userCopy()), true);
  assert.equal(isUserInstalledBackgroundTasks(appCopy()), false);
});

test("two activations of the registry become one, and one is left exactly as it was", () => {
  const one = { extensions: [extension("/x/a.js")], errors: [] };
  assert.equal(dedupeBackgroundTasksExtensions(one), one);

  // Order is the loader's, so test both directions: the user's copy wins from either side.
  for (const extensions of [[appCopy(), userCopy()], [userCopy(), appCopy()]]) {
    const result = dedupeBackgroundTasksExtensions({ extensions, errors: [] });
    assert.equal(result.extensions.length, 1);
    assert.equal(result.extensions[0].path, userCopy().path);
  }

  // Two app copies (a path added twice): the first stays, and the entry is still the app's.
  const twice = dedupeBackgroundTasksExtensions({ extensions: [appCopy(), appCopy()], errors: [] });
  assert.equal(twice.extensions.length, 1);

  // Strangers are never touched, and the errors ride along.
  const withErrors = { extensions: [extension("/x/a.js"), appCopy()], errors: ["boom"] };
  const kept = dedupeBackgroundTasksExtensions(withErrors);
  assert.deepEqual(kept.extensions.map((entry) => entry.path), ["/x/a.js", appCopy().path]);
  assert.deepEqual(kept.errors, ["boom"]);
});

test("the app's dedupe runs before a caller's own override, which keeps the last word", () => {
  const composed = withBackgroundTasksDedupe((base) => ({ ...base, extensions: [...base.extensions, extension("/added/by-the-caller.js")] }));
  const result = composed({ extensions: [appCopy(), userCopy()], errors: [] });
  assert.deepEqual(result.extensions.map((entry) => entry.path), [userCopy().path, "/added/by-the-caller.js"]);
  // With no caller override, the dedupe alone.
  assert.equal(withBackgroundTasksDedupe()({ extensions: [appCopy(), userCopy()], errors: [] }).extensions.length, 1);
});

test("the loader options are the entrypoint plus the dedupe, and nothing at all when it is unavailable", () => {
  const options = backgroundTasksLoaderOptions({ entryPath: "/abs/pi-background-tasks/dist/extensions/background-tasks.js", reason: null });
  assert.deepEqual(options.additionalExtensionPaths, ["/abs/pi-background-tasks/dist/extensions/background-tasks.js"]);
  assert.equal(typeof options.extensionsOverride, "function");

  // Unavailable: no path, and no override. A session that carries an empty extra path is a
  // session the loader will fail on.
  assert.deepEqual(backgroundTasksLoaderOptions({ entryPath: null, reason: "not-installed" }), {});
  assert.deepEqual(backgroundTasksLoaderOptions({ entryPath: null, reason: "disabled" }), {});
});

// ---------------------------------------------------------------------------
// The copy the user installed for pi is the one the panel talks to.
//
// The app often runs from a checkout that ships no dependency of its own — a linked worktree —
// while `pi install npm:pi-background-tasks` lands under the agent dir for every pi process.
// Resolving only the app's own node_modules said "pi-background-tasks is not installed" over a
// plugin the Plugins page showed as Loaded, and the session loaded no extension at all, so the
// composer's /bg had no commands either.

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(process.env.HOME ?? "/", ".pi/agent");

test("a plugin under the agent dir, in any of pi's install layouts, is the user's copy", () => {
  const globalNpm = extension(join(AGENT_DIR, "npm", "node_modules", "pi-background-tasks", "dist", "extensions", "background-tasks.js"));
  const agentModules = extension(join(AGENT_DIR, "node_modules", "pi-background-tasks", "dist", "extensions", "background-tasks.js"));
  assert.equal(isUserInstalledBackgroundTasks(globalNpm), true);
  assert.equal(isUserInstalledBackgroundTasks(agentModules), true);
  assert.equal(isUserInstalledBackgroundTasks(appCopy()), false);
});

test("a configured plugin source names this package, and not a neighbour of it", () => {
  assert.equal(backgroundTasksPackageSourceMatches("npm:pi-background-tasks"), true);
  assert.equal(backgroundTasksPackageSourceMatches("npm:@scope/pi-background-tasks"), true);
  assert.equal(backgroundTasksPackageSourceMatches("https://github.com/acme/pi-background-tasks"), true);
  assert.equal(backgroundTasksPackageSourceMatches("https://github.com/acme/pi-background-tasks/"), true);
  assert.equal(backgroundTasksPackageSourceMatches("npm:pi-background-tasks-extra"), false);
  assert.equal(backgroundTasksPackageSourceMatches("npm:pi-peekaboo"), false);
});

test("the extension file is the manifest's `background-tasks` resource, never a neighbour of it", () => {
  const root = "/plugins/pi-background-tasks";
  const manifest = {
    pi: {
      extensions: [
        { name: "anthropic-attribution", path: "./dist/extensions/anthropic-attribution.js" },
        { name: "background-tasks", path: "./dist/extensions/background-tasks.js" },
      ],
    },
  };
  assert.equal(
    pickBackgroundTasksExtensionFile(manifest, root),
    join(root, "dist/extensions/background-tasks.js"),
  );
  // A manifest that lists files only: the file's own name picks it.
  assert.equal(
    pickBackgroundTasksExtensionFile({ pi: { extensions: ["./dist/extensions/background-tasks.js"] } }, root),
    join(root, "dist/extensions/background-tasks.js"),
  );
  // Several resources, none of them the task registry: not loaded under a guess.
  assert.equal(pickBackgroundTasksExtensionFile({ pi: { extensions: ["./dist/extensions/a.js", "./dist/extensions/b.js"] } }, root), null);
  assert.equal(pickBackgroundTasksExtensionFile(undefined, root), null);
});

async function fakeInstalledPackage({ name = "pi-background-tasks", resource = "background-tasks", file = "dist/extensions/background-tasks.js" } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "bg-installed-"));
  await writeFile(join(dir, "package.json"), JSON.stringify({
    name,
    pi: {
      extensions: [
        { name: "anthropic-attribution", path: "./dist/extensions/anthropic-attribution.js" },
        { name: resource, path: `./${file}` },
      ],
    },
  }));
  const entry = join(dir, file);
  await mkdir(dirname(entry), { recursive: true });
  await writeFile(entry, "export default function extension() {}");
  return dir;
}

test("the entrypoint for a working directory is the user's installed plugin, and it is cached until invalidated", async () => {
  const root = await fakeInstalledPackage();
  const cwd = await mkdtemp(join(tmpdir(), "bg-cwd-"));
  const wanted = join(root, "dist/extensions/background-tasks.js");
  const source = { resolveInstalledPackages: () => [{ root, scope: "user" }] };
  invalidateBackgroundTasksEntryCache(cwd);
  assert.equal(resolveBackgroundTasksEntryForCwd(cwd, source), wanted);
  // Resolved once: the same answer with a resolver that would now find nothing, until invalidated.
  assert.equal(resolveBackgroundTasksEntryForCwd(cwd, { resolveInstalledPackages: () => [] }), wanted);
  invalidateBackgroundTasksEntryCache(cwd);
  assert.notEqual(resolveBackgroundTasksEntryForCwd(cwd, { resolveInstalledPackages: () => [] }), wanted);
  await rm(root, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});

test("a checkout with no dependency of its own resolves the global plugin, not \"not installed\"", async () => {
  const root = await fakeInstalledPackage();
  const cwd = await mkdtemp(join(tmpdir(), "bg-worktree-"));
  invalidateBackgroundTasksEntryCache(cwd);
  const source = { resolveInstalledPackages: () => [{ root, scope: "user" }] };
  const resolved = resolveBackgroundTasksExtension({}, cwd, source);
  assert.equal(resolved.reason, null);
  assert.equal(resolved.entryPath, join(root, "dist/extensions/background-tasks.js"));
  assert.deepEqual(
    backgroundTasksLoaderOptions(resolved).additionalExtensionPaths,
    [join(root, "dist/extensions/background-tasks.js")],
  );
  // The switch still outranks every copy, and a cwd with no copy at all says so honestly.
  assert.deepEqual(resolveBackgroundTasksExtension({ PI_WEB_DISABLE_BACKGROUND_TASKS: "1" }, cwd, source), { entryPath: null, reason: "disabled" });
  invalidateBackgroundTasksEntryCache(cwd);
  assert.deepEqual(resolveBackgroundTasksExtension({}, cwd, { resolveInstalledPackages: () => [] }).reason, "not-installed");
  await rm(root, { recursive: true, force: true });
  await rm(cwd, { recursive: true, force: true });
});
