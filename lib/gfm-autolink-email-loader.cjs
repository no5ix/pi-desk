// Bundler loader for mdast-util-gfm-autolink-literal, which remark-gfm uses to
// find bare URLs and emails. Its email regexes use RegExp **lookbehind**, which
// Safari only parses from 16.4. A regex literal Safari cannot parse is a
// SyntaxError for the whole chunk, and this one ships in the first load of `/`,
// so iOS 16.2 showed a blank page (#753). Upstream declined the 2.0.1 regex
// (syntax-tree/mdast-util-gfm-autolink-literal#10), and 2.1.x widened it: three
// email regexes (`xmpp:`, `mailto:`, bare) each start with a negative lookbehind.
//
// So the loader rewrites *every* regex literal in the module that contains a
// lookbehind, and each one becomes a runtime construction: the modern regex is
// built from its source string (parsed at runtime, where a failure is catchable
// instead of a parse-time SyntaxError), and the fallbacks drop the lookbehind
// groups. Dropping a lookbehind only makes the pattern more permissive at its
// start position: `findAndReplace` rejects an email `findEmail` rejects and
// retries one character later, and the handlers reject what they parse. Modern
// browsers keep the exact upstream behaviour.
//
// The loader throws when the module has a lookbehind it did not rewrite, so the
// build fails loudly rather than shipping a chunk old Safari cannot parse.
"use strict";

// mdast-util-gfm-autolink-literal 2.0.1, the version package-lock.json pins.
const LOOKBEHIND_LITERAL = String.raw`/(?<=^|\s|\p{P}|\p{S})([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/gu`;
const LOOKBEHIND_SOURCE = LOOKBEHIND_LITERAL.slice(1, LOOKBEHIND_LITERAL.lastIndexOf("/"));
const FALLBACK_LITERAL = String.raw`/([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/g`;

// A never-matching regex: the last resort, which disables autolinking there
// rather than crashing the chunk.
const NEVER_MATCHES = "/(?!)/";

/**
 * Rewrite the 2.0.1 email regex, then every regex literal with a lookbehind.
 * @param {string} source The module source.
 * @returns {string}
 */
function rewriteGfmAutolinkEmailRegex(source) {
  const index = source.indexOf(LOOKBEHIND_LITERAL);
  if (index !== -1) {
    const expression =
      `(function () { try { return new RegExp(${JSON.stringify(LOOKBEHIND_SOURCE)}, "gu"); } ` +
      `catch (_) { return ${FALLBACK_LITERAL}; } })()`;
    source = source.slice(0, index) + expression + source.slice(index + LOOKBEHIND_LITERAL.length);
  }

  const literals = findRegexLiterals(source).filter((literal) => hasLookbehind(literal.pattern));
  // Emit from the back, so the offsets of the literals still to come hold.
  for (const literal of literals.slice().reverse()) {
    source = source.slice(0, literal.start) + runtimeRegex(literal) + source.slice(literal.end);
  }

  const left = findRegexLiterals(source).filter((literal) => hasLookbehind(literal.pattern));
  if (left.length > 0) {
    throw new Error(
      "mdast-util-gfm-autolink-literal: " +
        `${left.length} regex literal(s) with lookbehind survived ` +
        "lib/gfm-autolink-email-loader.cjs, and Safari before 16.4 cannot parse them (#753). " +
        `First: ${left[0].literal.slice(0, 120)}`,
    );
  }
  return source;
}

