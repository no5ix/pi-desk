// Fork-owned: the composer text area's own height. The card grows with the prompt, and the
// growth is a CSS transition (app/native-theme.css), so the height is written in a way a
// transition can follow: measure without painting, then write one px -> px change.

/** The composer text area's ceiling; past it the text scrolls inside the card. */
export const COMPOSER_TEXTAREA_MAX_HEIGHT = 200;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The prompt's natural height, in px, capped by {@link COMPOSER_TEXTAREA_MAX_HEIGHT}.
 *
 * A textarea keeps the height it was given, so measuring needs the `height: auto` step.
 * That step is undone before returning: the element is left at the height it had, so no
 * frame is ever painted with `auto` in it. That is the whole point — `auto` is not an
 * animatable length, so a caller that leaves the element at `auto` and then writes a px
 * height gets a jump, and the card's growth is a jump (the user asked for the card to
 * *turn smoothly* into the tall composer).
 */
export function measureComposerTextarea(textarea: HTMLTextAreaElement): number {
  const previous = textarea.style.height;
  textarea.style.height = "auto";
  const height = Math.min(textarea.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT);
  textarea.style.height = previous;
  return height;
}

/**
 * Set the composer text area to the prompt's natural height, in one animatable step.
 *
 * The measured height is written on the next frame, so the browser starts the transition
 * from the height it has already painted and the write is px -> px: the card grows and
 * shrinks over `--dur-base` (app/native-theme.css), and one line deletes back to a
 * single-row card the same way. `window.scrollY` is kept where it was (the composer is
 * the page's last box, and the keyboard's scroll-into-view runs after this).
 */
export function growComposerTextarea(
  textarea: HTMLTextAreaElement | null,
  { animate = true }: { animate?: boolean } = {},
): void {
  if (!textarea) return;
  const target = `${measureComposerTextarea(textarea)}px`;
  if (!animate || prefersReducedMotion()) {
    textarea.style.height = target;
    return;
  }
  if (textarea.style.height === target) return;
  if (typeof requestAnimationFrame !== "function") {
    textarea.style.height = target;
    return;
  }
  requestAnimationFrame(() => {
    // The prompt changed while the frame was in flight (a fast typist, a paste, a
    // draft restored): the newest write owns the height.
    if (textarea.style.height !== target) textarea.style.height = target;
  });
}
