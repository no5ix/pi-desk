/**
 * The terminals' input fields, and the rules that decide when a phone's keyboard opens.
 *
 * Three Safari/iOS rules, learned the hard way from the report "tapping the terminal never
 * opens the keyboard, and the first tap after a Restart does":
 *  1. The keyboard opens for a focus that **moves** to an editable field during a user
 *     gesture (upstream pi-web #1702). Focusing a field that is already the active element
 *     fires no focus event and opens nothing — so a panel that focuses its own field (on
 *     connect, on tab activation) makes every later tap a no-op, while the fresh field of a
 *     restarted terminal opens the keyboard on its first tap.
 *  2. Blur and focus **inside one gesture** read as no net change. Blur-then-focus in a single
 *     handler — the first fix for this bug — therefore did nothing.
 *  3. A **read-only** field opens no keyboard. xterm mirrors `disableStdin` onto its helper
 *     textarea, so the field is read-only until the shell connects: taps on a panel that says
 *     "connecting" cannot raise a keyboard, however they are dispatched.
 *
 * What follows, each in its own place: on a touch device the panel never focuses the field by
 * itself (`isTouchFocusDevice()`); a tap inside the terminal releases the field on finger-down
 * and focuses it on finger-up — two gestures, so the lift is a real focus move
 * (`components/TerminalPanel.tsx`); and the terminal grows a visible, always-editable command
 * line that depends on none of this (`components/TerminalComposer.tsx`).
 *
 * The registry (not a ref) exists because the panel is loaded lazily
 * (`components/LazyTerminalPanel.tsx`) while the panel toggle and the Explorer's terminal
 * action live in `components/AppShell.tsx`: the shell cannot hold a ref into a component it
 * imports as a `dynamic()`, and a plain module keeps the import free of xterm.
 */
const fields = new Map<string, HTMLTextAreaElement>();

/**
 * A device whose typing happens with an on-screen keyboard (a phone, a tablet, a laptop in
 * tablet mode). Two things follow, and both are about the *terminal's* hidden helper field:
 * the browser opens its keyboard only for a focus that **moves** to an editable field during
 * a gesture, and it opens nothing at all for a field that is already the active element. So a
 * panel that focuses the field by itself — when the shell connects, when the tab becomes
 * active — leaves every later tap a no-op: the cursor blinks and no keyboard appears, while
 * the first tap on a freshly restarted terminal (never focused) opens one. On these devices
 * the panel must not focus the terminal field on its own; it raises the keyboard from the tap
 * (`components/TerminalPanel.tsx`) and from the always-editable command line
 * (`components/TerminalComposer.tsx`).
 */
export function isTouchFocusDevice(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

/** Publish (or with `null`, retire) one tab's input field. */
export function registerTerminalInputField(id: string, field: HTMLTextAreaElement | null): void {
  if (field) fields.set(id, field);
  else fields.delete(id);
}

/** The most recently mounted field, which is the tab the panel shows. */
function latestField(): HTMLTextAreaElement | undefined {
  let field: HTMLTextAreaElement | undefined;
  for (const value of fields.values()) field = value;
  return field;
}

/**
 * Move focus into a terminal's input field from a tap on the panel toggle or the Explorer's
 * terminal action, for the pointers where that puts the caret where the user is about to type.
 *
 * On a touch device it deliberately does nothing. The toggle is one gesture, and iOS opens a
 * keyboard only for a focus that moves during the touch: the field this would focus is usually
 * still `readOnly` (the shell is connecting, so no keyboard opens), and leaving it the active
 * element without a keyboard is exactly the state that swallows every tap that follows — a tap
 * lands on a field that is already focused, the focus does not move, nothing opens. The panel
 * raises the keyboard from the taps inside it (release on finger-down, focus on finger-up, in
 * `components/TerminalPanel.tsx`) and from the always-editable command line
 * (`components/TerminalComposer.tsx`).
 *
 * `tabId` selects the tab the tap is opening; without it the most recently mounted field is
 * used. A field the panel has not connected yet is read-only (`disableStdin`) and iOS opens no
 * keyboard for a read-only field, so that case is declined rather than stealing focus.
 *
 * Returns whether a field took the focus.
 */
export function focusTerminalInputFromTouch(tabId?: string): boolean {
  if (isTouchFocusDevice()) return false;
  const field = (tabId === undefined ? undefined : fields.get(tabId)) ?? latestField();
  if (!field || field.readOnly || !field.isConnected) return false;
  if (field.ownerDocument.activeElement === field) field.blur();
  field.focus();
  return true;
}
