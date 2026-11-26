// Fork-owned: the composer text area's own height. The card grows with the prompt, and the
// growth is a CSS transition (app/native-theme.css), so the height is written in a way a
// transition can follow: measure without painting, then write one px -> px change.

/** The composer text area's ceiling; past it the text scrolls inside the card. */
export const COMPOSER_TEXTAREA_MAX_HEIGHT = 200;

/** The fork's motion rule, asked of the browser: a reduced-motion reader gets the height
 *  jumps back (the card's and the text's own transitions are switched off in CSS), and a
 *  caller that animates a box by hand has to skip its own pin-and-write the same way. */
export function prefersReducedMotion(): boolean {
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

/** The composer's resting line box, when the element's own `line-height` is unreadable. */
const FALLBACK_LINE_RATIO = 1.4;

/**
 * How many lines the prompt takes, measured the same way {@link measureComposerTextarea}
 * measures its height.
 *
 * The card is one row while the prompt fits on a line, and the text takes its own row (and
 * the composer's expand corner arrives with the line past three) once it wraps
 * (components/ChatInput.tsx). Counting `\n` is not enough — a long sentence *wraps*, and a
 * wrapped sentence must raise the corner just like a typed newline. So the answer comes from
 * the box: the element is released from every height bound it carries — the inline height
 * the autosize wrote, the card's `min-height`/`max-height` in the expanded editor, all of
 * them written back as `!important` inline declarations, the only thing that beats a
 * stylesheet `!important` — `scrollHeight` is read, and the element is restored. Nothing
 * yields to the browser between the write and the restore, so no frame is ever painted
 * released.
 *
 * The width is pinned while it is read, to the width the text has in the card's ONE row
 * (`--composer-text-row-width`, app/native-theme.css). That is what keeps the layout and the
 * measurement from feeding each other: the stacked card gives the text the card's whole
 * width, so a count taken at the current width would drop to one line the moment the card
 * stacked, un-stack it, wrap again, and loop. Read at one fixed width, the answer describes
 * the prompt, not the card that is showing it.
 */
export function measureComposerTextLines(textarea: HTMLTextAreaElement): number {
  const style = textarea.style;
  // The CSS property names, not the camelCase ones: `getPropertyValue`/`removeProperty`
  // speak CSS, and a camelCase name reads back empty — which would leave the released box
  // behind, and the expanded editor with no height of its own.
  const properties = [
    "height", "min-height", "max-height",
    "width", "flex", "margin", "order", "box-sizing",
  ] as const;
  const saved = properties.map((property) => ({
    property,
    value: style.getPropertyValue(property),
    priority: style.getPropertyPriority(property),
  }));
  style.setProperty("height", "auto", "important");
  style.setProperty("min-height", "0px", "important");
  style.setProperty("max-height", "none", "important");
  style.setProperty("width", "var(--composer-text-row-width, 100%)", "important");
  // `flex: 1 1 auto` would grow the item back to the row's free space, and the stacked row
  // gives it a whole line and an `order` of its own; the pinned width is only the used width
  // when the item stops taking space from the row.
  style.setProperty("flex", "0 0 auto", "important");
  style.setProperty("margin", "0", "important");
  style.setProperty("order", "0", "important");
  style.setProperty("box-sizing", "border-box", "important");
  const content = textarea.scrollHeight;
  const computed =
    typeof window !== "undefined" ? window.getComputedStyle(textarea) : null;
  const lineHeight = Number.parseFloat(computed?.lineHeight ?? "") || 0;
  const fontSize = Number.parseFloat(computed?.fontSize ?? "") || 14;
  const paddingTop = Number.parseFloat(computed?.paddingTop ?? "") || 0;
  const paddingBottom = Number.parseFloat(computed?.paddingBottom ?? "") || 0;
  for (const { property, value, priority } of saved) {
    if (value) style.setProperty(property, value, priority);
    else style.removeProperty(property);
  }
  const line = lineHeight > 0 ? lineHeight : fontSize * FALLBACK_LINE_RATIO;
  // The box's own vertical padding is not text, and `scrollHeight` counts it. The count
  // subtracts it exactly (the element's computed padding, not a guessed allowance), so
  // no padding rule can raise the composer's corner: the corner that opens the tall
  // editor used to reserve a band of `padding-top` for its own glyph, and a one-line
  // prompt measured as two lines — the corner stayed over a resting card and refused to
  // leave when the card was folded ("there's only one line, the expansion icon should
  // disappear"). One line is one line-height, and rounding keeps a subpixel line box
  // from reading as a second one.
  const text = Math.max(0, content - paddingTop - paddingBottom);
  return Math.max(1, Math.round(text / line));
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
