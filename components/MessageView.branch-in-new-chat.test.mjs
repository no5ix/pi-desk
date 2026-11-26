import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A finished reply's footer has one branch chip: "Branch in new chat", next to Copy
// (the screenshots that asked for it: the final report's `Copy` row). It sends pi's
// `fork_branch` at that reply's entry, so the new session carries the conversation
// through the answer — a report is continued from, not from before.
//
// The user row's old "New session" chip is gone. Two ways to leave a session was one
// too many on a phone: the row keeps Copy and "Edit from here" (an in-session branch),
// and the sidebar keeps the Fork of the whole session. A `fork` (which copies only what
// comes *before* the entry) has no chat button at all.

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const messageView = read("components/MessageView.tsx");
const chatWindow = read("components/ChatWindow.tsx");
const agentSession = read("hooks/useAgentSession.ts");
const css = read("app/native-theme.css");
const english = read("lib/i18n/messages/en.ts");
const zhCN = read("lib/i18n/messages/zh-CN.ts");
const zhTW = read("lib/i18n/messages/zh-TW.ts");

const section = (start, end) => {
  const from = messageView.indexOf(start);
  assert.ok(from > 0, `${start} found`);
  const to = messageView.indexOf(end, from);
  assert.ok(to > from, `${end} found after ${start}`);
  return messageView.slice(from, to);
};

test("a prompt's row has no New session / fork chip", () => {
  const userView = section("function UserMessageView({", "\nfunction AssistantMessageView({");
  assert.doesNotMatch(userView, /i18n\.newSession/, "the label is gone from the user row");
  assert.doesNotMatch(userView, /onFork|canFork/, "and the view is not handed a fork callback");
  assert.match(userView, /\{t\("i18n\.editFromHere"\)\}/, "in-session branching stays on the row");
  assert.doesNotMatch(messageView, /t\("i18n\.newSession"\)|t\("i18n\.newSessionTitle"\)/,
    "the whole message list has no New session chip: the keys have no caller left");
});

