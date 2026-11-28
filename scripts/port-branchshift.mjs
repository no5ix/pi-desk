// One-off port helper: copies Branchshift's VS Code-free Git backend
// (src/git/**) into lib/git/** with this repo's kebab-case file names and
// import specifiers. Kept in the repo so a later upstream refresh of
// Branchshift can be diffed the same way.
//
//   node scripts/port-branchshift.mjs /path/to/branchshift
import fs from "node:fs";
import path from "node:path";

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/port-branchshift.mjs <branchshift-root>");
  process.exit(1);
}

const sourceRoot = path.join(source, "src", "git");
const targetRoot = path.join(process.cwd(), "lib", "git");

// Modules that carry VS Code workspace assumptions Branchshift's extension host
// owns; pi-desk resolves repositories from its own project/worktree model.
const SKIP = new Set(["repoSelection.ts"]);

function kebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function kebabSpecifier(specifier) {
  if (!specifier.startsWith(".")) return specifier;
  return specifier
    .split("/")
    .map((segment, index, all) =>
      index === all.length - 1 ? kebab(segment) : segment.startsWith(".") ? segment : kebab(segment))
    .join("/");
}

function collect(dir, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...collect(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}

let copied = 0;
for (const rel of collect(sourceRoot)) {
  if (SKIP.has(path.basename(rel))) {
    console.log(`skip  ${rel}`);
    continue;
  }
  const target = path.join(targetRoot, rel.split("/").map((segment, index, all) => (index === all.length - 1 ? kebab(segment) : kebab(segment))).join("/"));
  const text = fs.readFileSync(path.join(sourceRoot, rel), "utf8");
  // Only import/export statements get rewritten: a plain `from "` scan also
  // matches string literals inside the code.
  const rewritten = text
    .split("\n")
    .map((line) =>
      /^\s*(import|export)\b/.test(line) || /^\s*\}\s*from\b/.test(line)
        ? line.replace(/"(\.[^"]+)"/g, (whole, specifier) => `"${kebabSpecifier(specifier)}"`)
        : line)
    .join("\n");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, rewritten);
  console.log(`copy  ${rel} -> ${path.relative(process.cwd(), target)}`);
  copied += 1;
}
console.log(`copied ${copied} files`);
