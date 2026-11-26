import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  COMMAND_TIMEOUT_MS,
  DEFAULT_COMMAND_TIMEOUT_MS,
  commandTimeoutDescriptionSuffix,
  commandTimeoutParameterDescription,
  commandTimeoutParametersSchema,
  commandTimeoutSeconds,
  resolveCommandTimeoutMs,
  resolveEffectiveTimeoutSeconds,
} = await jiti.import("./command-timeout.ts");

test("the default is minutes of honest build time, not hours of a hang", () => {
  assert.equal(DEFAULT_COMMAND_TIMEOUT_MS, 30 * 60_000);
  assert.equal(COMMAND_TIMEOUT_MS, DEFAULT_COMMAND_TIMEOUT_MS, "the resolved default follows the constant unless the environment says otherwise");
  // Far past the 7849-second command that held one real session for 2h11m.
  assert.ok(DEFAULT_COMMAND_TIMEOUT_MS < 7_849_000);
});

test("the environment sets, disables, or leaves the default alone", () => {
  assert.equal(resolveCommandTimeoutMs(undefined), DEFAULT_COMMAND_TIMEOUT_MS);
  assert.equal(resolveCommandTimeoutMs(""), DEFAULT_COMMAND_TIMEOUT_MS);
  assert.equal(resolveCommandTimeoutMs("0"), 0, "0 is pi's own no-default-timeout behaviour");
  assert.equal(resolveCommandTimeoutMs("45000"), 45_000);
  assert.equal(resolveCommandTimeoutMs("abc"), DEFAULT_COMMAND_TIMEOUT_MS);
  assert.equal(resolveCommandTimeoutMs("-1"), DEFAULT_COMMAND_TIMEOUT_MS);
  assert.equal(resolveCommandTimeoutMs("99999999999999"), DEFAULT_COMMAND_TIMEOUT_MS);
});

test("the timeout the command runs with: the model's number when it gave one", () => {
  assert.equal(resolveEffectiveTimeoutSeconds(900, 1_800_000), 900, "a longer request is honoured — a test suite gets its hour");
  assert.equal(resolveEffectiveTimeoutSeconds(30, 1_800_000), 30, "a shorter one too: the model decides");
  assert.equal(resolveEffectiveTimeoutSeconds(undefined, 1_800_000), 1_800, "none: the installation's bound, in seconds");
  assert.equal(resolveEffectiveTimeoutSeconds(0, 1_800_000), 1_800, "pi rejects 0, so it is not a request for no timeout");
  assert.equal(resolveEffectiveTimeoutSeconds("60", 1_800_000), 1_800, "a string is not a number pi accepts");
  assert.equal(resolveEffectiveTimeoutSeconds(Number.NaN, 1_800_000), 1_800);
  assert.equal(resolveEffectiveTimeoutSeconds(undefined, 0), undefined, "the default disabled: no timeout at all");
});

test("seconds never round to zero, which pi would reject", () => {
  assert.equal(commandTimeoutSeconds(1_000), 1);
  assert.equal(commandTimeoutSeconds(400), 1, "the floor of one second, not the zero pi throws on");
  assert.equal(commandTimeoutSeconds(0), undefined);
  assert.equal(commandTimeoutSeconds(-5), undefined);
});

test("the model is told the default, because the schema description is the whole contract", () => {
  const description = commandTimeoutParameterDescription(1_800_000);
  assert.match(description, /1800 seconds/);
  assert.match(description, /[Pp]ass a larger value/);
  // pi's own text promised the opposite, and a model that believes it never passes one.
  assert.doesNotMatch(description, /no default timeout/);
  assert.equal(
    commandTimeoutParameterDescription(0),
    "Timeout in seconds (optional, no default timeout)",
    "with the default disabled the schema says exactly that",
  );

  const suffix = commandTimeoutDescriptionSuffix(1_800_000);
  assert.match(suffix, /stopped after 1800 seconds/);
  assert.match(commandTimeoutDescriptionSuffix(0), /Optionally provide a timeout in seconds/);
});

test("the parameters schema keeps pi's shape and states the bound", () => {
  const schema = commandTimeoutParametersSchema(1_800_000);
  assert.equal(schema.type, "object");
  assert.deepEqual(Object.keys(schema.properties), ["command", "timeout"]);
  assert.equal(schema.properties.command.type, "string");
  assert.equal(schema.properties.timeout.type, "number");
  assert.match(schema.properties.timeout.description, /1800 seconds/);
});
