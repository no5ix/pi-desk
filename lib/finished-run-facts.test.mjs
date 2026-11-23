import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { finishedRunFacts } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./finished-run-facts.ts");

const prompt = (text) => ({ role: "user", content: text });
const reply = (text, extra = {}) => ({
  role: "assistant",
  content: [{ type: "text", text }],
  provider: "test",
  model: "model-1",
  timestamp: 1_000,
  ...extra,
});
const report = () => ({
  role: "custom",
  customType: "pi-web:subagent-notification",
  content: "A subagent task finished.",
  display: true,
  timestamp: 2_000,
});

test("a run of a prompt the user typed is a finished task", () => {
  assert.deepEqual(
    finishedRunFacts([prompt("Fix the parser"), reply("Done.")]),
    { answeredSubagentReport: false, failed: false },
  );
});

test("a run that answered a subagent's report is that subagent's ending", () => {
  // The report is the newest anchor: the turn it triggered just settled, and a subagent
  // finishing notifies nothing (its report is the card in the chat).
  assert.equal(
    finishedRunFacts([prompt("Run the audit"), reply("Dispatched."), report(), reply("The audit found nothing.")])
      .answeredSubagentReport,
    true,
  );
  // The prompt came after the last report, so this run answers the user.
  assert.equal(
    finishedRunFacts([prompt("Run the audit"), report(), reply("Reported."), prompt("And now?"), reply("Here.")])
      .answeredSubagentReport,
    false,
  );
});

test("a run that ended in an error is a failure, and it notifies nothing", () => {
  const failed = reply("", { errorMessage: "API error (400): Offline interception, type fixture" });
  assert.equal(finishedRunFacts([prompt("Summarize the logs"), failed]).failed, true);
  assert.equal(finishedRunFacts([prompt("Summarize the logs"), reply("The logs are clean.")]).failed, false);
});

test("a compaction in the tail is neither a prompt nor a report", () => {
  // A context that opens after a compaction has no user entry: the run answers nothing,
  // so it counts as the user's own task, not a subagent's ending.
  assert.equal(
    finishedRunFacts([{ role: "compaction", summary: "…", firstKeptEntryId: "a1b2c3d4", tokensBefore: 90_000 }, reply("Reading on.")])
      .answeredSubagentReport,
    false,
  );
});
