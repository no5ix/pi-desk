import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import loader from "./gfm-autolink-email-loader.cjs";

const { rewriteGfmAutolinkEmailRegex, findRegexLiterals, stripLookbehindGroups } = loader;

// The literal as mdast-util-gfm-autolink-literal 2.0.1 ships it (the version
// package-lock.json pins).
const upstreamLiteral = String.raw`/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu`;

// The lookbehinds 2.1.x ships: a URL regex and three email regexes.
const v21Literals = [
  String.raw`/(?<![\da-z])(https?:\/\/|www(?=\.))([\w-]*\.[\w\-.]*)([^\t\n\r ]*)/gi`,
  String.raw`/(?<![\w+\-.@])xmpp:([\w+\-.]+)@([\w-]+(?:\.[\w-]+)+)(\/(?:[\w\-/]|\.(?=[\dA-Za-z]))*)?/g`,
  String.raw`/(?<![\w+\-.@])mailto:([\w+\-.]+)@([\w-]+(?:\.[\w-]+)+)/g`,
  String.raw`/(?<![\w+\-.]|(?:^|[^\d@A-Za-z])(?:mailto|xmpp):)([\w+\-.]+)@([\w-]+(?:\.[\w-]+)+)/g`,
];

// Evaluate the rewritten expression with the given RegExp constructor in scope.
function rewrittenRegExp(RegExpImpl, literal) {
  const rewritten = rewriteGfmAutolinkEmailRegex(`return ${literal};`);
  return new Function("RegExp", rewritten)(RegExpImpl);
}

// Safari before 16.4: any lookbehind is an invalid group specifier.
function RegExpWithoutLookbehind(pattern, flags) {
  if (/\(\?<[=!]/.test(pattern)) throw new SyntaxError("Invalid regular expression: invalid group specifier name");
  return new RegExp(pattern, flags);
}

function lookbehindLiterals(source) {
  return findRegexLiterals(source).filter((literal) => /\(\?<[=!]/.test(literal.pattern));
}

describe("gfm-autolink-email-loader", () => {
  it("leaves no lookbehind regex literal in the installed package", () => {
    const entry = new URL(import.meta.resolve("mdast-util-gfm-autolink-literal"));
    const source = readFileSync(new URL("./lib/index.js", entry), "utf8");
    // The loader exists because the package uses lookbehind; if that ever goes
    // away upstream, this loader can go with it.
    assert.ok(lookbehindLiterals(source).length > 0, "the package has no lookbehind to rewrite");

    const rewritten = rewriteGfmAutolinkEmailRegex(source);
    assert.deepEqual(lookbehindLiterals(rewritten), [], "a lookbehind literal survived the rewrite");
    // Every lookbehind in the output is a string passed to `new RegExp`, so a
    // browser that cannot parse one gets a caught failure, not a dead chunk.
    for (const match of rewritten.matchAll(/\(\?<[=!]/g)) {
      const line = rewritten.slice(rewritten.lastIndexOf("\n", match.index) + 1, match.index);
      assert.match(line, /new RegExp\(\s*"/, `a lookbehind outside a string: ${line.slice(-60)}`);
    }
  });

  it("rewrites the 2.0.1 email regex to a runtime construction", () => {
    const rewritten = rewriteGfmAutolinkEmailRegex(`return ${upstreamLiteral};`);
    assert.ok(!rewritten.includes(upstreamLiteral));
    assert.ok(rewritten.includes(`new RegExp(${JSON.stringify(upstreamLiteral.slice(1, -3))}, "gu")`));
    assert.equal(rewrittenRegExp(RegExp, upstreamLiteral).source, upstreamLiteral.slice(1, -3));
    assert.equal(rewrittenRegExp(RegExp, upstreamLiteral).flags, "gu");
  });

  it("falls back to the 2.0.0 regex where lookbehind is not supported", () => {
    const regex = rewrittenRegExp(RegExpWithoutLookbehind, upstreamLiteral);
    assert.equal(regex.source, String.raw`([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)`);
    assert.equal(regex.flags, "g");
  });

  it("rewrites every 2.1.x lookbehind and keeps the modern regex whole", () => {
    for (const literal of v21Literals) {
      const rewritten = rewriteGfmAutolinkEmailRegex(`const pattern = ${literal};`);
      assert.deepEqual(lookbehindLiterals(rewritten), []);
      const modern = rewrittenRegExp(RegExp, literal);
      assert.equal(modern.source, literal.slice(1, literal.lastIndexOf("/")));
      assert.equal(modern.flags, literal.slice(literal.lastIndexOf("/") + 1));
    }
  });

  it("keeps the same patterns without their lookbehind on old Safari", () => {
    const cases = [
      [v21Literals[0], String.raw`(https?:\/\/|www(?=\.))([\w-]*\.[\w\-.]*)([^\t\n\r ]*)`, "gi"],
      [v21Literals[1], String.raw`xmpp:([\w+\-.]+)@([\w-]+(?:\.[\w-]+)+)(\/(?:[\w\-/]|\.(?=[\dA-Za-z]))*)?`, "g"],
      [v21Literals[2], String.raw`mailto:([\w+\-.]+)@([\w-]+(?:\.[\w-]+)+)`, "g"],
      [v21Literals[3], String.raw`([\w+\-.]+)@([\w-]+(?:\.[\w-]+)+)`, "g"],
    ];
    for (const [literal, source, flags] of cases) {
      const old = rewrittenRegExp(RegExpWithoutLookbehind, literal);
      assert.equal(old.source, source);
      assert.equal(old.flags, flags);
    }
  });

  it("the old Safari email fallback still finds emails, including dots", () => {
    const regex = rewrittenRegExp(RegExpWithoutLookbehind, v21Literals[3]);
    assert.deepEqual("mail me at a.b+tag@example.com, ok".match(regex), ["a.b+tag@example.com"]);
  });

  it("stripLookbehindGroups is class and nesting aware", () => {
    assert.equal(
      stripLookbehindGroups(String.raw`(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)`),
      String.raw`([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)`,
    );
    // A nested `(?: … )` and a class holding `(` and `]`.
    assert.equal(
      stripLookbehindGroups(String.raw`(?<![\w+\-.]|(?:^|[^\d@A-Za-z])(?:mailto|xmpp):)([\w+\-.]+)`),
      String.raw`([\w+\-.]+)`,
    );
    assert.equal(stripLookbehindGroups(String.raw`[\](]\\x](?<=a)y`), String.raw`[\](]\\x]y`);
    // A lookbehind inside a class is class content, not a group.
    assert.equal(stripLookbehindGroups(String.raw`[(?<=x]a`), String.raw`[(?<=x]a`);
  });

  it("reads regex literals, not division, and skips comments", () => {
    assert.deepEqual(findRegexLiterals("const half = 4 / 2 / 1;"), []);
    assert.deepEqual(findRegexLiterals("// /(?<=a)/g\n/* /x/ */ const a = 1;"), []);
    const found = findRegexLiterals("const email = /a@b/g; const re = /x/gi;");
    assert.deepEqual(found.map((literal) => literal.literal), ["/a@b/g", "/x/gi"]);
    assert.deepEqual(found.map((literal) => literal.flags), ["g", "gi"]);
  });

  it("a template's regex is rewritten too, so the chunk parses everywhere", () => {
    const source = "const parts = [`x`, /(?<=a)b/g];";
    assert.deepEqual(lookbehindLiterals(rewriteGfmAutolinkEmailRegex(source)), []);
  });
});
