import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = async (file) => (await readFile(new URL(file, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const shell = await read("./AppShell.tsx");
const chat = await read("./ChatWindow.tsx");
const input = await read("./ChatInput.tsx");
const hook = await read("../hooks/useAgentSession.ts");
const agents = await read("./AgentSessionPanel.tsx");
const panel = await read("./SessionChatPanel.tsx");

test("/side forks before any new session is created and is offered mid-run (C1)", () => {
  assert.match(input, /\{ name: "side", description: "chat\.commandSide", source: "builtin", availableWhileStreaming: true \}/);
  const builtin = hook.slice(hook.indexOf("const handleBuiltinSlashCommand = useCallback"));
  assert.ok(builtin.indexOf('if (commandName === "side")') < builtin.indexOf("await ensureNewSession()"));
  assert.match(hook, /const result = await createSideChat\(sourceId, t, name\);/);
  assert.match(hook, /if \(relationKind === "side" \|\| relationKind === "subagent"\) return t\(SIDE_REFUSAL_MESSAGES\[relationKind\]\);/);
});

test("side chats open in right-panel tabs that leave the global Esc to the main chat", () => {
  assert.match(panel, /<ChatWindow[\s\S]*?panel\n\s*\/>/);
  // Esc stops what the page is running: the session's own turn, else the family's live
  // subagent runs (a background run leaves the main session idle). A side chat's tab
  // leaves the handler to the main chat, and is never handed the family's runs.
  assert.match(chat, /if \(!panel\) registerAbortHandler\(sessionBusy \? handleAbort : subagentsRunning \? handleAbortSubagents : null\);/);
  assert.match(shell, /\{activeSideTab \? \(\s*<div className="session-chat-panel" key=\{activeSideTab\.sessionId\}>\s*<SessionChatPanel/);
  // One session, one chat: the main chat showing a side chat closes its tab.
  assert.match(shell, /setSideTabs\(\(tabs\) => tabs\.filter\(\(tab\) => tab\.sessionId !== selectedSessionId\)\);/);
  // Chats (non-project) stay out of side chats.
  assert.match(shell, /onSideSession=\{isChatWorkspaceActive \? undefined : handleSideSession\}/);
});

test("the Agents panel starts, toggles and deletes side chats; a tab does not nest", () => {
  assert.match(agents, /onNewSideChat=\{onNewSideChat \? \(\) => void handleNewSideChat\(\) : undefined\}/);
  assert.match(agents, /onToggleTab=\{session\.relation\?\.kind === "side" && onToggleSideTab/);
  assert.match(agents, /onDelete=\{session\.relation\?\.kind === "side" && onDeleteSideChat/);
  assert.match(chat, /onSideChat=\{onSideSession && !isHiddenRelation\(session\?\.relation\) \? askInSideChat : undefined\}/);
  assert.match(chat, /if \(msg\.role === "custom" && msg\.customType === SIDE_BOUNDARY_MESSAGE_TYPE\) return <SideChatDivider key="side-chat-divider" \/>;/);
});