test("the reply's footer carries the branch chip beside Copy", () => {
  const footer = messageView.match(/<div className="message-assistant-footer"[\s\S]*?\n      <\/div>/);
  assert.ok(footer, "assistant footer found");
  assert.match(footer[0], /canBranchInNewChat && \(/, "the chip renders only when there is an entry to branch at");
  assert.match(footer[0], /onClick=\{\(\) => \{ onBranchInNewChat!\(entryId!\); \}\}/,
    "the click branches at this reply's entry");
  assert.match(footer[0], /title=\{forking \? t\("i18n\.creatingSession"\) : t\("i18n\.branchInNewChatTitle"\)\}/,
    "the hover says what the copy will hold, and Creating… while it runs");
  assert.match(footer[0], /\{forking \? t\("i18n\.creating"\) : t\("i18n\.branchInNewChat"\)\}/);
  assert.match(footer[0], /disabled=\{forking\}/, "one branch per reply at a time");
  const gate = messageView.match(/const canBranchInNewChat = [^\n]+/);
  assert.ok(gate, "the gate is one expression");
  assert.match(gate[0], /!isStreaming/, "the streaming tail has no entry on disk: forking it would copy a half answer");
  assert.match(gate[0], /!!entryId && !!onBranchInNewChat/, "a render without a session (a side-chat preview) shows no chip");
  assert.match(gate[0], /!insideProcessDetails/, "a step inside a turn's Process details shows no chip: the report below the group is what a new chat continues from");
  assert.match(messageView, /const insideProcessDetails = useContext\(ProcessDetailsContext\);/, "one context says so — the group's provider, the same one a thinking card reads");
  const glyph = footer[0].match(/className="message-assistant-action message-branch-action"[\s\S]*?<svg([\s\S]*?)<\/svg>/);
  assert.ok(glyph, "the chip carries its glyph");
  assert.match(glyph[1], /<circle cx="6" cy="6" r="2\.5" \/>[\s\S]*<circle cx="18" cy="6" r="2\.5" \/>/, "a fork: two heads on top");
  assert.match(glyph[1], /<circle cx="12" cy="18" r="2\.5" \/>/, "and one node below them, the session it starts");
  assert.match(glyph[1], /<path d="M6 8\.5V10a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8\.5M12 13v2\.5" \/>/,
    "the two heads join one trunk: the row's fork mark's shape, sized for 12px");
  assert.doesNotMatch(glyph[1], /<line x1="6" y1="3" x2="6" y2="15" \/>/, "the old lopsided rail is gone");
  assert.match(footer[0], /<span className="message-action-label">\{forking/,
    "the label is a span, so a phone under 380px keeps the glyph and the title");
});

test("the branch callback reaches only the reply, and travels the memo", () => {
  const routing = messageView.match(/export const MessageView = memo\(function MessageView\([\s\S]*?\n  if \(message\.role === "toolResult"\)/)[0];
  assert.match(routing, /<AssistantMessageView[\s\S]*?onBranchInNewChat=\{onBranchInNewChat\} forking=\{forking\}/);
  assert.doesNotMatch(routing, /<UserMessageView[^>]*onBranchInNewChat=/, "the prompt row is not handed it");
  const comparator = messageView.match(/\(prev, next\) => \{[\s\S]*?\n\}/)[0];
  assert.match(comparator, /&& prev\.onBranchInNewChat === next\.onBranchInNewChat\b/,
    "MessageView is memoized with a hand-written comparator: an unlisted prop never updates");
  assert.match(comparator, /&& prev\.forking === next\.forking\b/, "the Creating… state is listed too");
});

test("ChatWindow offers the chip only where a fork can be written", () => {
  assert.match(chatWindow, /onBranchInNewChat=\{bashRunning \|\| isNew \? undefined : handleBranchInNewChat\}/,
    "a shell command holds the session file; a not-yet-saved chat has no file to copy");
  assert.doesNotMatch(chatWindow, /onFork=\{/, "no message row is handed the exclusive fork any more");
});

test("handleBranchInNewChat forks the branch that ends at the entry", () => {
  const handler = agentSession.match(/const handleBranchInNewChat = useCallback[\s\S]*?\n  \}, \[[^\]]*\]\);/);
  assert.ok(handler, "the handler exists beside handleFork");
  assert.match(handler[0], /type: "fork_branch"/,
    "fork_branch copies the entry itself; the plain fork stops at its parent");
  assert.match(handler[0], /entryId,\n      \}\);/, "at this reply's entry");
  assert.match(handler[0], /if \(bashRunningRef\.current\) return;/, "the same shell guard as Fork");
  assert.match(handler[0], /setForkingEntryId\(entryId\);[\s\S]*setForkingEntryId\(null\);/,
    "the chip reads Creating… while the copy runs, and resets after");
  assert.match(handler[0], /onSessionForked\?\.\(newSessionId\);/,
    "the browser moves to the copy, as the sidebar's Fork does");
  assert.match(handler[0], /addNotice\(\{ type: "error", message: t\("chat\.forkFailed"/,
    "a refused fork (a side chat, an unsaved file) is a notice, not a silent click");
  assert.match(agentSession, /handleSend,[^\n]*handleBranchInNewChat,/, "the hook returns it");
});

test("the footer chips are revealed the same way and wrap on a phone", () => {
  const reveal = css.match(/\/\* Message actions are pointer-revealed[\s\S]*?\n\}\n\n\/\* The workbench styles/);
  assert.ok(reveal, "the reveal block is found");
  assert.match(reveal[0], /\.message-assistant:hover \.message-assistant-action,/, "hover reveals the branch chip");
  assert.match(reveal[0], /\.message-assistant:focus-within \.message-assistant-action/,
    "so does keyboard focus: no invisible control in the tab order");
  assert.match(reveal[0], /@media \(hover: none\) \{[\s\S]*?\.message-assistant-action \{\s*\n\s*opacity: 1;/,
    "and on a touch screen, where there is no hover, it is simply there");
  assert.match(css, /\.message-assistant \.message-copy-action,\n\.message-assistant \.message-assistant-action \{\n  background: var\(--bg-subtle\) !important;/,
    "both footer chips get the shared filled chip, never bare text");
  const footerRule = css.match(/\.message-assistant-footer \{[\s\S]*?\n\}/)[0];
  assert.match(footerRule, /flex-wrap: wrap;/,
    "Copy plus Branch in new chat plus the duration plus the time is wider than a phone");
});

test("every locale can name the chip", () => {
  for (const [name, pack] of [["en", english], ["zh-CN", zhCN], ["zh-TW", zhTW]]) {
    for (const key of ["i18n.branchInNewChat", "i18n.branchInNewChatTitle"]) {
      assert.match(pack, new RegExp(`"${key}": "${"[^\"\\n]+"}"`), `${name} has ${key}`);
    }
    assert.doesNotMatch(pack, /"i18n\.newSession":/, `${name} drops the key nothing asks for`);
    assert.doesNotMatch(pack, /"i18n\.newSessionTitle":/, `${name} drops the key's title too`);
  }
});
