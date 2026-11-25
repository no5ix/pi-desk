import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/native-theme.css", import.meta.url), "utf8");
/** The body of the LAST top-level rule for a selector. The shared popover-surface group
 *  near the top of the fork's stylesheet names this panel too; the panel's own block, the
 *  one that lays it out, is the later one. */
function cssRule(selector) {
  const parts = css.split(`\n${selector} {`);
  if (parts.length < 2) return null;
  const body = parts[parts.length - 1];
  return body.slice(0, body.indexOf("}"));
}

test("keeps the main session first and makes every agent session selectable", () => {
  const mainRow = source.indexOf("session={rootSession}");
  const subagentRows = source.indexOf("visibleSubagents.map");
  assert.ok(mainRow > 0);
  assert.ok(subagentRows > mainRow);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(rootSession\)\}/);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(session\)\}/);
  assert.match(source, /aria-selected=\{selected\}/);
});

test("sorts running subagents first and enables search only for larger families", () => {
  assert.match(source, /if \(aRunning !== bRunning\) return aRunning \? -1 : 1/);
  assert.match(source, /subagents\.length > 8/);
  assert.match(source, /relation\?\.description, relation\?\.profile, session\.name, session\.firstMessage/);
  assert.match(source, /maxHeight: "min\(58dvh, 480px\)"/);
});

test("renders as the app's own menu surface: a rounded card, flat rows, no rules inside", () => {
  // The panel used to be a box welded to the topbar: a hairline down each side and along
  // the bottom, a rule under the header, one under the search strip, one under every row.
  // The user asked for the surface the app's popups already use, so the panel wears
  // `.app-menu` (radius, separator, --shadow-popover) and its rows are flat menu rows.
  assert.match(source, /className="agent-session-panel app-menu"/, "the shared menu card carries the surface");
  assert.doesNotMatch(source, /borderLeft: "var\(--hairline\) solid var\(--border\)"/, "no hairline welded to the topbar");
  assert.doesNotMatch(source, /borderRadius: "0 0 var\(--radius-sm\) var\(--radius-sm\)"/, "no square bottom corners");
  assert.doesNotMatch(source, /borderBottom: "var\(--hairline\) solid var\(--border\)"/, "no rule under the header, the search box, or a row");
  assert.match(source, /className=\{`agent-row\$\{main \? " is-main" : ""\}\$\{selected \? " is-selected" : ""\}`\}/,
    "rows are class-styled menu rows, and the selected one is marked by class, not by an inline border; the main row says so, because its selection is styled apart");
  // The header row carries the whole summary, search included: name, counts, filter.
  const head = source.indexOf('className="agent-panel-head"');
  const search = source.indexOf('className="agent-panel-search"');
  const list = source.indexOf('className="agent-panel-list"');
  assert.ok(head > 0 && search > head && search < list,
    "the search box sits in the header row, above the list — not in a bordered strip of its own");
  assert.doesNotMatch(source, /maxWidth: 680/);
});

test("a running row leads with the header's subagent head, not a spinner", () => {
  // The header counts a running family with the subagent head; the row spun a circle. The
  // same state drawn two ways ten pixels apart, and a circle names no subagent.
  assert.match(source, /import \{ AgentRunningIcon \} from "\.\/TopbarSubagents";/);
  assert.match(source, /return <AgentRunningIcon size=\{14\} \/>;/, "one glyph, at row size");
  assert.doesNotMatch(source, /className="animate-spin"/, "no spinner left in the panel");
});

