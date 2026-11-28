import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

/**
 * The live deferred projection (Phase 5) stands on one accessor: the stream asks
 * the running session which entry it is now standing on, one microtask after a
 * message ended. `leafEntry()` is that answer, and it is the SDK's own leaf —
 * so this test drives a real `SessionManager` and asserts the descriptor the
 * stream gets, and that it carries no bytes of the entry itself.
 */
function wrapperFor(manager) {
  return new AgentSessionWrapper({
    sessionId: manager.getSessionId(),
    sessionFile: manager.getSessionFile() ?? "",
    agent: { state: {} },
    isStreaming: false,
    isIdle: true,
    isBashRunning: false,
    isCompacting: false,
    extensionRunner: {},
    sessionManager: manager,
    settingsManager: { getDefaultTools: () => [] },
    subscribe: () => () => {},
    dispose: () => {},
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
  });
}

test("the leaf of a real session names the entry, and nothing else", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-leaf-entry-"));
  const manager = SessionManager.create(root, join(root, "sessions"));
  const wrapper = wrapperFor(manager);
  t.after(async () => {
    wrapper.destroy();
    await rm(root, { recursive: true, force: true });
  });

  // An empty session has a leaf that is not a message (the header/first entry):
  // the stream's own rule is that only a moved message leaf of the right role
  // names an entry, and this is what it sees before any message lands.
  const bigThinking = "r".repeat(60 * 1024);
  const userId = manager.appendMessage({
    role: "user",
    content: [{ type: "text", text: `the prompt ${"p".repeat(5000)}` }],
    timestamp: Date.now(),
  });

  const leaf = wrapper.leafEntry();
  assert.ok(leaf, "a session with a message has a leaf to name");
  assert.equal(leaf.id, userId, "the leaf is the entry that was just appended");
  assert.equal(leaf.type, "message");
  assert.equal(leaf.role, "user");
  assert.deepEqual(Object.keys(leaf).sort(), ["id", "role", "type"],
    "the descriptor is id, type and role: a megabyte screenshot must not cross into the stream to answer a name");

  const assistantId = manager.appendMessage({
    role: "assistant",
    content: [
      { type: "thinking", thinking: bigThinking },
      { type: "text", text: "the answer" },
    ],
    model: "bench",
    provider: "bench",
    usage: { input: 1, output: 2 },
    stopReason: "stop",
    timestamp: Date.now(),
  });
  const leaf2 = wrapper.leafEntry();
  assert.equal(leaf2.id, assistantId, "the leaf moves with the append — that is the pair the stream compares");
  assert.equal(leaf2.role, "assistant");
  assert.ok(!JSON.stringify(leaf2).includes("r".repeat(100)), "the entry's reasoning stays in the file");
});

test("a session whose manager has no leaf accessor declines, and the message stays whole", () => {
  const wrapper = new AgentSessionWrapper({
    sessionId: "s",
    sessionFile: "",
    agent: { state: {} },
    isStreaming: false,
    isIdle: true,
    isBashRunning: false,
    isCompacting: false,
    extensionRunner: {},
    sessionManager: { getCwd: () => process.cwd() },
    settingsManager: { getDefaultTools: () => [] },
    subscribe: () => () => {},
    dispose: () => {},
    getContextUsage: () => null,
    getSteeringMessages: () => [],
    getFollowUpMessages: () => [],
  });
  try {
    assert.equal(wrapper.leafEntry(), null, "no accessor is not an error: the live path keeps every byte");
  } finally {
    wrapper.destroy();
  }
});
