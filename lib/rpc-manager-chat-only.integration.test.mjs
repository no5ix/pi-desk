import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentSessionServices } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true });

const EXTENSION_MODEL_ERROR = "extprov/ext-model is provided by an extension, and Chat only loads no extensions. Choose another model or tool preset.";

/**
 * Provider configuration from the shell: keys, tokens, endpoints and model pins.
 * The test below asserts that a Chat only session is left with NO usable model,
 * and the ambient environment decides that. The Pi desktop app's shell exports
 * ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN (a dev shell often exports provider
 * keys), which hands the session a working built-in model to start on; the
 * prompt then has a model, and the guard that names the extension model never
 * fires. Clear these for the test and restore them after it.
 */
const PROVIDER_ENV_PATTERN = /(^|_)(API_KEY|API_TOKEN|AUTH_TOKEN|ACCESS_TOKEN|SECRET_ACCESS_KEY|SECRET_KEY|BASE_URL|ENDPOINT|WIRE_API|_MODEL|_MODELS|_MODEL_OVERRIDES)$|^(ANTHROPIC|CLAUDE|OPENAI|OPENROUTER|GOOGLE|GEMINI|VERTEX|AWS|AZURE|XAI|MISTRAL|DEEPSEEK|ZAI|GROQ|QWEN|NVIDIA|DASHSCOPE|ZENMUX|MOONSHOT|MINIMAX|TOGETHER|FIREWORKS|CEREBRAS|COHERE|PERPLEXITY|SILICONFLOW|HUGGINGFACE|BEDROCK|PI_MODEL|PI_PROVIDER|PI_REASONING_LEVEL)/;

function isolateProviderEnvironment() {
  const saved = new Map();
  for (const name of Object.keys(process.env)) {
    if (PROVIDER_ENV_PATTERN.test(name)) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  }
  return () => {
    for (const [name, value] of saved) process.env[name] = value;
  };
}

test("Chat only names a model only an extension provides instead of a bare not found (#804)", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-chat-only-model-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => { if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir; });
  // No ambient provider credential may survive into the session: it would be a
  // model to start on, and the case under test is the one with no model at all.
  const restoreEnv = isolateProviderEnvironment();
  t.after(restoreEnv);
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "the shell's provider keys are cleared");
  // The extension's provider is the only model source, and the default model.
  await mkdir(join(dir, "extensions"), { recursive: true });
  await writeFile(join(dir, "extensions", "extprov.ts"), `export default function (pi) {
  pi.registerProvider("extprov", { baseUrl: "http://127.0.0.1:9", apiKey: "dummy", api: "openai-completions",
    models: [{ id: "ext-model", name: "Ext", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 }] });
}
`);
  await writeFile(join(dir, "settings.json"), JSON.stringify({ defaultProvider: "extprov", defaultModel: "ext-model" }));

  const { rememberProviderModels } = await jiti.import("./deferred-provider-models.ts");
  const { startRpcSession } = await jiti.import("./rpc-manager.ts");
  // The model selector's listing loads extensions, as /api/models does.
  const listing = await createAgentSessionServices({ cwd: dir, agentDir: dir });
  await rememberProviderModels(listing.modelRuntime);

  const { session } = await startRpcSession("__new__chat-only", "", dir, { toolNames: [] });
  t.after(() => session.shutdown());
  await assert.rejects(
    session.send({ type: "set_model", provider: "extprov", modelId: "ext-model" }),
    { message: EXTENSION_MODEL_ERROR },
  );
  // Left without a model, the prompt names the default it could not load, not a missing API key.
  await assert.rejects(session.send({ type: "prompt", message: "hi" }), { message: EXTENSION_MODEL_ERROR });

  // A model the browser chose is refused rather than replaced by another one.
  await assert.rejects(
    startRpcSession("__new__chat-only-chosen", "", dir, {
      toolNames: [],
      initialModel: { provider: "extprov", modelId: "ext-model" },
    }),
    { message: EXTENSION_MODEL_ERROR },
  );
});
