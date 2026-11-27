import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { sessionMentionTitle } = await jiti.import("@/lib/session-reference");
const { buildSessionMentionText } = await jiti.import("@/lib/file-fuzzy");

test("the mention title is the session's own name, the way the row shows it", () => {
  assert.equal(sessionMentionTitle({ id: "s1", name: "Design Review", firstMessage: "a long prompt" }), "Design Review");
  assert.equal(sessionMentionTitle({ id: "s1", name: "   ", firstMessage: "Fix the sidebar" }), "Fix the sidebar");
  assert.equal(sessionMentionTitle({ id: "deadbeefcafe1234", firstMessage: "" }), "deadbeefcafe");
  // A prompt that wrapped over lines is one line of title, cut the way the row cuts it.
  assert.equal(
    sessionMentionTitle({ id: "s1", firstMessage: "line one\nline two\n\nmore" }),
    "line one line two more",
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
  assert.match(body, /chatInputRef\.current\?\.insertText\(buildSessionMentionText\(sessionMentionTitle\(session\)\)\)/);
  assert.ok(!/handleSend|onSend|sendMessage/.test(body), "the menu inserts; the prompt stays the user's to send");
  assert.match(shell, /onInsertMention=\{handleInsertSessionMention\}/);
  // The composer already owns that insertion: the caret, the separator, the rest of the text.
  const input = await read("./ChatInput.tsx");
  const insert = input.slice(input.indexOf("insertText(text: string) {"));
  assert.match(insert, /const start = ta\.selectionStart \?\? ta\.value\.length;/);
  assert.match(insert, /const newVal = before \+ sep \+ text \+ after;/);
});

test("every locale names the menu item", async () => {
  const plugins = await read("../lib/i18n/locale-plugins.ts");
  const english = plugins.match(/"sidebar\.insertIntoChat": "Insert into chat",/g) ?? [];
  const chinese = plugins.match(/"sidebar\.insertIntoChat": "插入到聊天",/g) ?? [];
  assert.equal(english.length, 1, "en");
  assert.equal(chinese.length, 2, "zh-CN and zh-TW");
});