const HAS_LOOKBEHIND = /\(\?<[=!]/;

function hasLookbehind(pattern) {
  return HAS_LOOKBEHIND.test(pattern);
}

/**
 * The replacement for one literal: build the modern regex at runtime, and where
 * that is refused, the same pattern with its lookbehind groups removed.
 * @param {{pattern: string, flags: string}} literal
 */
function runtimeRegex(literal) {
  const stripped = stripLookbehindGroups(literal.pattern);
  const flags = literal.flags;
  const plain = flags.replace("u", "");
  const tries = [
    `new RegExp(${JSON.stringify(literal.pattern)}, ${JSON.stringify(flags)})`,
    `new RegExp(${JSON.stringify(stripped)}, ${JSON.stringify(flags)})`,
    plain !== flags ? `new RegExp(${JSON.stringify(stripped)}, ${JSON.stringify(plain)})` : null,
  ].filter(Boolean);
  // Nested try/catch: the modern regex first, each fallback caught in the last.
  let body = `return ${NEVER_MATCHES};`;
  for (let index = tries.length - 1; index >= 0; index--) {
    body = `try { return ${tries[index]}; } catch (_) { ${body} }`;
  }
  return `(function () { ${body} })()`;
}

/**
 * Remove every `(?<=…)` / `(?<!…)` group from a pattern, nesting aware.
 * @param {string} pattern
 */
function stripLookbehindGroups(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      out += pattern.slice(i, i + 2);
      i += 1;
      continue;
    }
    if (ch === "[" ) {
      // A character class: copy it whole; `]` ends it (a leading `]` is literal).
      let j = i + 1;
      if (pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") {
        if (pattern[j] === "\\") j++;
        j++;
      }
      out += pattern.slice(i, j + 1);
      i = j;
      continue;
    }
    if (pattern.startsWith("(?<=", i) || pattern.startsWith("(?<!", i)) {
      i = skipGroup(pattern, i);
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * The index of the `)` that closes the group opening at `start`.
 * @param {string} pattern
 * @param {number} start
 */
function skipGroup(pattern, start) {
  let depth = 0;
  for (let i = start; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[") {
      // A class inside the group, e.g. `[\w+\-.]`; `]` ends it.
      let j = i + 1;
      if (pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") {
        if (pattern[j] === "\\") j++;
        j++;
      }
      i = j;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return pattern.length;
}

const REGEX_ALLOWED_AFTER = new Set(["(", ",", ":", "[", "!", "&", "|", "?", "{", "}", "=", ";", "+", "-", "*", "%", "~", "^", "<", ">", ""]);
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "case", "do", "else", "yield", "await", "throw",
]);

/**
 * The regex literals in a module's source. A `/` starts a literal only where a
 * value may begin (the usual division ambiguity), with strings, templates and
 * comments skipped whole so their `/` is never a start.
 * @param {string} source
 * @returns {{start: number, end: number, literal: string, pattern: string, flags: string}[]}
 */
function findRegexLiterals(source) {
  const literals = [];
  let prev = ""; // The last significant token: an operator char, a word, or a keyword.
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "*") {
      i = source.indexOf("*/", i + 2) + 2;
      continue;
    }
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipQuoted(source, i);
      prev = "word";
      continue;
    }
    if (ch === "/" && (REGEX_ALLOWED_AFTER.has(prev) || REGEX_KEYWORDS.has(prev))) {
      const parsed = parseRegexLiteral(source, i);
      if (parsed) {
        literals.push(parsed);
        i = parsed.end;
        prev = "word";
        continue;
      }
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[A-Za-z_$0-9]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_$]/.test(source[j])) j++;
      prev = source.slice(i, j);
      i = j;
      continue;
    }
    prev = ch;
    i++;
  }
  return literals;
}

/**
 * Parse a regex literal starting at its `/`.
 * @param {string} source
 * @param {number} start
 */
function parseRegexLiteral(source, start) {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\n") return null;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) break;
    i++;
  }
  if (i >= source.length) return null;
  let j = i + 1;
  while (j < source.length && /[a-z]/i.test(source[j])) j++;
  const literal = source.slice(start, j);
  return {
    start,
    end: j,
    literal,
    pattern: source.slice(start + 1, i),
    flags: source.slice(i + 1, j),
  };
}

/**
 * The index just past a string, template or quoted run.
 * @param {string} source
 * @param {number} start
 */
function skipQuoted(source, start) {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    // A template's `${ … }` holds code, which may open a regex; templates in
    // this module hold none, and a `${` ends the literal here.
    if (quote === "`" && ch === "$" && source[i + 1] === "{") return i + 2;
    if (quote !== "`" && ch === "\n") return i;
    i++;
  }
  return source.length;
}

module.exports = function gfmAutolinkEmailLoader(source) {
  return rewriteGfmAutolinkEmailRegex(source);
};
module.exports.rewriteGfmAutolinkEmailRegex = rewriteGfmAutolinkEmailRegex;
module.exports.findRegexLiterals = findRegexLiterals;
module.exports.stripLookbehindGroups = stripLookbehindGroups;
