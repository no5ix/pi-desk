import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A finished reply's footer has one branch chip: "Branch in new chat", next to Copy
// (the screenshots that asked for it: the final report's `Copy` row). It sends pi's
// `fork_branch` at that reply's entry, so the new session carries the conversation
// through the answer — a report is continued from, not from before.
//
// The chip has ONE place per TURN: below the blocks that turn produced. It rides in the
// report's footer, and when a turn has no report — an aborted tool call, an interrupted
// reply, an `Error:` line, whose rows are all folded inside the turn's Process details
// card — ChatWindow draws the same component in a row of its own (`.chat-branch-tail`),
// under the card and above the next prompt. Every other place used to draw one: a chip
// under every finished turn's every step, and one per unfolded step of a running turn — a
// column of identical buttons that all fork the same conversation.
//
// The user row's old "New session" chip is gone. Two ways to leave a session was one
// too many on a phone: the row keeps Copy and "Edit from here" (an in-session branch),
// and the sidebar keeps the Fork of the whole session. A `fork` (which copies only what
// comes *before* the entry) has no chat button at all.

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const messageView = read("components/MessageView.tsx");
const branchAction = read("components/message-branch-action.tsx");
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

test("the chip is one component, shared by the footer and the tail row", () => {
  assert.match(branchAction, /export function MessageBranchAction\(\{[\s\S]*?forking\?: boolean;[\s\S]*?onBranch: \(\) => void;/,
    "one component, two callers: the reply's footer and ChatWindow's tail row");
  assert.match(branchAction, /className="message-assistant-action message-branch-action"/,
    "the class the footer's reveal, plate and phone rules all address by name");
  assert.match(branchAction, /title=\{forking \? t\("i18n\.creatingSession"\) : t\("i18n\.branchInNewChatTitle"\)\}/,
    "the hover says what the copy will hold, and Creating… while it runs");
  assert.match(branchAction, /disabled=\{forking\}/, "one branch per conversation at a time");
  assert.match(branchAction, /aria-live="polite"/, "the Creating… word is announced");
  assert.match(branchAction, /\{forking \? t\("i18n\.creating"\) : t\("i18n\.branchInNewChat"\)\}/);
  assert.match(branchAction, /<span className="message-action-label">\{forking/,
    "the label is a span, so a phone under 380px keeps the glyph and the title");
  const glyph = branchAction.match(/<svg[\s\S]*?<\/svg>/);
  assert.ok(glyph, "the chip carries its glyph");
  assert.match(glyph[0], /<circle cx="6" cy="6" r="2\.5" \/>[\s\S]*<circle cx="18" cy="6" r="2\.5" \/>/, "a fork: two heads on top");
  assert.match(glyph[0], /<circle cx="12" cy="18" r="2\.5" \/>/, "and one node below them, the session it starts");
  assert.match(glyph[0], /<path d="M6 8\.5V10a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V8\.5M12 13v2\.5" \/>/,
    "the two heads join one trunk: the sidebar row's fork mark, sized for 12px");
  assert.doesNotMatch(glyph[0], /<line x1="6" y1="3" x2="6" y2="15" \/>/, "the old lopsided rail is gone");
  // The chip is a control: its shape is CSS, not an inline style (AGENTS.md).
  assert.doesNotMatch(branchAction, /style=\{\{/, "no inline styling in the chip");
  assert.doesNotMatch(branchAction, /onMouseEnter/, "and its hover ink is CSS, not a JS handler");
  const chip = css.match(/\.message-branch-action \{[^}]*\}/);
  assert.ok(chip, "the chip's shape is a rule");
  for (const declaration of [
    /display: flex;/,
    /height: var\(--control-h-sm\);/,
    /border-radius: var\(--radius-sm\);/,
    /color: var\(--text-dim\);/,
    /font-size: var\(--fs-micro\);/,
  ]) {
    assert.match(chip[0], declaration, `the chip's rule carries ${declaration}`);
  }
  assert.match(css, /\.message-branch-action:hover:not\(:disabled\) \{\n  color: var\(--accent\);\n\}/,
    "the accent arrives on hover, as the Copy chip's does");
  assert.match(css, /\.message-branch-action:disabled \{[^}]*color: var\(--accent\);[^}]*cursor: not-allowed;/,
    "and stays there while the copy is being written");
});

test("the reply's footer carries the branch chip beside Copy", () => {
  const footer = messageView.match(/<div className="message-assistant-footer"[\s\S]*?\n      <\/div>/);
  assert.ok(footer, "assistant footer found");
  assert.match(footer[0], /canBranchInNewChat && \(\n          <MessageBranchAction forking=\{forking\} onBranch=\{\(\) => \{ onBranchInNewChat!\(entryId!\); \}\} \/>/,
    "the chip renders only when there is an entry to branch at, and branches at this reply's entry");
  const gate = messageView.match(/const canBranchInNewChat = [^\n]+/);
  assert.ok(gate, "the gate is one expression");
  assert.match(gate[0], /!isStreaming/, "the streaming tail has no entry on disk: forking it would copy a half answer");
  assert.match(gate[0], /!!entryId && !!onBranchInNewChat/, "a render without a session (a side-chat preview) shows no chip");
  assert.match(gate[0], /!insideProcessDetails/, "a step inside a turn's Process details shows no chip: the report under the group is what a new chat continues from");
  assert.match(messageView, /const insideProcessDetails = useContext\(ProcessDetailsContext\);/, "one context says so — the group's provider, the same one a thinking card reads");
});

test("the row that ENDS a turn is the one handed the callback", () => {
  assert.match(chatWindow, /onBranchInNewChat=\{options\.branchRow && !bashRunning && !isNew \? handleBranchInNewChat : undefined\}/,
    "one chip per turn, and the row that earns it is the one the turn ends on. " +
    "A shell command holds the session file; a not-yet-saved chat has no file to copy.");
  const finalAnswer = chatWindow.match(/rendered\.push\(renderMessage\(finalAssistantIdx, \{[\s\S]*?\}\)\);/);
  assert.ok(finalAnswer, "the report row is rendered");
  assert.match(finalAnswer[0], /branchRow: true,/, "the report is the turn's last block: it carries the chip");
  const processViews = chatWindow.match(/const renderProcessView = \(processIdx: number, index: number\) => \{[\s\S]*?\n                \};/);
  assert.ok(processViews, "the step renderer is found");
  assert.doesNotMatch(processViews[0], /branchRow/, "a step inside the turn is never handed it: that was a column of identical buttons");
  assert.match(chatWindow, /renderMessage\(processIdx, \{\s*attachRef,\s*keyPrefix: "process",/);
  assert.doesNotMatch(chatWindow, /onFork=\{/, "no message row is handed the exclusive fork any more");
});

test("a turn cut short gets its chip under the card, in a row of its own", () => {
  // A turn that ends on an aborted tool call, an interrupted reply or an `Error:` line
  // has no report, so every one of its rows is folded inside the Process details card and
  // nothing below carries a footer. Its chip is still the last thing above the next prompt.
  const tail = chatWindow.match(/const turnBranchEntryId = finalAnswerMessage \|\| isNew \|\| bashRunning[\s\S]*?\n                \}/);
  assert.ok(tail, "the row is decided per turn, inside the turn's loop");
  assert.match(tail[0], /entryIds\[finalAssistantIdx\]/,
    "it forks at the newest entry of THAT turn: through the aborted call, the interrupted reply, the error line");
  assert.match(tail[0], /key=\{`branch-tail-\$\{messageKeys\[finalAssistantIdx\]/,
    "one row per turn, keyed with the turn's own row key");
  assert.match(tail[0], /className="chat-branch-tail"/);
  assert.match(tail[0], /<MessageBranchAction\b/, "the same component as the footer's chip");
  assert.match(tail[0], /forking=\{forkingEntryId === turnBranchEntryId\}/, "and its own Creating… state");
  assert.match(tail[0], /onBranch=\{\(\) => \{ handleBranchInNewChat\(turnBranchEntryId\); \}\}/,
    "one fork: the conversation copied through the entry the interrupted turn stopped at");
  const tailAt = chatWindow.indexOf("const turnBranchEntryId =");
  const answerAt = chatWindow.indexOf("const { startIndex } = getVisibleRenderWindow");
  assert.ok(tailAt > 0 && answerAt > tailAt, "the row is pushed while the turn is rendered, not once for the whole chat");
  const rule = css.match(/\.chat-branch-tail \{[^}]*\}/);
  assert.ok(rule, "the row has its rule");
  assert.match(rule[0], /display: flex;/);
  assert.match(rule[0], /flex-wrap: wrap;/, "the chip and whatever joins it wrap on a phone");
  assert.match(rule[0], /margin-top: 4px;/, "it sits under the card, not in its padding");
  assert.match(css, /\.chat-branch-tail \.message-assistant-action \{\n  background: var\(--bg-subtle\) !important;\n\}/,
    "it takes the footer chips' plate that `.message-assistant` normally supplies");
  assert.match(css, /\.chat-branch-tail:has\(\+ \*\) \{\n  margin-bottom: 16px;\n\}/,
    'the row keeps the conversation\'s 16px gap under itself — the ask: "the Branch in new chat button and subagent report are too close"; the next turn\'s card began flush under the chip\'s plate');
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.message-branch-action \{\n    display: none !important;\n  \}\n  \/\* The row is left standing with nothing in it once the chip is gone\. \*\/\n  \.chat-branch-tail \{\n    display: none;\n  \}/,
    "a phone that hides the chip hides the empty row with it");
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
