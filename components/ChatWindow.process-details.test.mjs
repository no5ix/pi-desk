import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("groups the leading segment when the history page starts mid-turn", () => {
  // A turn longer than the initial page loses its anchor, and the old loop
  // flattened every message before the first anchor instead of grouping them.
  assert.match(source, /const hasAnchor = isMessageGroupAnchor\(msg\)/);
  assert.match(source, /if \(!hasAnchor && idx !== 0\)/);
  assert.match(source, /const userIdx = hasAnchor \? idx : -1/);
  assert.match(source, /const groupStartIdx = hasAnchor \? idx : 0/);
  assert.match(source, /if \(hasAnchor\) rendered\.push\(renderMessage\(userIdx\)\)/);
});

test("process details never open themselves", () => {
  // A stopped task, a stopped session and a running turn's older work all fold
  // into the card, and it opens collapsed every time. Nothing here may pass a
  // truthy defaultExpanded: opening a session used to expand the card, and an
  // unanswered turn expanded it by default.
  assert.match(source, /<ProcessDetailsGroup[\s\S]*?defaultExpanded=\{false\}/);
  assert.doesNotMatch(source, /defaultExpanded=\{!finalAnswerMessage\}/);
  assert.doesNotMatch(source, /defaultExpanded=\{[^f][^}]*\}/);
});

test("the running turn folds everything but its trailing blocks", () => {
  // Live tail: the blocks the user is watching stay unfolded, the rest fold.
  // The count is a named constant, and a finished turn folds all of them.
  assert.match(source, /const LIVE_PROCESS_TAIL_BLOCKS = 8;/);
  assert.match(
    source,
    /const foldCount = liveTail\s*\?\s*Math\.max\(0, processIndexes\.length - LIVE_PROCESS_TAIL_BLOCKS\)\s*:\s*processIndexes\.length;/,
  );
  // Only the live tail unfolds: `liveTail` is the running session's last group.
  assert.match(source, /const liveTail = \(sessionBusy \|\| streamState\.isStreaming\) && endIdx === messages\.length/);
});

test("an unfolded block keeps its own ref so the rail and search find it", () => {
  // The folded views are `attachRef: false` (the group wrapper carries the ref);
  // the blocks past the fold line carry their own.
  assert.match(source, /const attachRef = index >= foldCount;/);
  assert.match(source, /renderMessage\(processIdx, \{\s*attachRef,\s*keyPrefix: "process",/);
});

test("a running turn has one Edited files card, above the composer", () => {
  // The live card is the only file list while the agent works; the reply's own
  // card appears when the turn ends, so a finished turn shows exactly one.
  assert.match(source, /const liveWrittenFiles = useMemo\(/);
  assert.match(source, /if \(!sessionBusy && !streamState\.isStreaming\) return EMPTY_WRITTEN_FILES;/);
  assert.match(source, /<TurnWrittenFiles\s+files=\{liveWrittenFiles\}\s+defaultExpanded=\{false\}/);
  assert.match(source, /const writtenFiles = liveTail \? undefined : getTurnWrittenFiles\(/);
  // The card sits in the composer overlay, whose height the spacers already track.
  const composerIndex = source.indexOf("{chatInputElement}");
  const liveCardIndex = source.indexOf('className="chat-live-files"');
  assert.ok(liveCardIndex > 0 && liveCardIndex < composerIndex);
});