test("the main agent's Current label leads with the same head, at rest", () => {
  // Every state in the list had a glyph in front of it except the row the app is standing
  // on: "Completed", "Failed", "Running" all led with one, and "Current" was bare text.
  const current = source.match(/main && selected \? \(\s*<>[\s\S]*?<\/>\s*\)/);
  assert.ok(current, "the main row's label is a glyph and a word, not a bare word");
  assert.match(current[0], /<AgentRunningIcon size=\{14\} pulse=\{false\} \/>/,
    "the running row's head at row size, and `pulse={false}`: a static row must not blink");
  assert.match(current[0], /t\("agentSwitcher\.current"\)/);
});
test("the panel's stylesheet is the menu surface: rounded, shadowed, no rules drawn inside", () => {
  const panel = cssRule(".agent-session-panel");
  assert.ok(panel, "the panel has a fork rule of its own");
  assert.doesNotMatch(panel, /border:|--hairline|border-color/, "no hairline of its own: `.app-menu` carries the separator and the shadow");
  // The card hangs below the header's count, so it takes the surface every other popup
  // wears: the menu's radius, the elevated surface, the popover shadow. The tail of this
  // stylesheet used to square it (`border-radius: 0`) and repaint it with the topbar's
  // translucent `--bg-panel`, which left a grey sheet with right angles and no shadow —
  // the panel the user called ugly. The compound selector outranks a single-class rule.
  const card = css.match(/\.agent-session-panel\.app-menu \{[^}]*\}/);
  assert.ok(card, "the panel names the shared menu surface in its own stylesheet");
  assert.match(card[0], /border-radius: var\(--menu-radius\) !important;/, "a rounded rectangle, the app menu's radius");
  assert.match(card[0], /box-shadow: var\(--shadow-popover\) !important;/, "the app menu's shadow, so the card floats");
  assert.match(card[0], /background: var\(--surface-elevated\) !important;/, "an elevated surface, not the chrome's translucent ink");
  assert.ok(!/^\.agent-session-panel \{[^}]*border-radius: 0/m.test(css), "nothing squares the card from behind");
  assert.ok(!/^\.agent-session-panel \{[^}]*background: var\(--bg-panel\)/m.test(css),
    "and nothing repaints it with the topbar's ink");
  const row = cssRule(".agent-row");
  assert.ok(row, "the row has a fork rule of its own");
  assert.match(row, /border: 0;/, "rows carry no divider: the list draws no rules inside it");
  assert.match(row, /border-radius: var\(--menu-row-radius\);/, "flat rows round with the menu's rows");
  assert.match(css, /\.agent-row\.is-selected \{[^}]*background: transparent;[\s\S]*?box-shadow: none;/,
    "the row the chat stands on paints nothing: the user asked for the wash and the blue bar gone");
  assert.match(cssRule(".agent-panel-head") ?? "", /display: flex;/, "one header row carries the name, the counts and the search box");
  assert.match(cssRule(".agent-panel-search") ?? "", /margin-left: auto;/, "the search box sits at the end of that row");
  assert.match(source, /className="agent-panel-strip"/, "a row's confirmation and the steer field are inset strips, not ruled-off bands");
  assert.match(cssRule(".agent-panel-strip") ?? "", /border-radius: var\(--menu-row-radius\);/, "the strips round with the menu's rows");
});

