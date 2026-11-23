export interface TerminalKeyEventLike {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const SPECIAL_KEY_SEQUENCES: Record<string, string> = {
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Escape: "\x1b",
  Backspace: "\x7f",
};

const ALT_ARROW_SEQUENCES: Record<string, string> = {
  ArrowLeft: "\x1bb",
  ArrowRight: "\x1bf",
  ArrowUp: "\x1bp",
  ArrowDown: "\x1bn",
};

function legacyCtrlSequence(key: string): string | null {
  if (key.length !== 1) return null;
  const code = key.toUpperCase().charCodeAt(0);
  if (code >= 64 && code <= 95) return String.fromCharCode(code & 0x1f);
  if (key === "?") return "\x7f";
  return null;
}

export function toTerminalKeyData(event: TerminalKeyEventLike): string | null {
  if (event.metaKey) return null;
  if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === "v") return null;

  if (event.ctrlKey && !event.altKey) {
    const control = legacyCtrlSequence(event.key);
    if (control) return control;
  }

  if (event.altKey && !event.ctrlKey) {
    if (event.key === "Backspace") return "\x1b\x7f";
    const arrow = ALT_ARROW_SEQUENCES[event.key];
    if (arrow) return arrow;
    if (event.key.length === 1) return `\x1b${event.key}`;
  }

  if (event.key === "Enter") return event.shiftKey ? "\n" : "\r";
  if (event.key === "Tab") return event.shiftKey ? "\x1b[Z" : "\t";

  return SPECIAL_KEY_SEQUENCES[event.key] ?? null;
}

export function asBracketedPaste(text: string): string {
  return `\x1b[200~${text}\x1b[201~`;
}

/** What the integrated terminal needs from a keydown to name a chord. */
export interface TerminalChordEventLike {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** The unshifted character a physical key carries, from its layout-independent
 *  `code` (`KeyE` is `e` wherever the layout puts an accent on it). */
const CODE_CHARACTERS: Record<string, string> = {
  Space: " ", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
  Backslash: "\\", IntlBackslash: "\\", Semicolon: ";", Quote: "'",
  Backquote: "`", Comma: ",", Period: ".", Slash: "/",
};

function baseKeyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return CODE_CHARACTERS[code] ?? null;
}

/**
 * The macOS Option chords xterm's own Meta path cannot produce.
 *
 * xterm's `macOptionIsMeta` translates from the legacy `keyCode`, in the
 * `default:` arm of that switch, so a printable chord works (Option+R is `®`,
 * `keyCode` 82, so the PTY gets ESC + `r`) and the rest does not: a chord whose
 * `key` is the layout's accent (Option+E on a Portuguese layout is `´`, and
 * `Dead` on another) maps to nothing and lands in the shell as that text — the
 * five presses that read `´´´´´` at the prompt — while the arrows are handled in
 * their own cases, above the Alt branch, so Alt+Left goes out as the modified
 * CSI `ESC [ 1 ; 3 D`, which no macOS shell binds. fzf's Option+E / Option+C and
 * readline's word jumps are exactly the chords that never arrive.
 *
 * The chord is rebuilt from `key` and the physical `code`, like Terminal.app:
 * Alt+arrows are ESC + `b` / `f` (word jumps), and a chord whose `key` names no
 * character sends ESC + the letter under the finger.
 */
export function macOptionSequence(event: TerminalChordEventLike): string | null {
  if (!event.altKey || event.ctrlKey || event.metaKey) return null;
  const arrow = ALT_ARROW_SEQUENCES[event.key];
  if (arrow) return arrow;
  // The chords xterm's key translation does produce, kept in one place so the
  // shell sees one shape for an Option chord whichever path carried it.
  if (event.key === "Backspace") return "\x1b\x7f";
  if (event.key === "Enter") return "\x1b\r";
  if (event.key === "Tab") return "\x1b\t";
  if (event.key === "Escape") return "\x1b\x1b";
  // One character: xterm's Meta path already sends ESC + the lowercase key.
  if (event.key.length === 1) return null;
  const base = baseKeyFromCode(event.code);
  return base === null ? null : `\x1b${base}`;
}
