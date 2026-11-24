import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The composer's mirror, read back from the server, must never eat the composer.
 *
 * The feature is "the prompt typed on the laptop appears on the phone". The bug it
 * produced was the reverse: a copy arriving from the server repainted the composer
 * the user was typing in, and their text and attachments were gone — seen at the end
 * of a run, with no reload and no send of the draft, because the server's copy was
 * the composer's own content minus the screenshots the size guards had dropped, and
 * then the empty snapshot a send leaves behind. `lib/composer-sync.test.mjs` and
 * `app/api/composer-draft/route.test.mjs` pin the server and the client's writes;
 * this pins what the composer accepts.
 */

const chatInput = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("a copy from the other devices is painted only when the composer can take it", () => {
  const watch = chatInput.match(/return watchComposerDraft\(draftKey, \(remote\) => \{[\s\S]*?\n    \}\);/);
  assert.ok(watch, "the composer listens for the other devices' copies");
  const body = watch[0];
  assert.match(body, /if \(remote\.updatedAt <= composerSyncStampRef\.current\) return;/, "its own echo is dropped");
  assert.match(body, /const remoteSignature = draftSignature\(remote\.value, nextImages\.map\(imageToDraftImage\), nextFiles\);/);
  assert.match(body, /const localSignature = draftSignature\(\s*valueRef\.current,\s*attachedImagesRef\.current\.map\(imageToDraftImage\),\s*attachedFilesRef\.current,\s*\);/,
    "the composer's own content is measured, attachments included");
  assert.match(body, /if \(remoteSignature === localSignature\) \{[\s\S]*?return;\s*\}/,
    "content the composer already shows is not repainted (no revoked image previews)");
  assert.match(body, /if \(remoteSignature === BLANK_DRAFT_SIGNATURE && localSignature !== BLANK_DRAFT_SIGNATURE\) \{[\s\S]*?return;\s*\}/,
    "an empty copy never lands on a composer that has a prompt in it");
  const blankGuard = body.indexOf("if (remoteSignature === BLANK_DRAFT_SIGNATURE");
  const accepted = body.indexOf("composerSyncStampRef.current = remote.updatedAt;\n      const nextValue");
  assert.ok(blankGuard > 0 && accepted > blankGuard,
    "the stamp moves only for a copy the composer accepts, so a refused copy stays refused");
  assert.match(chatInput, /const BLANK_DRAFT_SIGNATURE = draftSignature\("", \[\], \[\]\);/);
});

test("the composer's mirror writes only what this device changed", () => {
  // The echo guard the mirror depends on: what the composer loaded on mount, or after a
  // key change, is not this device's edit, so it is never pushed back.
  assert.match(chatInput, /if \(syncedSignatureRef\.current === signature\) return;\s*\n\s*syncedSignatureRef\.current = signature;\s*\n\s*composerSyncStampRef\.current = pushComposerDraft\(draftKey, draft\);/,
    "a push happens on a real change, and its stamp is remembered");
  assert.match(chatInput, /syncedSignatureRef\.current = draftSignature\(nextValue, nextImages\.map\(imageToDraftImage\), nextFiles\);\s*\n\s*composerSyncStampRef\.current = 0;/,
    "a loaded draft is not this device's write");
  assert.match(chatInput, /if \(draftKey\) clearComposerDraft\(draftKey\);/,
    "a sent prompt leaves the mirror too, so the other device does not refill");
});