test("the status sits in its own fixed track, so the states line up in one column", () => {
  // The status and a row's buttons shared one `auto` track, and each row is a grid of its
  // own: the main row's "Running" (a side-chat button beside it) started ~80px left of a
  // finished subagent's "Completed" (no button), so the states read as two columns.
  const row = cssRule(".agent-row");
  assert.match(row, /--agent-status-column: 84px;/, "a status track as wide as the widest label");
  assert.match(row, /--agent-actions-column: 48px;/, "an actions track as wide as the widest button pair");
  assert.match(row, /grid-template-columns: 28px minmax\(0, 1fr\) var\(--agent-status-column\) var\(--agent-actions-column\);/,
    "four tracks, two of them fixed: every row gets the same geometry");
  assert.match(cssRule(".agent-row-status") ?? "", /justify-self: start;/,
    "the state starts on its track's left edge in every row");
  assert.match(cssRule(".agent-row-actions") ?? "", /justify-self: end;/,
    "the buttons sit at the row's end, out of the state's column");
  assert.match(source, /className=\{`agent-row-status\$\{running \? " is-running" : ""\}\`\}/,
    "the status is a grid item of its own, and a running one is named");
  assert.match(source, /className="agent-row-actions"/, "and the row's buttons are another");
  assert.match(source, /const hasActions = controllable \|\| !!onNewSideChat \|\| !!onToggleTab \|\| !!onDelete;/,
    "a row with nothing to do draws no actions track, and its status stays in the same column");
  assert.match(cssRule(".agent-row-icon") ?? "", /color: var\(--accent\);/, "a subagent row's head is the accent");
  assert.match(cssRule(".agent-row.is-main .agent-row-icon") ?? "", /color: var\(--text-muted\);/,
    "the main agent's head stays the chrome's ink, as the header draws it");
  assert.match(css, /\.agent-row:not\(\.is-selected\):hover \.agent-row-title \{[^}]*color: var\(--text\);/,
    "the dimming never hides the row under the pointer");
  assert.match(css, /\.agent-row:not\(\.is-selected\) \.agent-row-status:not\(\.is-running\) \{[^}]*opacity: 0\.68;/,
    "a finished state dims with its row; a running one keeps its accent");
});

test("the main agent's row is flat, and the search box is a quiet filled field", () => {
  // The user's two complaints about the panel's top: the first row wore the menu's
  // selection (a grey wash and a blue bar) although the list always opens there and the
  // row says "Current" in words; and the filter box was an outlined field that lit up
  // with an accent border the moment the user typed in it.
  const main = cssRule(".agent-row.is-main.is-selected");
  assert.ok(main, "the main row's selected state is styled apart");
  assert.match(main, /background: transparent;/, "no wash on the main agent");
  assert.match(main, /box-shadow: none;/, "and no blue bar before its text");
  assert.match(cssRule(".agent-row.is-main.is-selected:hover") ?? "", /background: var\(--bg-hover\);/,
    "it is still a row: the pointer's wash answers when it arrives");
  // The hierarchy is ink, not paint: the row the chat stands on keeps its colour and
  // every other run in the family steps back. That is what replaces the wash.
  assert.match(css, /\.agent-row:not\(\.is-selected\) \.agent-row-title \{[^}]*color: var\(--text-muted\);/,
    "every other row's title steps back, so the current row is the loudest thing in the list");
  assert.match(css, /\.agent-row:not\(\.is-selected\) \.agent-row-subtitle \{[^}]*color-mix\(in srgb, var\(--text-dim\)/,
    "and its subtitle goes shallower with it");

  const search = cssRule(".agent-panel-search");
  assert.ok(search, "the search box has a fork rule of its own");
  assert.match(search, /border: 0;/, "no border at rest");
  assert.ok(!/border: var\(--hairline\)/.test(search), "the hairline is gone, not merely recoloured");
  assert.match(search, /background: color-mix\(in srgb, var\(--text\) 8%, transparent\);/,
    "a tint of the theme's ink, so the field stands off the card in light and dark");
  assert.ok(!/var\(--surface-muted\)/.test(search), "not the white wash that vanishes on the card");
  const focused = css.match(/\.agent-panel-search:focus,\s*\.agent-panel-search:focus-visible \{[^}]*\}/);
  assert.ok(focused, "one rule covers pointer and keyboard focus");
  assert.match(focused[0], /outline: none;/, "typing in it raises no ring");
  assert.match(focused[0], /border: 0;/, "and no border appears");
  assert.ok(!/var\(--accent\)/.test(focused[0]), "nothing lights up in the accent while typing");
  assert.ok(!/var\(--focus-ring\)/.test(focused[0]), "no ring at all");
});
test("shows persisted completion states while live running state takes precedence", () => {
  assert.match(source, /const status: SubagentSessionStatus = running \? "running" : relation\?\.status \?\? "completed"/);
  assert.match(source, /t\(`agentSwitcher\.status\.\$\{status\}`\)/);
  assert.match(source, /status === "failed"/);
  assert.match(source, /status === "aborted" \|\| status === "interrupted"/);
});

test("running sub-agents expose steer and stop controls wired to the runtime route", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
  const React = await jiti.import("react");
  const { renderToStaticMarkup } = await jiti.import("react-dom/server");
  const { AgentSessionPanel } = await jiti.import("./AgentSessionPanel.tsx");
  const { I18nProvider } = await jiti.import("@/hooks/useI18n");

  const root = { id: "main", name: "main", firstMessage: "", modified: "2026-01-01T00:00:00Z" };
  const runningSub = { id: "sub1", name: null, firstMessage: "task", modified: "2026-01-01T00:00:00Z", relation: { kind: "subagent", status: "running", profile: "researcher", description: "research" } };
  const doneSub = { id: "sub2", name: null, firstMessage: "done task", modified: "2026-01-01T00:00:00Z", relation: { kind: "subagent", status: "completed", profile: "researcher", description: "done" } };

  const html = renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(AgentSessionPanel, {
      rootSession: root,
      subagents: [runningSub, doneSub],
      selectedSessionId: "main",
      runningSessionIds: new Set(["sub1"]),
      onSelectSession() {},
    })));

  const runningRow = html.slice(html.indexOf("sub1") !== -1 ? html.indexOf("research") : 0);
  assert.match(html, /aria-label="Stop sub-agent"/);
  assert.match(html, /aria-label="Steer sub-agent"/);
  // Completed sub-agent rows carry no controls: count total stop buttons == running count.
  assert.equal((html.match(/aria-label="Stop sub-agent"/g) ?? []).length, 1);
  assert.equal((html.match(/aria-label="Steer sub-agent"/g) ?? []).length, 1);
  assert.ok(runningRow.length > 0);
  // The main row's "Current" is drawn, not only written: a head, then the word, and the
  // head is not pulsing (the panel opens on this row; nothing here is a live subagent run).
  const atCurrent = html.indexOf(">Current<");
  assert.ok(atCurrent > 0, "the main row still says Current in words");
  const mainStatus = html.slice(html.lastIndexOf("agent-row-status", atCurrent), atCurrent);
  assert.match(mainStatus, /<svg\b/, "the head glyph sits in front of the word");
  assert.ok(!mainStatus.includes("agent-status-icon--pulse"), "and it sits there at rest");
});

test("control actions POST to the subagent runtime endpoint", () => {
  assert.match(source, /\/api\/subagents\/\$\{encodeURIComponent\(id\)\}/);
  assert.match(source, /action: "abort" | "steer"/);
  assert.match(source, /JSON\.stringify\(\{ action, message \}\)/);
});
