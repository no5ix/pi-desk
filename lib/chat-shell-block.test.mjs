import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { CHAT_SHELL_BLOCK_MARKER, lastTurnHitChatShellBlock, lastTurnNamesUnavailableTool } = await jiti.import("./chat-shell-block.ts");
const { chatBlockedToolReason } = await jiti.import("./chat-workspace-policy.ts");

const user = { role: "user", content: "run it" };
const assistant = { role: "assistant", content: [] };
const blocked = (reason) => ({ role: "toolResult", toolName: "bash", isError: true, content: [{ type: "text", text: reason }] });

test("the server's refusal of a shell in a chat with a folder carries the marker", () => {
  assert.ok(chatBlockedToolReason("bash", true).startsWith(CHAT_SHELL_BLOCK_MARKER));
  assert.ok(chatBlockedToolReason("powershell", true).startsWith(CHAT_SHELL_BLOCK_MARKER));
});

test("a refused shell call in the latest turn is found, and an older turn's is not", () => {
  const reason = chatBlockedToolReason("bash", true);
  assert.equal(lastTurnHitChatShellBlock([user, assistant, blocked(reason), assistant]), true);
  // The user has written since: the need is stale.
  assert.equal(lastTurnHitChatShellBlock([user, assistant, blocked(reason), assistant, user, assistant]), false);
  assert.equal(lastTurnHitChatShellBlock([user, assistant]), false);
  assert.equal(lastTurnHitChatShellBlock([]), false);
});

test("other tool errors do not offer the permission, and string content works", () => {
  assert.equal(lastTurnHitChatShellBlock([user, blocked("write failed: disk full")]), false);
  assert.equal(lastTurnHitChatShellBlock([user, { role: "toolResult", content: `${CHAT_SHELL_BLOCK_MARKER} nope` }]), true);
});

const reply = (text) => ({ role: "assistant", content: [{ type: "text", text }] });

test("a reply that names a tool the chat withheld names the need, and the name is what is offered", () => {
  // The shape the fix is for: in a locked chat the task manager's tool is not declared to the
  // model, so the model explains that it is not in its function list. That sentence is the need —
  // the chat has a switch the user can reach, and the page offers it there.
  const refusal = reply("I cannot start them: the `bg_run` tool is not exposed as a callable tool; only get_module_plan is available.");
  assert.equal(lastTurnNamesUnavailableTool([user, refusal], ["bg_run"]), "bg_run");
  assert.equal(lastTurnNamesUnavailableTool([user, refusal], ["get_module_plan", "bg_run"]), "get_module_plan");
});

test("the scan is the reply's own words, after the user's last message", () => {
  const refusal = reply("`bg_run` is not callable here.");
  // The user has written since: the need is stale, exactly as with a refused shell.
  assert.equal(lastTurnNamesUnavailableTool([user, refusal, user, reply("here you are")], ["bg_run"]), null);
  // A tool result is the extension talking, not the model asking for a tool.
  assert.equal(lastTurnNamesUnavailableTool([user, { role: "toolResult", content: "bg_run: started" }], ["bg_run"]), null);
  // Nothing withheld: nothing to notice.
  assert.equal(lastTurnNamesUnavailableTool([user, refusal], []), null);
  assert.equal(lastTurnNamesUnavailableTool([], ["bg_run"]), null);
});

test("only whole names count: bg_run is not bg_runner, and prose about tasks is not a tool", () => {
  assert.equal(lastTurnNamesUnavailableTool([user, reply("the bg_runner tool is missing")], ["bg_run"]), null);
  assert.equal(lastTurnNamesUnavailableTool([user, reply("I started three background tasks for you.")], ["bg_run"]), null);
  assert.equal(lastTurnNamesUnavailableTool([user, reply("Say the word and I will call bg_run.")], ["bg_run"]), "bg_run");
  // A name outside the tool-name characters is dropped, never turned into a pattern: the list
  // comes from the tool registry, and a name the registry cannot produce is not evidence of a need.
  assert.equal(lastTurnNamesUnavailableTool([user, reply("no such tool: a.b")], ["a.b"]), null);
});

test("the names a chat withholds are its extensions' tools, not its coding tools", async () => {
  const { chatWithheldExtensionToolNames } = await jiti.import("./chat-workspace-policy.ts");
  const tools = [
    { name: "bash", exposure: "direct", sourceInfo: { type: "builtin" } },
    { name: "bg_run", exposure: "direct", sourceInfo: { type: "extension", extensionPath: "/x/index.ts" } },
    { name: "bg_run", exposure: "hidden", sourceInfo: { type: "extension", extensionPath: "/x/index.ts" } },
    { name: "mcp__notes__search", exposure: "direct", sourceInfo: { type: "mcp" } },
  ];
  assert.deepEqual(chatWithheldExtensionToolNames(tools, new Set(), true), ["bg_run"]);
  // The user added the tool to this chat: it is no longer withheld, so nothing is offered.
  assert.deepEqual(chatWithheldExtensionToolNames(tools, new Set(["bg_run"]), true), []);
});
