import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The context ring left the composer's control strip for the conversation header:
// `[folder] project  [branch] branch  [subagents] ✓ N ⚠ N ↻ N  [clock]  [context]`.
// It belongs with the conversation's other state, and its sentence (`37.6% ctx ·
// 161.8M tok`) is longer than a phone, so it is shown in the app's own tip — which
// opens on hover, focus **or a tap**, where a native `title` never opens.

const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const chip = await readFile(new URL("./TopbarContextChip.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");
const plugins = await readFile(new URL("../lib/i18n/locale-plugins.ts", import.meta.url), "utf8");

test("the composer carries no context control any more", async () => {
  assert.doesNotMatch(chatInput, /ContextUsageRing/, "the ring is not in the composer's row");
  await assert.rejects(readFile(new URL("./ContextUsageRing.tsx", import.meta.url)),
    "the composer's ring file is gone, so nothing can render it twice");
  // ChatInput no longer receives the numbers, but the chat keeps the callback: its own
  // usage command opens the header's panel.
  assert.doesNotMatch(chatInput, /contextUsage|sessionStats/);
  assert.match(chatWindow, /onSessionStatsPanelOpen/, "the usage command still reaches the panel");
});

test("the header renders the chip last, on a conversation only", () => {
  const block = appShell.match(/<div className="app-topbar-title"[\s\S]*?<\/div>/);
  assert.ok(block, "the title block is in the header");
  const row = block[0].slice(block[0].indexOf('className="app-topbar-subtitle-row"'));
  assert.ok(row.length > 0, "the subtitle row is inside the title block");
  const at = (name) => row.indexOf(name);
  assert.ok(at("<TopbarProjectChip") < at("<TopbarBranchChip"), "project, then branch");
  assert.ok(at("<TopbarBranchChip") < at("<TopbarSubagents"), "then the runs");
  assert.ok(at("<TopbarSubagents") < at("<TopbarContextChip"), "and the context is the row's last control");
  assert.match(appShell, /<TopbarContextChip\n\s*contextUsage=\{contextUsage\}\n\s*sessionStats=\{sessionStats\}\n\s*onOpenStats=\{openSessionStatsPanel\}\n\s*\/>/,
    "it reads the state the chat already reports to the shell");
  const gate = appShell.match(/\{showChat && !pageOpen && \(\s*<TopbarContextChip/);
  assert.ok(gate, "a page (Tasks, Scheduled, Artifacts) has no conversation to measure");
});

test("the chip is a control whose tip carries the sentence, not a native tooltip", () => {
  assert.match(chip, /const \{ tipId, open, pos, tipRef, triggerProps \} = useTopbarTip<HTMLButtonElement>\(\);/);
  assert.match(chip, /className="app-topbar-context-hit"/);
  assert.match(chip, /aria-label=\{t\("chat\.contextTipTitle", \{ summary \}\)\}/,
    "the accessible name is the same sentence the tip shows");
  assert.doesNotMatch(chip, /\btitle=\{/, "no native tooltip: it never opens on a phone");
  assert.match(chip, /\{open \? \(\s*<TopbarTip/, "the tip is out of the a11y tree while closed");
  assert.match(chip, /<TopbarTipRow label=\{t\("chat\.ctxUsage"\)} value=\{summary\} \/>/);
  // The ring's click used to open the stats panel; the tip keeps that way in.
  assert.match(chip, /<button type="button" className="app-topbar-tip-action" onClick=\{onOpenStats\}>\s*\{t\("appshell\.sessionStats"\)\}/);
});

test("nothing is shown when there is nothing to report", () => {
  assert.match(chip, /if \(!contextUsage || summary === null\) return null;/,
    "a session that has never run gets no ring: an empty one reads as a spinner");
  assert.match(chip, /const CTX_DANGER_PCT = 90;/);
  assert.match(chip, /pct >= CTX_DANGER_PCT\s*\n?\s*\?\s*"var\(--danger\)"/, "the high-risk arc is red");
  assert.match(chip, /stroke=\{color\}/);
});

test("the chip is styled with the row's other controls", () => {
  for (const selector of [".app-topbar-project-hit,\n.app-topbar-branch-hit,\n.app-topbar-context-hit {",
    ".app-topbar-project-hit:hover,", ".app-topbar-context-hit[aria-describedby]",
    ".app-topbar-project-hit:focus-visible,\n.app-topbar-branch-hit:focus-visible,\n.app-topbar-context-hit:focus-visible {"]) {
    assert.ok(css.includes(selector), `the row's control rule covers the context chip (${selector.split("\n")[0]}…)`);
  }
  assert.match(css, /\.app-topbar-context \{[^}]*flex: 0 0 auto;/, "the ring never shrinks: the project name is what gives way");
  assert.match(css, /\.app-topbar-tip \.app-topbar-tip-action \{[^}]*background: none;/, "the tip's action is a row, not a pasted button");
  const value = css.slice(css.indexOf(".app-topbar-tip-value {"), css.indexOf("}", css.indexOf(".app-topbar-tip-value {")));
  assert.ok(value.includes("white-space: normal") && value.includes("overflow-wrap: anywhere"),
    "the tip's value never ellipsizes: it carries what the row cut");
});

test("the words exist in every language", () => {
  for (const key of ["chat.contextTipTitle", "chat.contextTipWindowLabel"]) {
    const hits = plugins.match(new RegExp(`"${key}":`, "g")) ?? [];
    assert.equal(hits.length, 3, `${key} in en, zh-CN and zh-TW`);
  }
  assert.equal(plugins.match(/"chat\.contextTipTitle": "[^"]*\{summary\}/g)?.length, 3,
    "every translation carries the sentence through");
});
