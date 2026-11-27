import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const {
  DEFAULT_DEV_MAX_OLD_SPACE_MB,
  DEFAULT_PROD_MAX_OLD_SPACE_MB,
  DEV_ENV_DEFAULTS,
  MIN_MAX_OLD_SPACE_MB,
  applyDevEnvDefaults,
  applyServerMemoryEnv,
  hasMaxOldSpaceOption,
  maxOldSpaceMb,
  nodeOptionsWithServerMemory,
} = require("../bin/server-flags.js");

test("a dev server gets a heap ceiling far below Next's half-of-RAM default", async () => {
  // `next dev` forks the server child with `--max-old-space-size` set to half of
  // physical RAM when nothing else set one. On the machine that measured 18.6 GB
  // of RSS that is 64 GiB, so V8 never compacts and the process keeps the peak.
  const nextDev = await read("../node_modules/next/dist/cli/next-dev.js");
  assert.match(nextDev, /getMaxOldSpaceSize/, "Next's override entry point moved");
  assert.match(nextDev, /nodeOptions\[['"]max-old-space-size['"]\]/, "Next's override moved");
  assert.match(
    nextDev,
    /if \(!maxOldSpaceSize && !process\.env\.NEXT_DISABLE_MEM_OVERRIDE\)/,
    "Next no longer honours an existing NODE_OPTIONS ceiling, so the launcher's flag has no effect",
  );

  assert.ok(DEFAULT_DEV_MAX_OLD_SPACE_MB >= MIN_MAX_OLD_SPACE_MB);
  assert.ok(DEFAULT_DEV_MAX_OLD_SPACE_MB < 4096, "a dev ceiling that big is not a budget");
  assert.equal(maxOldSpaceMb("dev", {}), DEFAULT_DEV_MAX_OLD_SPACE_MB);
  assert.equal(maxOldSpaceMb("start", {}), DEFAULT_PROD_MAX_OLD_SPACE_MB);
});

test("PI_WEB_MAX_OLD_SPACE_SIZE moves the ceiling, and switches it off", () => {
  assert.equal(maxOldSpaceMb("dev", { PI_WEB_MAX_OLD_SPACE_SIZE: "4096" }), 4096);
  assert.equal(maxOldSpaceMb("dev", { PI_WEB_MAX_OLD_SPACE_SIZE: " 4096 " }), 4096);
  for (const off of ["0", "off", "NONE", "default"]) {
    assert.equal(maxOldSpaceMb("dev", { PI_WEB_MAX_OLD_SPACE_SIZE: off }), 0, off);
  }
  assert.equal(maxOldSpaceMb("dev", { PI_WEB_MAX_OLD_SPACE_SIZE: "" }), DEFAULT_DEV_MAX_OLD_SPACE_MB);
});

test("an absurd ceiling is clamped, and a nonsense one falls back", () => {
  assert.equal(maxOldSpaceMb("start", { PI_WEB_MAX_OLD_SPACE_SIZE: "1" }), MIN_MAX_OLD_SPACE_MB);
  assert.equal(maxOldSpaceMb("start", { PI_WEB_MAX_OLD_SPACE_SIZE: String(1024 * 1024) }), 64 * 1024);
  for (const value of ["nonsense", "-20", "NaN"]) {
    assert.equal(maxOldSpaceMb("start", { PI_WEB_MAX_OLD_SPACE_SIZE: value }), DEFAULT_PROD_MAX_OLD_SPACE_MB, value);
  }
});

test("a ceiling the operator set in NODE_OPTIONS wins, in both spellings", () => {
  assert.ok(hasMaxOldSpaceOption("--max-old-space-size=1234"));
  assert.ok(hasMaxOldSpaceOption("--max_old_space_size=1234"));
  assert.ok(hasMaxOldSpaceOption("--throw-deprecation --max-old-space-size 1234"));
  assert.equal(hasMaxOldSpaceOption("--max-heap-size=1234"), false);

  assert.equal(nodeOptionsWithServerMemory({ NODE_OPTIONS: "--max-old-space-size=1234" }, "dev"), "--max-old-space-size=1234");
  assert.equal(nodeOptionsWithServerMemory({ NODE_OPTIONS: "--enable-source-maps" }, "dev"), `--enable-source-maps --max-old-space-size=${DEFAULT_DEV_MAX_OLD_SPACE_MB}`);
  assert.equal(nodeOptionsWithServerMemory({}, "dev"), `--max-old-space-size=${DEFAULT_DEV_MAX_OLD_SPACE_MB}`);
  // Switched off: NODE_OPTIONS is left exactly as it was, so Next's own default applies.
  assert.equal(nodeOptionsWithServerMemory({ NODE_OPTIONS: "--enable-source-maps", PI_WEB_MAX_OLD_SPACE_SIZE: "0" }, "start"), "--enable-source-maps");
});

test("applyServerMemoryEnv writes the ceiling into a spawn env", () => {
  const env = applyServerMemoryEnv({ PATH: "/bin" }, "dev");
  assert.equal(env.NODE_OPTIONS, `--max-old-space-size=${DEFAULT_DEV_MAX_OLD_SPACE_MB}`);
  assert.equal(env.PATH, "/bin");
  // Never two values for one flag: Node refuses to start, and that would be a
  // server that no longer launches at all.
  assert.equal(applyServerMemoryEnv({ NODE_OPTIONS: "--max-old-space-size=999" }, "dev").NODE_OPTIONS, "--max-old-space-size=999");
});

test("dev keeps loaded sessions for minutes, not ten", () => {
  assert.equal(DEV_ENV_DEFAULTS.PI_WEB_IDLE_TIMEOUT_MS, "120000");
  assert.equal(DEV_ENV_DEFAULTS.PI_WEB_MCP_IDLE_MS, "120000");
  const dev = applyDevEnvDefaults({});
  assert.equal(dev.PI_WEB_IDLE_TIMEOUT_MS, "120000");
  // A value the developer set is theirs: the 10-minute warm-keeping stays when
  // someone asks for it, and 0 (keep everything loaded) is respected.
  for (const value of ["600000", "0"]) {
    assert.equal(applyDevEnvDefaults({ PI_WEB_IDLE_TIMEOUT_MS: value }).PI_WEB_IDLE_TIMEOUT_MS, value);
  }
});

test("every way of starting the server sets the ceiling", async () => {
  const pkg = JSON.parse(await read("../package.json"));

  // `npm run dev` must go through the launcher: bare `next dev` is the half-of-RAM heap.
  assert.equal(pkg.scripts.dev, "node scripts/dev-server.mjs");
  const dev = await read("../scripts/dev-server.mjs");
  assert.match(dev, /applyServerMemoryEnv\(\{ \.\.\.process\.env \}, "dev"\)/);
  assert.match(dev, /applyDevEnvDefaults/);

  const web = await read("../scripts/web-dev.mjs");
  assert.match(web, /applyServerMemoryEnv\([\s\S]*"dev"\)/);
  assert.match(web, /applyDevEnvDefaults/);
  const lan = await read("../scripts/lan-server.mjs");
  assert.match(lan, /applyServerMemoryEnv\(env, mode\)/, "dev:lan and start:lan");
  assert.match(lan, /applyDevEnvDefaults\(env\)/);

  const bin = await read("../bin/pi-web.js");
  assert.match(bin, /applyServerMemoryEnv\([\s\S]*"start",?\s*\)/, "the published pi-web command");
  assert.match(bin, /require\("\.\/server-flags"\)/, "the published pi-web command loads the module");

  // The desktop sidecar requires the server in-process, so it sets the ceiling
  // on itself before the server loads (bin/server-flags.js explains why the flag
  // cannot come from a child's execArgv there).
  const sidecar = await read("../desktop/server-launcher.cjs");
  assert.match(sidecar, /setFlagsFromString\(`--max-old-space-size=\$\{/);
  assert.match(sidecar, /hasMaxOldSpaceOption/);
});

test("dev's pressure budget sits above dev's heap ceiling", () => {
  // A healthy `npm run dev` is 1.5-2 GB of Turbopack module graph. A budget
  // inside that range has the valve fire every minute and find nothing to
  // release, which is noise that trains the operator to ignore the one line
  // that means RSS has grown past the heap.
  assert.equal(DEV_ENV_DEFAULTS.PI_WEB_MEMORY_BUDGET_MB, "2560");
  assert.ok(Number(DEV_ENV_DEFAULTS.PI_WEB_MEMORY_BUDGET_MB) > DEFAULT_DEV_MAX_OLD_SPACE_MB);
  assert.ok(Number(DEV_ENV_DEFAULTS.PI_WEB_MEMORY_BUDGET_MB) <= DEFAULT_DEV_MAX_OLD_SPACE_MB * 2);
});
