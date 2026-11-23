import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

// The conversation header reads `[folder] project  [branch] branch  [clock] 1h50m`,
// where the last chip counts from the last prompt and ticks. Two rules these tests
// keep: the count starts at the user's own prompt (a background subagent's report,
// a compaction summary and a side-chat boundary are custom messages, not prompts),
// and the ticking label is a component of its own — AppShell owns the row, and a
// label that re-renders every second inside AppShell re-renders the shell, the
// sidebar and the chat column with it.

const { getLocalePlugin, getSupportedLocales } = await createJiti(import.meta.url).import("../lib/i18n/registry.ts");

const appShell = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const chatWindow = readFileSync(new URL("./ChatWindow.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const topbarElapsed = readFileSync(new URL("./TopbarElapsed.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const hook = readFileSync(new URL("../hooks/useElapsedSince.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the clock chip sits after the branch, in the project row", () => {
  assert.match(appShell, /import \{ TopbarElapsed \} from "\.\/TopbarElapsed";/);
  const rowStart = appShell.indexOf('<span className="app-topbar-subtitle-row">');
  const chipAt = appShell.indexOf("<TopbarElapsed since={lastPromptAt} />");
  assert.ok(rowStart > 0 && chipAt > rowStart, "the clock renders inside the project row");
  const row = appShell.slice(rowStart, chipAt + 40);
  const projectAt = row.indexOf('className="app-topbar-project"');
  const branchAt = row.indexOf('className="app-topbar-branch"');
  assert.ok(projectAt > 0 && branchAt > 0, "the project and the branch render in the same row");
  assert.ok(projectAt < branchAt, "[folder] project, then [branch] branch, then the clock");
  assert.match(appShell, /\{showChat && !pageOpen && <TopbarElapsed since=\{lastPromptAt\} \/>\}/,
    "a page (Tasks, Calendar, Artifacts) has no conversation, so it shows no clock");
});

test("the value comes from the chat, and a session switch clears it", () => {
  assert.match(appShell, /const \[lastPromptAt, setLastPromptAt\] = useState<number \| null>\(null\);/);
  assert.match(appShell, /const handleLastPromptChange = useCallback\(\(timestamp: number \| null\) => \{/);
  assert.match(appShell, /onLastPromptChange=\{handleLastPromptChange\}/);
  assert.match(chatWindow, /onLastPromptChange\?: \(timestamp: number \| null\) => void;/);
  const memo = chatWindow.match(/const lastPromptAt = useMemo\(\(\) => \{[\s\S]*?\}, \[messages\]\);/);
  assert.ok(memo, "one scan over the messages, cached with them");
  assert.match(memo[0], /if \(getUserInputText\(messages\[idx\]\) !== null\) \{\s*promptIdx = idx;\s*break;/, "the user's own message (or their /skill command) starts the count");
  assert.match(memo[0], /for \(let idx = Math\.max\(0, promptIdx\); idx < messages\.length; idx\+\+\) \{\s*const time = \(messages\[idx\] as \{ timestamp\?: number \}\)\.timestamp;/,
    "a user entry carries no time, so the clock starts at the first time the transcript records for that prompt (a context that opens after a compaction has no prompt: its first time is the start)");
  assert.match(chatWindow, /turnDurationMs=\{turnDurationByIndex\.get\(idx\)\}/,
    "the length beside Copy is not gated by the sparser timestamp rule: it shows on every finished turn");
  assert.match(chatWindow, /useEffect\(\(\) => \(\) => \{ onLastPromptChange\?\.\(null\); \}, \[onLastPromptChange\]\);/,
    "unmounting reports null, so the header never keeps a clock from the session that was left");
});

test("the count ticks, and only the chip re-renders", () => {
  assert.match(topbarElapsed, /const elapsed = useElapsedSince\(since\);/);
  assert.match(topbarElapsed, /if \(elapsed === null\) return null;/, "no prompt, no chip: the hydration render has no session");
  assert.match(topbarElapsed, /<small className="app-topbar-elapsed"/);
  assert.match(topbarElapsed, /<ClockIcon size=\{11\} \/>/);
  assert.match(topbarElapsed, /\{formatTurnDurationCompact\(elapsed\)\}/, "1h50m, not 1h 50m 12s");
  assert.match(topbarElapsed, /title=\{t\("chat\.elapsedSincePrompt", \{ duration: formatTurnDuration\(elapsed\) \}\)\}/,
    "the tooltip carries the exact length the label rounds away");
  assert.match(hook, /const tick = \(\) => setElapsed\(Math\.max\(0, Date\.now\(\) - since\)\);/);
  assert.match(hook, /window\.setInterval\(tick, 1_000\)/, "a clock, so seconds are the tick");
  assert.match(hook, /return \(\) => window\.clearInterval\(timer\);/, "and the interval leaves with the chip");
  assert.match(hook, /if \(since === null\) \{\s*setElapsed\(null\);/, "a null timestamp stops the clock");
});

test("the chip is styled with the row, and the row is the phone's context line", () => {
  assert.match(css, /\.app-topbar-elapsed \{[\s\S]*?font-variant-numeric: tabular-nums;[\s\S]*?\}/,
    "the digits keep their width, so a ticking label does not re-flow the row");
  assert.match(css, /\.app-topbar-elapsed \{[\s\S]*?flex: 0 0 auto;/, "the clock is never squeezed away; the project name gives way");
  assert.match(css, /\.app-topbar-elapsed svg \{\s*flex: 0 0 auto;/);
  const phone = css.match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/g) ?? [];
  assert.ok(phone.some((block) => /\.app-topbar-title \{\s*max-width: min\(64vw, 340px\);/.test(block)),
    "the phone's title block is wide enough to carry project, branch and clock");
  assert.ok(css.includes("min-width: 5.5em") && css.includes("min-width: 5em"),
    "the project label keeps a few characters and its icon, so the long branch name is what ellipsizes");
  const narrow = css.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/)[0];
  assert.doesNotMatch(narrow, /\.app-topbar-subtitle-row \{\s*display: none;/, "the row is not hidden on a narrow screen");
});

test("every locale can say what the clock counts", () => {
  for (const locale of getSupportedLocales()) {
    const text = getLocalePlugin(locale).messages["chat.elapsedSincePrompt"];
    assert.equal(typeof text, "string", `${locale} has chat.elapsedSincePrompt`);
    assert.ok(text.includes("{duration}"), `${locale} keeps {duration}`);
  }
});
