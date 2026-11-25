/**
 * The caret the phone's keyboard is supposed to come with.
 *
 * WebKit paints a caret for a focus raised *by the finger*, at the field's place
 * in the layout. Two of the composer's phone habits defeat that: a composer the
 * page focused first (a restored draft, a history pick, an extension dialog's
 * field) is already `document.activeElement` when the finger arrives, and a tap on
 * a field WebKit counts as focused is not a focus event at all; and the keyboard
 * lifts the whole app a few hundred pixels right after the focus, so the caret is
 * painted at a place the field no longer occupies. Either way the keyboard slides
 * up with no caret in the box, which reads as a broken editor.
 *
 * Both are fixed inside the browser's own rules: focus and set the selection
 * during the gesture, and set it again once the lift has landed. A selection
 * change is what makes WebKit paint the caret.
 */

/** The pointer types whose tap is a real gesture for the on-screen keyboard. */
export function isTouchPointer(event: { pointerType?: string } | undefined): boolean {
  return event?.pointerType === "touch" || event?.pointerType === "pen";
}

interface CaretTarget {
  focus: () => void;
  value: string;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange: (start: number, end: number) => void;
}

/**
 * Focus `element` and put the caret at the end of its text, in the caller's pointer
 * gesture. Returns whether anything was armed. A field that refuses a selection
 * (a type with no selectable text) keeps the focus, which is all it can take.
 */
export function armComposerCaret(element: CaretTarget | null | undefined): boolean {
  if (!element) return false;
  element.focus();
  const end = element.value.length;
  try {
    element.setSelectionRange(end, end);
  } catch {
    // The focus is the whole remedy for a field with no selectable text.
  }
  return true;
}

/**
 * Ask the engine to paint the caret where it already is: set the selection to
 * itself. This is the call that recovers it after the keyboard's lift moved the
 * field out from under the caret WebKit drew.
 */
export function repaintComposerCaret(element: CaretTarget | null | undefined): boolean {
  if (!element) return false;
  if (typeof document !== "undefined" && document.activeElement !== (element as unknown as Element)) return false;
  try {
    element.setSelectionRange(element.selectionStart, element.selectionEnd);
  } catch {
    return false;
  }
  return true;
}

/**
 * When to repaint after the keyboard opened, in milliseconds.
 *
 * `hooks/useViewportHeight.ts` re-reads the visual viewport through the keyboard's
 * own slide (its settle chain ends at 720ms) and the app's height — the column the
 * composer sits at the end of — follows every reading. A caret painted before the
 * travel has landed is painted at a place the composer leaves, so the repaint is
 * scheduled at the end of the window, and once more after it for an engine that
 * settles late.
 */
export const CARET_REPAINT_DELAYS_MS = [240, 480, 820] as const;
