import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { sessionMentionTitle } = await jiti.import("@/lib/session-reference");
const { buildSessionMentionText } = await jiti.import("@/lib/file-fuzzy");

test("the mention title is the session's own name, and its prompt in full", () => {
  assert.equal(sessionMentionTitle({ id: "s1", name: "Design Review", firstMessage: "a long prompt" }), "Design Review");
  assert.equal(sessionMentionTitle({ id: "s1", name: "   ", firstMessage: "Fix the sidebar" }), "Fix the sidebar");
  assert.equal(sessionMentionTitle({ id: "deadbeefcafe1234", firstMessage: "" }), "deadbeefcafe");
  // A prompt that wrapped over lines becomes one line of mention: a newline is kept as the space
  // it was, and a blank line as the pair of them. Nothing is cut — a cut label names no session.
  assert.equal(
    sessionMentionTitle({ id: "s1", firstMessage: "line one\nline two\n\nmore" }),
    "line one line two  more",
  );
  // The label goes inside `#"..."`, so a double quote would close the token early.
  assert.equal(
    sessionMentionTitle({ id: "s1", firstMessage: 'the build said "expected : got ident" and stopped' }),
    "the build said 'expected : got ident' and stopped",
  );
  assert.equal(sessionMentionTitle({ id: "s1", name: 'say "hi"' }), "say 'hi'");
});

test("the row menu's mention and the composer's own `#` pick are the same words", async () => {
  // One rule for both (lib/session-reference.ts): the palette used to build its label inline, so a
  // mention inserted from the row menu came out cut to 50 characters and a palette pick came out
  // whole. The palette now calls the rule, so there is nothing left to drift.
  const palette = await read("../hooks/useSessionMentionPalette.ts");
  assert.match(palette, /import \{ sessionMentionTitle \} from "@\/lib\/session-reference";/);
  assert.match(palette, /const visibleSessionName = sessionMentionTitle\(\{/);
  assert.ok(
    !/const sessionDisplayName = entry\.name/.test(palette),
    "the palette has no second label rule of its own",
  );
});

test("the inserted text is the shape the composer's own `#` autocomplete writes", () => {
  // The send path resolves these labels (lib/session-reference.ts), so the menu inserts nothing
  // the composer could not have produced itself, and the trailing space keeps typing going.
  assert.equal(buildSessionMentionText(sessionMentionTitle({ id: "s1", name: "Design Review" })), '#"Design Review" ');
  assert.equal(buildSessionMentionText(sessionMentionTitle({ id: "abc-1" })), "#abc-1 ");
});

test("the session row menu offers Insert into chat, in both its shapes", async () => {
  const sidebar = await read("./SessionSidebar.tsx");
  // The native popup (desktop shell) and the DOM `.app-menu` list carry the same action.
  const native = sidebar.slice(sidebar.indexOf("const showNativeSessionMenu"));
  assert.match(native, /\.\.\.\(onInsertMention\n\s*\? \[\{ label: t\("sidebar\.insertIntoChat"\), onSelect: \(\) => onInsertMention\(session\) \}\]/);
  assert.match(sidebar, /onClick=\{\(\) => \{ setMenuOpen\(false\); onInsertMention\(session\); \}\}/);
  assert.match(sidebar, /\{t\("sidebar\.insertIntoChat"\)\}/);
  // It is a row action, so it reaches the rows through the family item, gated like its neighbours.
  assert.match(sidebar, /onInsertMention=\{depth === 0 \? onInsertMention : undefined\}/);
  assert.match(sidebar, /onInsertMention\?: \(session: SessionInfo\) => void;/);
});

test("the app inserts at the composer's caret and sends nothing", async () => {
  const shell = await read("./AppShell.tsx");
  const handler = shell.slice(shell.indexOf("const handleInsertSessionMention"));
  const body = handler.slice(0, handler.indexOf("\n  const ", 20));
  // The composer owns the insert: the label rule, the caret, the separator, the rest of the text.
  assert.match(body, /chatInputRef\.current\?\.insertSessionMention\(session\)/);
  assert.ok(!/handleSend|onSend|sendMessage/.test(body), "the menu inserts; the prompt stays the user's to send");
  assert.match(shell, /onInsertMention=\{handleInsertSessionMention\}/);
  const input = await read("./ChatInput.tsx");
  const mention = input.slice(input.indexOf("insertSessionMention(session: {"));
  const mentionBody = mention.slice(0, mention.indexOf("\n    },"));
  assert.match(mentionBody, /const label = sessionMentionTitle\(session\);/);
  assert.match(mentionBody, /sessionMentionTargetsRef\.current\.set\(label, session\.id\);/, "the label is registered for the send path, as a palette pick registers it");
  assert.match(mentionBody, /insertTextAtCaret\(buildSessionMentionText\(label\)\);/);
  // The composer already owns that insertion: the caret, the separator, the rest of the text.
  const insert = input.slice(input.indexOf("const insertTextAtCaret = useCallback("));
  assert.match(insert, /const start = ta\.selectionStart \?\? ta\.value\.length;/);
  assert.match(insert, /const newVal = before \+ sep \+ text \+ after;/);
  assert.match(input, /insertText\(text: string\) \{\s*insertTextAtCaret\(text\);/, "the public insertText is the same path");
  assert.match(input, /insertSessionMention: \(session: \{ id: string; name\?: string; firstMessage\?: string \}\) => void;/);
});

test("every locale names the menu item", async () => {
  const plugins = await read("../lib/i18n/locale-plugins.ts");
  const english = plugins.match(/"sidebar\.insertIntoChat": "Insert into chat",/g) ?? [];
  const chinese = plugins.match(/"sidebar\.insertIntoChat": "插入到聊天",/g) ?? [];
  assert.equal(english.length, 1, "en");
  assert.equal(chinese.length, 2, "zh-CN and zh-TW");
});
