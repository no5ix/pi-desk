// Hooks before any early return — checked on the source, because nothing else
// catches it.
//
// A `useMemo` placed after a component's early return changes the hook count
// between the two states, and React unmounts the tree when the branch is taken.
// That is what happened to the commit detail: the empty state returned early,
// the file groups were memoized below it, and the panel died on the first commit
// clicked. ESLint's hooks rules did not flag it, and the type checker cannot
// see it. This test can, and it names the line to move above the return.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

/** The files this branch owns: the Git panel, the editor, the file panel. */
const OWNED = [
  "components/GitPanel.tsx",
  "components/CodeEditor.tsx",
  "components/FileViewer.tsx",
  "components/TabBar.tsx",
  "components/git/git-api.ts",
  "components/git/git-ui.tsx",
  "components/git/branch/BranchSidebar.tsx",
  "components/git/log/LogPanel.tsx",
  "components/git/log/CommitDetail.tsx",
  "components/git/commit/CommitPanel.tsx",
  "components/git/dialogs/GitDialogs.tsx",
];

function collectViolations(file) {
  const text = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations = [];

  const callsHook = (node) => {
    let found = false;
    const walk = (current) => {
      if (found) return;
      if (ts.isCallExpression(current) && ts.isIdentifier(current.expression) && /^use[A-Z]/.test(current.expression.text)) {
        found = true;
        return;
      }
      // Do not walk into a nested function: its hooks are its own.
      if (current !== node && (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current) || ts.isObjectLiteralExpression(current))) return;
      current.forEachChild(walk);
    };
    walk(node);
    return found;
  };

  const checkBody = (declaration, name) => {
    const body = declaration.body;
    if (!body || !ts.isBlock(body)) return;
    let returnLine = null;
    for (const statement of body.statements) {
      const returns = (() => {
        let found = false;
        const walk = (current) => {
          if (found) return;
          if (ts.isReturnStatement(current)) { found = true; return; }
          if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isArrowFunction(current)) return;
          current.forEachChild(walk);
        };
        walk(statement);
        return found;
      })();
      if (returns && returnLine === null) {
        // Only an early return counts: the component's own last statement is its
        // render, and hooks before it are in order.
        if (statement !== body.statements[body.statements.length - 1]) {
          returnLine = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
        }
        continue;
      }
      if (returnLine !== null && callsHook(statement)) {
        const line = source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
        violations.push(`${file}: ${name} returns at line ${returnLine} and calls a hook at line ${line}`);
        returnLine = null;
      }
    }
  };

  const walk = (node) => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isClassDeclaration(node)) {
      const name = (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node)) && node.name
        ? node.name.text
        : "anonymous";
      checkBody(node, name);
    }
    node.forEachChild(walk);
  };
  walk(source);
  return violations;
}

test("no component in the branch's files calls a hook after an early return", () => {
  const found = [];
  for (const relative of OWNED) {
    assert.ok(fs.existsSync(relative), `${relative} exists`);
    found.push(...collectViolations(relative));
  }
  assert.deepEqual(found, [], found.join("\n"));
});

test("the scan sees the shape it is for", () => {
  // The scan is only worth anything if it can name the bug. Written to a scratch
  // file, in the shape CommitDetail had: an early return, a memo below it.
  const scratch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-hook-scan-")), "Scratch.tsx");
  fs.writeFileSync(scratch, [
    'import { useMemo } from "react";',
    "export function Scratch({ value }) {",
    "  if (!value) {",
    "    return <div>empty</div>;",
    "  }",
    "  const rows = useMemo(() => [value], [value]);",
    "  return <div>{rows.length}</div>;",
    "}",
    "",
  ].join("\n"));
  const violations = collectViolations(scratch);
  assert.equal(violations.length, 1, "the early return followed by a memo is found");
  assert.match(violations[0], /returns at line 3 and calls a hook at line 6/);
  fs.rmSync(path.dirname(scratch), { recursive: true, force: true });
});
