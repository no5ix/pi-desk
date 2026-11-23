"use client";

import { useCallback, useId, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent } from "react";
import { useI18n } from "@/hooks/useI18n";

/**
 * The phone terminal's command line.
 *
 * A phone opens its keyboard for a tap on a field the browser renders as editable. The
 * terminal's own field is xterm's helper `textarea`: one cell wide, `readOnly` until the shell
 * connects, and moved by xterm to follow the cursor. iOS opens the keyboard only for a focus
 * that *moves* to such a field during the touch, and a tap that lands on a field which is
 * already focused opens nothing — which is the whole complaint: the panel focuses that field
 * when the shell connects, when the tab becomes active and after every keystroke, so tapping
 * the terminal a dozen times leaves a blinking cursor and no keyboard, while the first tap
 * after a **Restart** works because that field has never been focused.
 *
 * This row does not depend on that rule. It is a real, visible, always-editable `<input>`: the
 * tap focuses it for the first time, the keyboard comes up, and the Send button never takes the
 * focus (`onPointerDown` / `onMouseDown` are prevented), so the keyboard stays open for the next
 * command. `enterKeyHint="send"` makes the phone's own return key do what the button does, and
 * 16px is the font size Safari needs so focusing the field does not zoom the page.
 *
 * The terminal stays tappable for interactive programs (the extra-keys strip carries the
 * arrows, ESC, TAB and the CTRL / ALT latches); this row is the way in that never fails.
 */

const subscribeCoarsePointer = (callback: () => void) => {
  const coarse = window.matchMedia("(pointer: coarse)");
  coarse.addEventListener("change", callback);
  return () => coarse.removeEventListener("change", callback);
};

const getCoarsePointer = () => window.matchMedia("(pointer: coarse)").matches;

/** Whether this device types with an on-screen keyboard, so the row is worth its height. */
export function useTerminalComposerVisible(): boolean {
  return useSyncExternalStore(subscribeCoarsePointer, getCoarsePointer, () => false);
}

interface Props {
  /** Handled by the panel: the text goes to the shell as typed, plus Enter. False = not sent. */
  onSend: (text: string) => boolean;
}

export function TerminalComposer({ onSend }: Props) {
  const { t } = useI18n();
  const fieldId = useId();
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const send = useCallback(() => {
    const value = text;
    if (!value) {
      inputRef.current?.focus();
      return;
    }
    // The panel refuses a send while the shell is not there to take it. Keeping the text is
    // the honest answer: the command the user typed stays in the box for the next try.
    if (onSend(value)) setText("");
    inputRef.current?.focus();
  }, [onSend, text]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    send();
  };

  // A button that takes the focus closes the keyboard, so it never takes the focus.
  const keepFocus = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
  };

  return (
    <form className="terminal-composer" onSubmit={submit}>
      <label className="terminal-composer-label" htmlFor={fieldId}>
        {t("terminal.commandLabel")}
      </label>
      <input
        ref={inputRef}
        id={fieldId}
        type="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t("terminal.commandPlaceholder")}
        enterKeyHint="send"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
      />
      {/* Editable at every status, including "connecting": a phone opens no keyboard for a
          read-only field, and typing ahead is harmless — Send is what needs the shell, and the
          panel keeps the text when the shell is not there. */}
      <button
        type="submit"
        disabled={!text}
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onContextMenu={keepFocus}
      >
        {t("terminal.commandSend")}
      </button>
    </form>
  );
}
