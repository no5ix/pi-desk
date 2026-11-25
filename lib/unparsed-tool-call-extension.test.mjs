import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  UNPARSED_TOOL_CALL_BUDGET,
  UNPARSED_TOOL_CALL_EXTENSION_NAME,
  createUnparsedToolCallExtension,
} = await jiti.import("./unparsed-tool-call-extension.ts");
const { UNPARSED_TOOL_CALL_CUSTOM_TYPE } = await jiti.import("./unparsed-tool-call.ts");

const CAPTURED = "<tool_call>\n<=read>\n<parameter=path>\ndocs/agents/fork-ui.md\n</parameter>\n<parameter=offset>\n80\n</parameter>\n</function>\n</tool_call>";

/** The boundary event pi hands a `agent_before_settle` handler. */
function settleEvent({
  outcome = "completed",
  canContinue = true,
  requestedContinue = false,
  messages = [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: CAPTURED }] }],
  entries = [],
} = {}) {
  return {
    type: "agent_before_settle",
    outcome,
    continue: requestedContinue,
    entries,
    context: {
      canContinue,
      contextEntries: [],
      contextMessages: messages,
      llmMessages: [],
      pendingMessages: [],
    },
  };
}

function handlersFor(options) {
  const handlers = new Map();
  const extension = createUnparsedToolCallExtension(options);
  assert.equal(extension.hidden, true);
  extension.factory({ on: (name, handler) => handlers.set(name, handler) });
  return { extension, handlers };
}

test("the extension listens at the settle boundary only", () => {
  const { extension, handlers } = handlersFor();
  assert.equal(extension.name, UNPARSED_TOOL_CALL_EXTENSION_NAME);
  assert.deepEqual([...handlers.keys()], ["tool_call", "agent_start", "agent_before_settle"]);
});

test("a run that ends on a printed call is continued, once, with the note appended", async () => {
  const { handlers } = handlersFor();
  const settle = handlers.get("agent_before_settle");
  const prior = [{ type: "custom_entry", customType: "other" }];
  const result = await settle(settleEvent({ entries: prior }));

  assert.equal(result.continue, true);
  // The boundary's own drafts are kept: a handler replaces the list, it does not own it.
  assert.deepEqual(result.entries.slice(0, prior.length), prior);
  const appended = result.entries[prior.length];
  assert.equal(appended.type, "custom_message");
  assert.equal(appended.customType, UNPARSED_TOOL_CALL_CUSTOM_TYPE);
  // Displayed: the user watches the reason, not just a continuation.
  assert.equal(appended.display, true);
  assert.deepEqual(appended.details, {
    toolNames: ["read"],
    sample: CAPTURED,
    attempt: 1,
    budget: UNPARSED_TOOL_CALL_BUDGET,
  });

  // The same session printing calls again is a loop, and the budget closes it.
  const second = await settle(settleEvent({ entries: prior }));
  assert.equal(second.entries[prior.length].details.attempt, 2);
  assert.equal(await settle(settleEvent({ entries: prior })), undefined);
  assert.equal(await settle(settleEvent({ entries: prior })), undefined);
});

test("a real tool call buys the budget back", async () => {
  const { handlers } = handlersFor();
  const settle = handlers.get("agent_before_settle");
  assert.equal((await settle(settleEvent())).entries[0].details.attempt, 1);
  await handlers.get("tool_call")({ toolName: "read" });
  assert.equal((await settle(settleEvent())).entries[0].details.attempt, 1);
  await handlers.get("agent_start")({});
  assert.equal((await settle(settleEvent())).entries[0].details.attempt, 1);
});

test("aborted, failed, continued and uncontinuable runs are left alone", async () => {
  const { handlers } = handlersFor();
  const settle = handlers.get("agent_before_settle");
  assert.equal(await settle(settleEvent({ outcome: "aborted" })), undefined);
  assert.equal(await settle(settleEvent({ outcome: "error" })), undefined);
  assert.equal(await settle(settleEvent({ canContinue: false })), undefined);
  assert.equal(await settle(settleEvent({ requestedContinue: true })), undefined);
  assert.equal(await settle(settleEvent({ messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "The card fills the column now." }] }] })), undefined);
});

test("a switch can turn it off", async () => {
  const { handlers } = handlersFor({ isEnabled: () => false });
  assert.equal(await handlers.get("agent_before_settle")(settleEvent()), undefined);
});

test("the budget is a small number", () => {
  assert.equal(UNPARSED_TOOL_CALL_BUDGET, 2);
});

// ── Wiring ─────────────────────────────────────────────────────────────────

const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");
const rpcManager = source("./rpc-manager.ts");
const extensionLists = rpcManager.split("extensionFactories: [").slice(1);
/** The subagent run's own list, built as a variable rather than inline. */
function subagentList() {
  const start = rpcManager.indexOf("const subagentExtensionFactories = [");
  assert.ok(start > 0, "the subagent extension list is built inline again");
  return rpcManager.slice(start, rpcManager.indexOf("];", start));
}

function listMentioning(needle) {
  const list = extensionLists.find((chunk) => chunk.includes(needle));
  assert.ok(list, `no extensionFactories list mentions ${needle}`);
  return list;
}

test("a normal session and a subagent run get the extension", () => {
  assert.match(listMentioning("createSubagentExtension("), /createUnparsedToolCallExtension\(\)/);
  assert.match(subagentList(), /createUnparsedToolCallExtension\(\)/);
});

test("a chat does not: it has no file or shell tool to print", () => {
  const chat = listMentioning("createChatWorkspaceExtension(");
  assert.match(chat, /createArtifactGuideExtension\(\)/);
  assert.doesNotMatch(chat, /createUnparsedToolCallExtension\(\)/);
});

test("the note has a title in every locale, and starts the continued turn", () => {
  const messageView = source("../components/MessageView.tsx");
  assert.match(messageView, /UNPARSED_TOOL_CALL_CUSTOM_TYPE/);
  assert.match(messageView, /chat\.unparsedToolCallTitle/);
  const display = source("./message-display.ts");
  assert.match(display, /UNPARSED_TOOL_CALL_CUSTOM_TYPE/);
  const locales = source("./i18n/locale-plugins.ts");
  const en = locales.indexOf('"en": {');
  const zhCN = locales.indexOf('"zh-CN": {');
  const zhTW = locales.indexOf('"zh-TW": {');
  for (const start of [en, zhCN, zhTW]) {
    assert.ok(start > 0);
    assert.match(locales.slice(start, start + 60_000), /"chat\.unparsedToolCallTitle":/);
  }
});
