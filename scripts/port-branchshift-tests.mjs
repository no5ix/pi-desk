// One-off port helper: copies Branchshift's Git suites (src/test/git/**) into
// lib/git/tests/** so the ported backend keeps the tests that already cover it.
// Each suite is a TypeScript file run through a small `.test.mjs` wrapper, the
// pattern this repo uses to type-check-free import TS under `node --test`.
//
//   node scripts/port-branchshift-tests.mjs /path/to/branchshift
import fs from "node:fs";
import path from "node:path";

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/port-branchshift-tests.mjs <branchshift-root>");
  process.exit(1);
}

const sourceRoot = path.join(source, "src", "test", "git");
const targetRoot = path.join(process.cwd(), "lib", "git", "tests");

function kebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function kebabSpecifier(specifier) {
  if (!specifier.startsWith(".")) return specifier;
  return specifier.split("/").map((segment) => (segment.startsWith(".") ? segment : kebab(segment))).join("/");
}

const names = fs.readdirSync(sourceRoot).filter((name) => name.endsWith(".ts"));
let written = 0;
for (const name of names) {
  const text = fs.readFileSync(path.join(sourceRoot, name), "utf8");
  const lines = text.split("\n");
  const used = new Set();
  const body = lines
    .map((line) =>
      /^\s*(import|export)\b/.test(line) || /^\s*\}\s*from\b/.test(line)
        ? line.replace(/"(?:\.\.?\/)[^"]+"/g, (whole) => `"${kebabSpecifier(whole.slice(1, -1))}"`)
        : line)
    .join("\n");
  for (const hook of ["describe", "it", "afterEach", "beforeEach", "before", "after"]) {
    if (new RegExp(`^\\s*${hook}\\(`, "m").test(body)) used.add(hook);
  }
  const header = `// Ported from Branchshift's src/test/git/${name}: the suites that already\n`
    + "// cover this backend. mocha's global describe/it become node:test imports.\n"
    + `import { ${[...used].join(", ")} } from "node:test";\n`;

  const targetName = kebab(name);
  fs.mkdirSync(targetRoot, { recursive: true });
  fs.writeFileSync(path.join(targetRoot, targetName), `${header}${body}`);
  written += 1;

  if (targetName.endsWith(".test.ts")) {
    const wrapperName = `${targetName.replace(/\.test\.ts$/, "")}.test.mjs`;
    const wrapper = `// Runs the ported TypeScript suite through jiti (see scripts/port-branchshift-tests.mjs).\n`
      + `import { createJiti } from "jiti";\n\n`
      + `const jiti = createJiti(import.meta.url, { tsconfigPaths: true });\n\n`
      + `await jiti.import("./tests/${targetName}");\n`;
    fs.writeFileSync(path.join(process.cwd(), "lib", "git", wrapperName), wrapper);
  }
}
console.log(`wrote ${written} files to ${path.relative(process.cwd(), targetRoot)}`);
