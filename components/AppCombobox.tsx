"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { isImeComposing } from "@/lib/ime";
import { scrollMovesAnchor } from "@/lib/menu-placement";
import { usePopTransition } from "@/hooks/usePopTransition";

type AppComboboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "list" | "role"> & {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  "aria-label": string;
};

/** Free text with app-themed suggestions; typing a new value remains valid. */
export function AppCombobox({ value, onValueChange, options, onKeyDown, onFocus, onBlur, ...props }: AppComboboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const matches = [...new Set(options)].filter((option) => option.toLocaleLowerCase().includes(value.toLocaleLowerCase()));
  const visible = open && matches.length > 0 && Boolean(anchor);
  // The suggestion list leaves the way it came (the shared `app-pop-out`). Typing can
  // empty `matches` in the same click that closes the list, so the exiting box keeps the
  // last list it showed: a closing panel that has lost its rows reads as a flash.
  const pop = usePopTransition(visible);
  const shownMatches = useRef(matches);
  if (matches.length > 0) shownMatches.current = matches;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (inputRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener("pointerdown", outside);
    // A scroll shuts the suggestions away only when it carries the field off. The chat
    // scrolls itself while a session streams, and that closed the list mid-typing.
    const onScroll = (event: Event) => {
      if (scrollMovesAnchor(event.target, inputRef.current)) close();
    };
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (active >= 0) panelRef.current?.querySelectorAll('[role="option"]')[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const select = (next: string) => { setOpen(false); setActive(-1); onValueChange(next); };
  const width = anchor ? Math.min(Math.max(anchor.width, 240), window.innerWidth - 16) : 0;
  const above = anchor ? window.innerHeight - anchor.bottom < 170 && anchor.top > window.innerHeight - anchor.bottom : false;

  return (
    <>
      <input {...props} ref={inputRef} value={value} role="combobox" autoComplete="off" aria-autocomplete="list"
        aria-expanded={visible} aria-controls={visible ? id : undefined} aria-activedescendant={visible && active >= 0 && active < matches.length ? `${id}-${active}` : undefined}
        onFocus={(event) => { setAnchor(event.currentTarget.getBoundingClientRect()); setOpen(true); onFocus?.(event); }}
        onBlur={(event) => { setOpen(false); onBlur?.(event); }}
        onChange={(event) => { setAnchor(event.currentTarget.getBoundingClientRect()); setOpen(true); setActive(-1); onValueChange(event.target.value); }}
        onKeyDown={(event) => {
          if (isImeComposing(event)) { onKeyDown?.(event); return; }
          if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length > 0) {
            event.preventDefault(); setAnchor(event.currentTarget.getBoundingClientRect()); setOpen(true);
            setActive((current) => current < 0 ? event.key === "ArrowDown" ? 0 : matches.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
          } else if (visible && event.key === "Enter" && active >= 0 && active < matches.length) {
            event.preventDefault(); select(matches[active]);
          } else if (visible && event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); setOpen(false);
          } else if (event.key === "Tab") setOpen(false);
          if (!event.defaultPrevented) onKeyDown?.(event);
        }} />
      {pop.mounted && anchor && createPortal(
        <div ref={panelRef} id={id} role="listbox" aria-label={props["aria-label"]} className={`native-popover app-menu app-combobox-menu${pop.className}`}
          style={{
            width,
            left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)),
            // One side or the other, named, so the object keeps a single type. The custom
            // property is the edge the shared pop animation grows from.
            top: above ? undefined : anchor.bottom + 6,
            bottom: above ? window.innerHeight - anchor.top + 6 : undefined,
            maxHeight: Math.max(48, Math.min(240, (above ? anchor.top : window.innerHeight - anchor.bottom) - 14)),
            ["--pop-origin"]: above ? "bottom center" : "top center",
          } as CSSProperties}>
          {shownMatches.current.map((option, index) => <button key={option} id={`${id}-${index}`} type="button" role="option" tabIndex={-1}
            aria-selected={active === index} className="app-menu-option" onPointerDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)} onClick={() => select(option)}>{option}</button>)}
        </div>, document.body,
      )}
    </>
  );
}
