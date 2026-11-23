"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useI18n } from "@/hooks/useI18n";
import { FONT_CHANGE_EVENT } from "@/lib/font-preferences";
import { terminalTheme } from "@/lib/terminal-theme";
import { createTerminalWriter, terminalRequest } from "@/lib/terminal-client";
import {
  applyTerminalModifiers,
  NO_TERMINAL_MODIFIERS,
  terminalExtraKeySequence,
  type TerminalExtraKey,
  type TerminalModifier,
  type TerminalModifiers,
} from "@/lib/terminal-extra-keys";
import { macOptionSequence } from "@/lib/terminal-input";
import { isTouchFocusDevice, registerTerminalInputField } from "@/lib/terminal-focus";
import type { TerminalEvent } from "@/lib/terminal-manager";
import { TerminalComposer, useTerminalComposerVisible } from "./TerminalComposer";
import { TerminalExtraKeys, useTerminalExtraKeysVisible } from "./TerminalExtraKeys";
import type { TerminalTab } from "./terminal-tab-state";

interface Props {
  tab: TerminalTab;
  active: boolean;
  onRestart: () => void;
  onClosed: () => void;
  onCloseError: () => void;
}

// xterm measures cells in CSS pixels, so this is the glyph size the panel
// draws at. It shipped at 13, which the desktop users found too large: 9 is the
// same text 30% smaller (13 -> 9.1, kept whole so the canvas grid stays crisp).
// The family follows the app's mono choice; the size has no setting of its own.
const TERMINAL_FONT_SIZE = 9;
// xterm reads `macOptionIsMeta` only on macOS (its own Browser.isMac), so the
// Option chords added below are for the same machines: a Mac's keyboard and an
// iOS keyboard (iPadOS reports MacIntel). Windows and Linux keep Alt as Alt,
// where readline binds the modified CSI xterm already sends.
const APPLE_OPTION_IS_META = /^(?:Mac|iPhone|iPad|iPod)/.test(
  typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent,
);

