import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * The composer keeps its own copy and reads the other devices' as a list.
 *
 * The mirror this replaced wrote every device into one shared draft and painted
 * the composer from it on a 4s poll. That is the failure class pinned here, in
 * its opposite shape: a copy that arrives from the server must never reach the
 * composer's state, only the row list; the composer writes exactly one record
 * (its own device's), and sending clears exactly that one. The mirror's own
 * files are asserted absent, because a merge that restores them would restore
 * the whole hazard with them.
 */

const chatInput = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("the composer's mirror is gone, and with it the shared draft it wrote", () => {
  for (const gone of [
    "../lib/composer-sync.ts",
    "../lib/composer-draft-store.ts",
    "../lib/composer-sync.test.mjs",
    "./ChatInput.composer-sync.test.mjs",
    "app/api/composer-draft/route.ts",
  ]) {
    assert.equal(existsSync(new URL(gone, import.meta.url)), false, `${gone} stays removed`);
  }
  assert.doesNotMatch(chatInput, /composer-sync|composer-draft|pushComposerDraft|watchComposerDraft|clearComposerDraft|composerSyncKey|composerSyncStampRef|syncedSignatureRef|BLANK_DRAFT_SIGNATURE/,
    "the composer imports none of it");
});

test("a copy that arrives from the server never touches the composer", () => {
  const watch = chatInput.match(/useEffect\(\(\) => \{\s*if \(!draftKey\) \{\s*setDeviceCopies\(\[\]\);\s*return;\s*\}\s*return watchDeviceCopies\(draftKey, setDeviceCopies\);\s*\}, \[draftKey\]\);/);
  assert.ok(watch, "the composer watches the other devices' copies, and hands them to the list alone");
  assert.doesNotMatch(watch[0], /setValue\(|setAttachedImages\(|setAttachedFiles\(|setDraft\(/,
    "a copy cannot repaint the composer — that is how a prompt and its attachments used to vanish");
});

test("the composer writes only its own device's copy", () => {
  assert.match(chatInput, /import \{ clearDeviceCopy, pushDeviceCopy, watchDeviceCopies \} from "@\/lib\/composer-copies";/);
  const mirror = chatInput.match(/const mirror = [\s\S]*?\n  \}, \[attachedFiles, attachedImages, draftKey, value\]\);/)
    ?? chatInput.match(/const draft = \{\s*value,[\s\S]*?\n  \}, \[attachedFiles, attachedImages, draftKey, value\]\);/);
  assert.ok(mirror, "typing is mirrored on every change");
  assert.match(mirror[0], /setDraft\(draftKey, draft\);\s*\/\/[\s\S]*?pushDeviceCopy\(draftKey, draft\);/,
    "the local draft and this device's copy are written together");
  assert.doesNotMatch(mirror[0], /syncedSignature|composerSyncStamp/, "no echo guard: this device owns the record it writes");
  assert.match(chatInput, /if \(draftKey\) clearDeviceCopy\(draftKey\);/, "sending clears this device's copy");
  assert.doesNotMatch(chatInput, /deleteDeviceCopy\(/, "the composer never deletes a copy by device id — only its own, by being itself");
});

test("picking a copy up prepends it, attachments included, and leaves the row", () => {
  const apply = chatInput.match(/const applyDeviceCopy = useCallback\(\(copy: ComposerDeviceCopy\) => \{[\s\S]*?\n  \}, \[setHashQuery\]\);/);
  assert.ok(apply, "the composer has one handler for a copy the user picked");
  const body = apply[0];
  assert.match(body, /mergeRestoredSubmissionDraft\(\s*copy\.value,\s*copy\.images,\s*valueRef\.current,\s*attachedImagesRef\.current\.map\(imageToDraftImage\),\s*copy\.files,\s*attachedFilesRef\.current,\s*\)/,
    "the copy goes before what is typed here, and its attachments join this composer's");
  assert.match(body, /setValue\(merged\.value\);/);
  assert.match(body, /setAttachedFiles\(nextFiles\);/);
  assert.match(body, /setAttachedImages\(\(prev\) => \{\s*prev\.forEach\(revokeImagePreview\);\s*return nextImages;\s*\}\);/,
    "the previews are swapped, not left dangling");
  assert.match(body, /setDraft\(draftKeyRef\.current, \{[\s\S]*?images: nextImages\.map\(imageToDraftImage\),[\s\S]*?\}\);/,
    "what was picked up lands in this device's draft, so a reload keeps it");
  assert.doesNotMatch(body, /clearDeviceCopy|pushDeviceCopy\(copy/, "the row stays: the copy belongs to the device that typed it");
});

test("the copy rows dock above the composer, over the outbox", () => {
  const copiesAt = chatInput.indexOf("<ComposerDeviceCopies copies={deviceCopies} onUse={applyDeviceCopy} />");
  const outboxAt = chatInput.indexOf("<ComposerOutbox items={queuedMessages?.pending ?? []} onAction={onQueuedMessageAction} />");
  assert.ok(copiesAt > 0 && outboxAt > copiesAt, "the rows stack in one dock, copies first");
  const css = readFileSync(new URL("../app/native-theme.css", import.meta.url), "utf8");
  assert.match(css, /\.composer-device-copies \+ \.composer-outbox \{/, "two docks in a row join into one panel");
  assert.match(css, /\.composer-copy-text \{ min-width: 0; overflow: hidden; text-overflow: ellipsis;/, "a long copy is ellipsised, as a queued row's text is");
});
