import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const searchSource = await readFile(new URL("./SessionSearch.tsx", import.meta.url), "utf8");
const routeSource = await readFile(new URL("../app/api/sessions/search/route.ts", import.meta.url), "utf8");
const { englishMessages, forkLocalePlugins } = await createJiti(import.meta.url).import("../lib/i18n/locale-plugins.ts");

// The full-text session search was fully implemented upstream (component + API
// route) but the fork's rewritten sidebar never mounted it, so the feature sat
// unreachable: the search box only filtered project-tree titles. These pins keep
// the wiring attached — a merge that drops the import or the wrapper brings back
// a search box that silently searches nothing.
test("the sidebar mounts the content-search wrapper around the project tree", () => {
  assert.match(source, /import \{ SessionSearch \} from "\.\/SessionSearch"/);
  assert.match(source, /<SessionSearch\s+open=\{contentSearch\}/);
  assert.match(source, /query=\{sessionQuery\}/);
  assert.match(source, /onSelectSession=\{handleSelectSessionFromList\}/);
  // The tree must stay the wrapper's child, not a sibling the results replace.
  const treeStart = source.indexOf("<SessionSearch");
  const treeEnd = source.indexOf("onScroll={handleListScroll}", treeStart);
  const treeMarkup = source.slice(treeStart, treeEnd);
  assert.match(treeMarkup, /ref=\{listScrollRef\}/);
  assert.match(treeMarkup, /className="sidebar-project-tree"/);
  assert.match(treeMarkup, /role="tree"/);
  assert.ok(
    treeMarkup.includes('aria-label={`${t("sidebar.chats")} / ${t("sidebar.projects")}`}'),
    "the tree label names both the chat and project sections",
  );
});

test("the search row escalates typed text to content search, with Enter as the way in", async () => {
  assert.match(source, /const \[contentSearch, setContentSearch\] = useState\(false\)/);
  // Enter escalates the typed query to the server-side content search. The 22px
  // magnifier chip that used to sit beside the input read as a second search
  // field, so the keyboard is the only way in and clearing the row is the way
  // back out.
  assert.doesNotMatch(source, /sidebar-search-mode/);
  assert.match(source, /e\.key === "Enter"[\s\S]{0,240}?setContentSearch\(true\)/);
  assert.match(source, /e\.key === "Escape"[\s\S]{0,240}?setContentSearch\(false\)/);
  assert.match(source, /className="sidebar-search-clear"[\s\S]{0,400}?setContentSearch\(false\)/);
  // Typing escalates on its own once it settles, and only where the tree cannot answer. The tree
  // sees a session's title and its first prompt, so a prompt from the middle of a session was
  // unreachable while typing: the label promises prompts, so the box has to search them.
  assert.match(source, /const AUTO_CONTENT_SEARCH_DELAY_MS = \d+;/);
  assert.match(source, /const AUTO_CONTENT_SEARCH_MIN_CHARS = 2;/);
  assert.match(
    source,
    /if \(normalizeSessionQuery\(sessionQuery\)\.length < AUTO_CONTENT_SEARCH_MIN_CHARS\) return;/,
    "one keystroke does not trade the tree for a results list",
  );
  assert.match(
    source,
    /if \(filteredSessions\.length > 0\) \{\s*setContentSearch\(false\);\s*return;/,
    "a query the tree answers keeps the tree, and the results list closes when the tree can answer again",
  );
  assert.match(
    source,
    /setTimeout\(\(\) => \{\s*setContentScope\("prompts"\);\s*setContentSearch\(true\);\s*\}, AUTO_CONTENT_SEARCH_DELAY_MS\)/,
    "the settle asks the prompt question, not the whole-transcript one",
  );
  assert.match(source, /}, \[sessionQuery, filteredSessions\.length\]\);/, "a list refresh must not reset the timer");
  assert.match(source, /const \[contentScope, setContentScope\] = useState<"text" \| "prompts">\("text"\)/);
  assert.match(source, /e\.key === "Enter"[\s\S]{0,300}?setContentScope\("text"\);\s*setContentSearch\(true\);/, "Enter is the whole-text question, at once");
  assert.match(source, /<SessionSearch[\s\S]{0,200}?scope=\{contentScope\}/, "the open list answers the scope that opened it");
  assert.match(searchSource, /new URLSearchParams\(\{ q: search, scope \}\)/, "the scope goes to the route");
  assert.match(routeSource, /scope === "prompts" \? searchSessionPrompts : searchSessionContents/);
  const promptSearch = await readFile(new URL("../lib/session-prompt-search.ts", import.meta.url), "utf8");
  assert.match(promptSearch, /cachedSessionPrompts\(session\.path\)/, "prompts come from the calendar's cached reader, not a fresh scan per keystroke");
  assert.match(promptSearch, /const TIME_BUDGET_MS = \d+;/, "a cold first pass is bounded");
  // Discoverability for the hidden gesture: the input itself carries the hint, in its
  // tooltip. The placeholder stays a label — on a 390px phone the box is 235px wide, and
  // "Search titles… · Enter for full text" was cut to "…full te", which reads as damage.
  assert.match(source, /title=\{t\("sidebar\.searchAllHint"\)\}/);
  assert.match(englishMessages["sidebar.searchAllHint"], /Enter/);
  assert.match(englishMessages["sidebar.searchAllHint"], /prompt/i, "the hint names the prompts the box searches");
  // The label names what the box answers: the row's title and the prompts inside any session.
  const titleWords = ["titles", "标题", "標題"];
  const promptWords = ["prompts", "提示词", "提示詞"];
  for (const { name, messages } of forkLocalePlugins) {
    const locale = name ?? "locale";
    const placeholder = messages["sidebar.searchSessions"];
    assert.ok(placeholder, `${locale}: the search box keeps its label`);
    assert.ok(!placeholder.includes("·"), `${locale}: no second clause in the label (${placeholder})`);
    assert.ok(!/Enter/i.test(placeholder), `${locale}: the gesture is not the label's business (${placeholder})`);
    assert.ok(
      titleWords.some((word) => placeholder.toLowerCase().includes(word)),
      `${locale}: the label names titles (${placeholder})`,
    );
    assert.ok(
      promptWords.some((word) => placeholder.includes(word)),
      `${locale}: the label promises prompts, which is what the box searches (${placeholder})`,
    );
  }
});

test("selecting a result carries the entry id so the chat can jump to the match", () => {
  // SessionSearch hands (session, entryId, blockIndex) to the sidebar, which
  // forwards them to AppShell.handleSelectSession -> setSearchTarget.
  assert.match(searchSource, /onSelectSession\(session, entryId, blockIndex\)/);
  assert.match(source, /onSelectSession\(s, false, entryId, blockIndex\)/);
  assert.match(routeSource, /await search\(searchable, query, request\.signal\)/, "one call, whichever scope was asked");
});

test("content-search rows label chats without exposing the hidden workspace path", () => {
  assert.match(
    searchSource,
    /title=\{session\.workspaceKind === "chat" \? t\("sidebar\.chats"\) : session\.cwd\}/,
  );
  assert.match(
    searchSource,
    /\{session\.workspaceKind === "chat" \? t\("sidebar\.chats"\) : session\.cwd\}/,
  );
  assert.match(englishMessages["sidebar.chats"], /Chats/);
});
