import assert from "node:assert/strict";

/*
 * The settings dialog's appearance and disappearance, in the real app.
 *
 * The CSS half (the shared native modal keyframes, reduced motion) is measured by
 * e2e/settings-animation.mjs against a fixture. What a fixture cannot measure is the
 * owner's state machine: components/AppShell.tsx keeps the panel mounted for the exit,
 * and the exit is cancelled only by an open. A fixture that toggles `closing` by hand
 * passed while the shell's own effect cancelled every close the moment it started — the
 * section is still the one being closed for the whole exit — so the sheet snapped back
 * into its entrance: a dialog that would not close, with no animation to see.
 *
 * So this drives the shell: open, close, and the dialog must be gone.
 */

const geometry = () => {
  const backdrop = document.querySelector(".settings-dialog-backdrop");
  if (!backdrop) return { mounted: false, count: 0 };
  const surface = document.querySelector(".settings-dialog-surface");
  const bd = getComputedStyle(backdrop);
  const sf = getComputedStyle(surface);
  return {
    mounted: true,
    count: document.querySelectorAll(".settings-dialog-backdrop").length,
    class: backdrop.className,
    backdropAnimation: `${bd.animationName} ${bd.animationDuration} ${bd.animationFillMode}`,
    surfaceAnimation: `${sf.animationName} ${sf.animationDuration}`,
    backdropOpacity: Number(bd.opacity),
    surfaceOpacity: Number(sf.opacity),
    surfaceVisible: surface.getBoundingClientRect().height > 40,
  };
};

const openSettings = async (page) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.waitForSelector(".settings-dialog-surface");
};

export async function checkSettingsExit(page) {
  // Appears: the scrim and the sheet play the app's shared entrance.
  await openSettings(page);
  const opened = await page.evaluate(geometry);
  assert.ok(opened.mounted && opened.count === 1, `one dialog (count ${opened.count})`);
  assert.match(opened.backdropAnimation, /^native-backdrop-in /, `the scrim animates in (${opened.backdropAnimation})`);
  assert.match(opened.surfaceAnimation, /^native-modal-in /, `the sheet animates in (${opened.surfaceAnimation})`);
  assert.ok(opened.surfaceVisible && opened.surfaceOpacity === 1, "the sheet is fully in");

  // Disappears: the click starts the exit, and the dialog is gone once it has played.
  // Sampled across separate evaluations — a CSS timeline does not advance inside one.
  await page.locator(".settings-dialog-close").click();
  const starting = await page.evaluate(geometry);
  assert.ok(starting.mounted, "the panel stays mounted while the exit plays");
  assert.match(starting.class, /\bis-closing\b/, "the panel is told it is closing");
  assert.match(starting.backdropAnimation, /^native-backdrop-out /, `the scrim animates out (${starting.backdropAnimation})`);
  assert.match(starting.surfaceAnimation, /^native-modal-out /, `the sheet animates out (${starting.surfaceAnimation})`);
  const fading = await page.evaluate(geometry);
  assert.ok(fading.mounted, `the exit is not cut short (mounted mid-fade, opacity ${fading.backdropOpacity})`);
  assert.ok(fading.backdropOpacity < 1 || fading.surfaceOpacity < 1,
    `the dialog is mid-fade (scrim ${fading.backdropOpacity}, sheet ${fading.surfaceOpacity})`);
  await page.waitForSelector(".settings-dialog-backdrop", { state: "detached", timeout: 2000 });
  assert.equal((await page.evaluate(geometry)).count, 0, "the dialog is unmounted after the exit");

  // Escape is the same machine, and it leaves nothing behind.
  await openSettings(page);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".settings-dialog-backdrop", { state: "detached", timeout: 2000 });
  assert.equal((await page.evaluate(geometry)).count, 0, "Escape closes the dialog");

  // Opening during an exit cancels the exit and keeps the one panel: the shortcuts, the
  // sidebar, the composer's bare /mcp and the update reminder all open Settings.
  await openSettings(page);
  await page.locator(".settings-dialog-close").click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const reopened = await page.evaluate(geometry);
  assert.ok(reopened.mounted && reopened.count === 1, `the reopened dialog is the only one (count ${reopened.count})`);
  assert.ok(!/\bis-closing\b/.test(reopened.class), "the exit was cancelled, not left running");
  assert.ok(reopened.surfaceOpacity === 1 && reopened.surfaceVisible, "the sheet is open and readable");
  await page.locator(".settings-dialog-close").click();
  await page.waitForSelector(".settings-dialog-backdrop", { state: "detached", timeout: 2000 });
  assert.equal((await page.evaluate(geometry)).count, 0, "and it closes afterwards like any other time");

  console.log("settings dialog: in native-backdrop-in/native-modal-in, out with is-closing mid-fade to unmount, Escape too, an open during the exit cancels it and closes normally after");
}
