import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { createJiti } from "jiti";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-files-route-")));
fs.writeFileSync(path.join(root, "gitconfig"), "");
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = path.join(root, "gitconfig");
process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
process.env.GIT_CEILING_DIRECTORIES = root;
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./[...path]/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/allowed-roots.ts");
allowFileRoot(root);

function write(filePath, content = "") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function request(filePath, type) {
  const segments = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return GET(
    new NextRequest(`http://localhost/api/files/x?type=${type}`),
    { params: Promise.resolve({ path: segments }) },
  );
}

async function listNames(dir) {
  const response = await request(dir, "list");
  assert.equal(response.status, 200);
  const { entries } = await response.json();
  return entries.map((entry) => entry.name);
}

test("lists a tracked build/ in a Git work tree, and the ignored folder with its reason", async () => {
  const repo = path.join(root, "repo");
  write(path.join(repo, ".gitignore"), "dist/\n");
  write(path.join(repo, "build/index.js"));
  write(path.join(repo, "dist/bundle.js"), "bundle");
  write(path.join(repo, "src/main.ts"));
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", ["-C", repo, "add", ".gitignore", "build", "src"]);

  // `dist/` is ignored, so it arrives marked — the explorer dims it, and the
  // user can still open it, which is the point of a tree.
  const response = await request(repo, "list");
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).entries.map(({ name, hidden }) => ({ name, hidden })),
    [
      { name: "build", hidden: undefined },
      { name: "dist", hidden: "ignored" },
      { name: "src", hidden: undefined },
      { name: ".gitignore", hidden: undefined },
    ],
  );

  // Visibility only: an ignored file is still readable by its path.
  const read = await request(path.join(repo, "dist/bundle.js"), "read");
  assert.equal(read.status, 200);
  assert.equal((await read.json()).content, "bundle");
});

test("keeps the name list for a directory outside Git", async () => {
  const plain = path.join(root, "plain");
  write(path.join(plain, "build/index.js"));
  write(path.join(plain, "node_modules/pkg/index.js"));
  write(path.join(plain, "src/main.ts"));

  assert.deepEqual(await listNames(plain), ["src"]);
});

test("hidden=1 also lists ignored and name-list entries with their reason, never .git", async () => {
  const repo = path.join(root, "repo-hidden");
  write(path.join(repo, ".gitignore"), "dist/\n");
  write(path.join(repo, "dist/bundle.js"));
  write(path.join(repo, "src/main.ts"));
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", ["-C", repo, "add", ".gitignore", "src"]);

  const response = await request(repo, "list&hidden=1");
  assert.equal(response.status, 200);
  const { entries } = await response.json();
  assert.deepEqual(
    entries.map(({ name, hidden }) => ({ name, hidden })),
    [
      { name: "dist", hidden: "ignored" },
      { name: "src", hidden: undefined },
      { name: ".gitignore", hidden: undefined },
    ],
  );

  const plain = path.join(root, "plain-hidden");
  write(path.join(plain, "node_modules/pkg/index.js"));
  write(path.join(plain, "src/main.ts"));
  const plainResponse = await request(plain, "list&hidden=1");
  const plainEntries = (await plainResponse.json()).entries;
  assert.deepEqual(
    plainEntries.map(({ name, hidden }) => ({ name, hidden })),
    [{ name: "node_modules", hidden: "excluded" }, { name: "src", hidden: undefined }],
  );
});

test("opens a folder that is not ignored, whose own .gitignore ignores everything inside", async () => {
  // The report: `.ruff_cache` shows in the tree, and clicking it showed nothing.
  // ruff writes a `.gitignore` of `*` inside the cache folder, so every entry
  // there is ignored while the folder itself is not. A folder that was opened
  // lists its contents, marked and dimmed, and they stay readable.
  const repo = path.join(root, "repo-cache");
  write(path.join(repo, ".gitignore"), "*.log\n");
  write(path.join(repo, ".ruff_cache/.gitignore"), "# Automatically created by ruff.\n*\n");
  write(path.join(repo, ".ruff_cache/CACHEDIR.TAG"), "Signature: 8a477f594d102ae173aa59fb2e153464");
  write(path.join(repo, ".ruff_cache/0.17.4/lock"), "");
  write(path.join(repo, "src/main.ts"));
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", ["-C", repo, "add", ".gitignore", "src"]);

  const rootNames = await listNames(repo);
  assert.ok(rootNames.includes(".ruff_cache"), "the cache folder is listed: Git does not ignore it");

  const response = await request(path.join(repo, ".ruff_cache"), "list");
  assert.equal(response.status, 200);
  const inside = (await response.json()).entries;
  assert.deepEqual(
    inside.map(({ name }) => name),
    ["0.17.4", ".gitignore", "CACHEDIR.TAG"],
    "its contents arrive: the folder was opened to see them",
  );
  for (const entry of inside) {
    assert.ok(
      entry.hidden === undefined || entry.hidden === "ignored",
      `${entry.name} is plain ink or dimmed as Git-excluded, never dropped`,
    );
  }

  const read = await request(path.join(repo, ".ruff_cache/CACHEDIR.TAG"), "read");
  assert.equal(read.status, 200, "and an ignored entry is editable, not only visible");
});
