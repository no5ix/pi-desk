/**
 * The mounted terminals' input fields, so a tap that opens the panel can put
 * the caret in one.
 *
 * iOS opens the software keyboard only for a focus that *moves to* an editable
 * field during the touch (upstream pi-web #1702): focusing a field that is
 * already focused fires no focus event, and Safari opens no keyboard. The
 * panel keeps its own field focused — when the PTY connects, when the tab
 * becomes active, after every keystroke — so a plain `focus()` on a tap is a
 * no-op on a phone. `focusTerminalInputFromTouch()` blurs the field first, so
 * the tap lands as a real focus change; that is what makes the keyboard appear.
 *
 * The registry (not a ref) exists because the panel is loaded lazily
 * (`components/LazyTerminalPanel.tsx`) while the panel toggle and the Explorer's
 * terminal action live in `components/AppShell.tsx`: the shell cannot hold a ref
 * into a component it imports as a `dynamic()`, and a plain module keeps the
 * import free of xterm.
 */
const fields = new Map<string, HTMLTextAreaElement>();

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
 * Move focus into a terminal's input field from a tap, so the phone's keyboard
 * opens with the panel. `tabId` selects the tab the tap is opening; without it
 * the most recently mounted field is used. A field the panel has not connected
 * yet is read-only (`disableStdin`), and iOS opens no keyboard for a read-only
 * field, so that case is declined rather than stealing focus.
 *
 * Returns whether a field took the focus.
 */
export function focusTerminalInputFromTouch(tabId?: string): boolean {
  const field = (tabId === undefined ? undefined : fields.get(tabId)) ?? latestField();
  if (!field || field.readOnly || !field.isConnected) return false;
  if (field.ownerDocument.activeElement === field) field.blur();
  field.focus();
  return true;
}