export function TerminalPanel({ tab, active, onRestart, onClosed, onCloseError }: Props) {
  const { t } = useI18n();
  const { id, cwd, restored } = tab;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const startRef = useRef<Promise<void>>(Promise.resolve());
  const writerRef = useRef<ReturnType<typeof createTerminalWriter> | null>(null);
  const callbacksRef = useRef({ onClosed, onCloseError });
  callbacksRef.current = { onClosed, onCloseError };
  const [status, setStatus] = useState<"connecting" | "ready" | "exited" | "error">("connecting");
  const [error, setError] = useState<string | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  // F6: a phone held upright gets Termux-style extra keys; CTRL / ALT latch
  // for the next key, typed or tapped.
  const [modifiers, setModifiers] = useState<TerminalModifiers>(NO_TERMINAL_MODIFIERS);
  const modifiersRef = useRef(modifiers);
  // Whether the shell is there to take input, for the command line's Send: a send into a
  // terminal that has not connected would be dropped, and the row keeps the text instead.
  const connectedRef = useRef(false);
  const showExtraKeys = useTerminalExtraKeysVisible();
  const showComposer = useTerminalComposerVisible();

  const consumeModifiers = useCallback(() => {
    const current = modifiersRef.current;
    if (current.ctrl || current.alt) {
      modifiersRef.current = NO_TERMINAL_MODIFIERS;
      setModifiers(NO_TERMINAL_MODIFIERS);
    }
    return current;
  }, []);
  const sendExtraKey = (key: TerminalExtraKey) => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const sequence = terminalExtraKeySequence(key, consumeModifiers(), terminal.modes.applicationCursorKeysMode);
    terminal.input(sequence, true);
  };
  /**
   * The command line's Send: the text as typed, then Enter. Returns whether the shell took it,
   * so the row can keep a command typed while the shell was still connecting. A latched CTRL /
   * ALT applies to a single character — latching CTRL and sending "c" is `^C` — and a whole line
   * goes out as typed, which is what a command line means.
   */
  const sendComposerText = useCallback((text: string) => {
    const terminal = terminalRef.current;
    if (!terminal || !connectedRef.current) return false;
    terminal.input(applyTerminalModifiers(text, consumeModifiers()), true);
    terminal.input("\n", true);
    return true;
  }, [consumeModifiers]);
  const toggleModifier = (modifier: TerminalModifier) => {
    const next = { ...modifiersRef.current, [modifier]: !modifiersRef.current[modifier] };
    modifiersRef.current = next;
    setModifiers(next);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let events: EventSource | null = null;
    let offset: number | undefined;
    let connected = false;
    // The command line asks this before sending, from outside the effect's closure.
    const setConnected = (value: boolean) => {
      connected = value;
      connectedRef.current = value;
    };
    let exited = false;
    let inputFailed = false;
    setStatus("connecting");
    setError(null);
    setExitCode(null);

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: getComputedStyle(container).getPropertyValue("--font-mono").trim() || "monospace",
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: 1.25,
      // macOS: Option is Meta, like Terminal.app's "Use Option as Meta key".
      // Left off, the browser hands xterm the accented character for the chord
      // (Option+E is "´", Option+R is "®") and it reaches the shell as that
      // text, so fzf's Option+E / Option+R and readline's Option+F / Option+B
      // word jumps never fire. xterm only reads this on macOS, so Windows and
      // Linux keep sending Alt as Alt; the phone's ALT latch is unaffected.
      // xterm's own translation covers part of the chord set — the handler below
      // completes it from `key` and `code`.
      macOptionIsMeta: true,
      scrollback: 8000,
      screenReaderMode: true,
      disableStdin: true,
      minimumContrastRatio: 4.5,
      theme: terminalTheme(container),
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    // iOS opens the software keyboard only for a focus raised by a touch: xterm focuses on
    // `mousedown`, which iOS synthesizes after the tap, so tapping the panel on a phone left a
    // blinking cursor and no keyboard (upstream pi-web #1702). Two of Safari's rules decide this
    // whole flow, and the second is why an earlier fix — blur, then focus, in one handler — did
    // not work:
    //  - The focus must *move*. The panel focuses the field on connect, on tab activation and
    //    after a keystroke, so by the time a finger lands the field is already the active
    //    element and `focus()` fires no focus event: no keyboard, however many taps. Restarting
    //    the terminal builds a fresh, never-focused field, and its first tap opens the keyboard
    //    — the clue that named the cause. So on a touch device the panel never focuses the field
    //    by itself (`isTouchFocusDevice` in lib/terminal-focus.ts).
    //  - Blur and focus inside one gesture read as no net change. So the tap releases the field
    //    when the finger lands and focuses it when the finger lifts: two gestures, and the lift
    //    is a focus that moves from the page into the field.
    // The field is xterm's helper textarea — writable from the moment the session connects
    // (xterm mirrors its `readOnly` on `disableStdin`, which is why a tap while the panel still
    // says "connecting" cannot raise a keyboard), and app/native-theme.css gives it the opacity
    // and the 16px Safari needs to treat it as a field on screen. The command line
    // (`TerminalComposer`) is the way in that depends on none of this.
    let raisedOnLift = false;
    const isTouchPointer = (event: PointerEvent | TouchEvent) =>
      !(event instanceof PointerEvent) || event.pointerType === "touch";
    const releaseOnTouch = (event: PointerEvent | TouchEvent) => {
      if (!isTouchPointer(event)) return;
      raisedOnLift = false;
      // A finger on the terminal: the field lets go, so the lift is a focus change.
      const field = terminal.textarea;
      if (field && field.ownerDocument.activeElement === field) field.blur();
    };
    const raiseOnTouch = (event: PointerEvent | TouchEvent, fromLift: boolean) => {
      if (!isTouchPointer(event)) return;
      if (fromLift) raisedOnLift = true;
      // A browser that fires `pointerup` after `touchend` would focus twice; the pointer's lift
      // stands down when the touch's lift already raised the keyboard.
      else if (raisedOnLift) { raisedOnLift = false; return; }
      terminal.focus();
    };
    const liftFromTouch = (event: TouchEvent) => raiseOnTouch(event, true);
    const liftFromPointer = (event: PointerEvent) => raiseOnTouch(event, false);
    container.addEventListener("pointerdown", releaseOnTouch, true);
    container.addEventListener("touchstart", releaseOnTouch, true);
    container.addEventListener("touchend", liftFromTouch, true);
    container.addEventListener("pointerup", liftFromPointer, true);
    // The panel toggle and the Explorer's terminal action raise the phone's
    // keyboard from the tap that opens the panel (see lib/terminal-focus.ts).
    registerTerminalInputField(id, terminal.textarea ?? null);
    // Update the existing renderer, never restart the PTY on a theme change.
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = terminalTheme(container);
    });
    themeObserver.observe(document.documentElement, { attributes: true });
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "v") return false;
      if ((event.ctrlKey || event.metaKey) && key === "c" && terminal.hasSelection()) return false;
      // xterm's Meta path translates from the legacy `keyCode`, in the `default:`
      // arm of that switch, so a printable chord works (Option+R is "®" with
      // `keyCode` 82, and the PTY gets `^[r`) while the rest does not: a dead-key
      // chord (Option+E is "Dead" on a Portuguese layout) leaves its accent for
      // the keypress path, and the arrows — handled in their own cases, above the
      // Alt branch — go out as the modified CSI `ESC [ 1 ; 3 D`, which no macOS
      // shell binds. Fill exactly that gap, and only for a keystroke inside the
      // terminal: the composer keeps typing its accents.
      if (APPLE_OPTION_IS_META && event.altKey && container.contains(event.target as Node | null)) {
        const chord = macOptionSequence(event);
        if (chord) {
          // Cancelling the keydown is what keeps the browser from composing the
          // accent behind our back: the dead key would land in the shell as `´`.
          event.preventDefault();
          event.stopPropagation();
          terminal.input(chord, true);
          return false;
        }
      }
      return true;
    });

    const writer = createTerminalWriter(id, (reason) => {
      if (disposed) return;
      inputFailed = true;
      terminal.options.disableStdin = true;
      setError(reason.message);
      setStatus("error");
    });
    writerRef.current = writer;
    const onData = terminal.onData((data) => {
      if (connected && !exited && !inputFailed) writer.write(applyTerminalModifiers(data, consumeModifiers()));
    });
    const fitAndResize = () => {
      if (!container.offsetWidth || !container.offsetHeight) return;
      fit.fit();
    };
    // Changing a family must update xterm's measured cells without replacing
    // the terminal, reconnecting its session or losing its scrollback.
    let fontFrame = 0;
    const updateFont = () => {
      if (disposed) return;
      terminal.options.fontFamily = getComputedStyle(container).getPropertyValue("--font-mono").trim() || "monospace";
      cancelAnimationFrame(fontFrame);
      fontFrame = requestAnimationFrame(fitAndResize);
    };
    window.addEventListener(FONT_CHANGE_EVENT, updateFont);
    document.fonts.addEventListener("loadingdone", updateFont);
    const onResize = terminal.onResize(({ cols, rows }) => {
      if (connected && !exited && !inputFailed) writer.resize(cols, rows);
    });
    const resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(container);

    const connect = () => {
      if (disposed || exited || !navigator.onLine) return;
      events?.close();
      events = new EventSource(`/api/terminal/${encodeURIComponent(id)}/events${offset === undefined ? "" : `?after=${offset}`}`);
      events.onmessage = (message) => {
        // The stream is delivering, so the shell is there to take input. WebKit
        // gives no guarantee that EventSource's `open` fires, and xterm mirrors
        // `disableStdin` onto its helper field's `readOnly` — a read-only field
        // opens no keyboard on iOS — so the first message opens input too.
        setConnected(true);
        if (!exited && !inputFailed) terminal.options.disableStdin = false;
        const event = JSON.parse(message.data) as TerminalEvent;
        if (event.type === "output") {
          if (event.reset) terminal.reset();
          else if (offset !== undefined && event.offset <= offset) return;
          terminal.write(event.data);
          offset = event.offset;
        } else {
          exited = true;
          setConnected(false);
          terminal.options.disableStdin = true;
          events?.close();
          setExitCode(event.type === "exit" ? event.exitCode : null);
          setStatus("exited");
        }
      };
      events.onopen = () => {
        setConnected(true);
        if (inputFailed) return;
        terminal.options.disableStdin = false;
        setStatus("ready");
        fitAndResize();
        writer.resize(terminal.cols, terminal.rows);
        // A phone gets no focus here: focusing the field on connect leaves it the active
        // element, and every later tap is then a focus that does not move — no keyboard, the
        // reported bug. The tap raises the keyboard itself, and the command line is always there.
        if (container.offsetWidth && container.offsetHeight && !isTouchFocusDevice()) terminal.focus();
      };
      events.onerror = () => {
        if (disposed || exited) return;
        setConnected(false);
        terminal.options.disableStdin = true;
        setStatus(events?.readyState === EventSource.CLOSED ? "error" : "connecting");
      };
    };

    startRef.current = (async () => {
      fitAndResize();
      if (restored && reconnectKey === 0) {
        // Restoring a tab must never silently launch a replacement shell.
        await terminalRequest(`/api/terminal/${encodeURIComponent(id)}`);
      } else {
        await terminalRequest("/api/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, cwd, cols: terminal.cols, rows: terminal.rows }),
        });
      }
      connect();
    })().catch((reason: Error) => {
      if (disposed) return;
      setError(reason.message);
      setStatus("error");
    });

    const pageHide = () => {
      setConnected(false);
      terminal.options.disableStdin = true;
      events?.close();
      if (!exited && !inputFailed) setStatus("connecting");
    };
    const pageShow = (event: PageTransitionEvent) => { if (event.persisted) connect(); };
    window.addEventListener("pagehide", pageHide);
    window.addEventListener("pageshow", pageShow);
    window.addEventListener("offline", pageHide);
    window.addEventListener("online", connect);
    return () => {
      disposed = true;
      events?.close();
      void writer.stop();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      registerTerminalInputField(id, null);
      container.removeEventListener("pointerdown", releaseOnTouch, true);
      container.removeEventListener("touchstart", releaseOnTouch, true);
      container.removeEventListener("touchend", liftFromTouch, true);
      container.removeEventListener("pointerup", liftFromPointer, true);
      cancelAnimationFrame(fontFrame);
      window.removeEventListener(FONT_CHANGE_EVENT, updateFont);
      document.fonts.removeEventListener("loadingdone", updateFont);
      onData.dispose();
      onResize.dispose();
      window.removeEventListener("pagehide", pageHide);
      window.removeEventListener("pageshow", pageShow);
      window.removeEventListener("offline", pageHide);
      window.removeEventListener("online", connect);
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [id, cwd, restored, reconnectKey, consumeModifiers]);

  useEffect(() => {
    // A phone keeps the field unfocused, so the tap that opens the keyboard is a real focus
    // move (see the touch handlers above and lib/terminal-focus.ts).
    if (active && !isTouchFocusDevice()) terminalRef.current?.focus();
  }, [active]);

  useEffect(() => {
    if (!tab.closing) return;
    let cancelled = false;
    if (terminalRef.current) terminalRef.current.options.disableStdin = true;
    void (async () => {
      await startRef.current;
      await writerRef.current?.stop();
      await terminalRequest(`/api/terminal/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
      if (!cancelled) callbacksRef.current.onClosed();
    })().catch((reason: Error) => {
      if (cancelled) return;
      setError(reason.message);
      setStatus("error");
      callbacksRef.current.onCloseError();
    });
    return () => { cancelled = true; };
  }, [id, tab.closing]);

  return (
    <section className="terminal-panel" aria-label={t("terminal.title")}>
      <header className="terminal-panel-header">
        <div className="terminal-panel-path">
          <span className={`terminal-status-dot is-${status}`} title={t(`terminal.${status}`)} />
          <span title={cwd}>{cwd}</span>
        </div>
        {status === "error" && (
          <button type="button" onClick={() => setReconnectKey((key) => key + 1)} disabled={Boolean(tab.closing)} title={t("terminal.reconnect")} aria-label={t("terminal.reconnect")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2" />
            </svg>
          </button>
        )}
        <button type="button" onClick={onRestart} disabled={Boolean(tab.closing)} title={t("terminal.restart")} aria-label={t("terminal.restart")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 1 0-2.34 5.66" /><polyline points="20 4 20 11 13 11" />
          </svg>
        </button>
      </header>
      <div>
        {error && <div className="terminal-panel-error" role="alert">{error}</div>}
        {status === "exited" && <div className="terminal-panel-exit" role="status">{exitCode === null ? t("terminal.exited") : t("terminal.exitCode", { code: exitCode })}</div>}
      </div>
      <div className="terminal-xterm"><div ref={containerRef} className="terminal-xterm-host" /></div>
      {showComposer && <TerminalComposer onSend={sendComposerText} />}
      {showExtraKeys && <TerminalExtraKeys modifiers={modifiers} onKey={sendExtraKey} onToggleModifier={toggleModifier} />}
    </section>
  );
}
