import assert from "node:assert/strict";
import { test } from "node:test";
import { createJiti } from "jiti";

const { markSubagentReportRun, peekSubagentReportRuns, takeSubagentReportRun } =
  await createJiti(import.meta.url, { tsconfigPaths: true }).import("./subagent-report-runs.ts");

test("a report marks one run, and a subagent ending notifies nothing", () => {
  const parent = "parent-report-runs";
  markSubagentReportRun(parent);
  assert.ok(peekSubagentReportRuns().includes(parent));

  // The run the report started is the subagent's ending: the announcer skips it.
  assert.equal(takeSubagentReportRun(parent), true);
  // The run after it is an ordinary one. The mark is spent, so a task the user is
  // waiting on is announced as usual.
  assert.equal(takeSubagentReportRun(parent), false);
  assert.ok(!peekSubagentReportRuns().includes(parent), "no mark is left behind");
});

test("a report to one parent says nothing about the runs of another", () => {
  const a = "parent-a";
  const b = "parent-b";
  markSubagentReportRun(a);
  assert.equal(takeSubagentReportRun(b), false, "a session that got no report keeps its announcement");
  assert.equal(takeSubagentReportRun(a), true);
});
