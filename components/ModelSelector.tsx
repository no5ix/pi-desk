"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { isImeComposing } from "@/lib/ime";
import { COMPOSER_MODEL_MENU_WIDTH, composerPanelAnchoring } from "@/lib/composer-panel-placement";
import { SelectorRow } from "./SelectorRow";

export interface ModelSelectorOption {
  provider: string;
  /** The provider's display name (DeepSeek, not deepseek); the id when it has none (M4). */
  providerName?: string;
  modelId: string;
  name: string;
}

interface ModelSelectorProps {
  options: ModelSelectorOption[];
  value?: { provider: string; modelId: string } | null;
  onChange: (provider: string, modelId: string) => void;
  onClear?: () => void;
  emptyLabel?: string;
  selectedLabel?: string;
  disabled?: boolean;
  busy?: boolean;
  isAutoSelection?: boolean;
  ariaLabel?: string;
  variant?: "toolbar" | "field";
  /**
   * Icon only, for a row that has no room for words (the composer's control row,
   * shared with attach and Send). The model's name, which the chip used to print,
   * moves into `title` and `aria-label` so it is still readable — by hover, and by
   * a screen reader.
   */
  iconOnly?: boolean;
  placement?: "up" | "auto";
  /**
   * The picker sits in the composer's control row. Its panel then hangs from its own
   * button and is placed by `lib/composer-panel-placement`, because it cannot be a
   * `position: fixed` box there: the phone's control strip animates with `translate`
   * and `scale` and blurs its backdrop, and both make the strip the containing block
   * for a fixed descendant — `left: 8; right: 8` measures the strip's own ~200px, and
   * the model list opens as a narrow column that cuts every model name.
   */
  composerAnchored?: boolean;
  /** The model new sessions start with; its row gets a filled star. */
  defaultValue?: { provider: string; modelId: string } | null;
  /** Shows a star on every row that saves it as the default. */
  onSetDefault?: (provider: string, modelId: string) => void;
}

const MODEL_FILTER_THRESHOLD = 8;
const MODEL_OPTION_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareModelOptions(a: ModelSelectorOption, b: ModelSelectorOption): number {
  return MODEL_OPTION_COLLATOR.compare(a.name || a.modelId, b.name || b.modelId)
    || MODEL_OPTION_COLLATOR.compare(a.provider, b.provider)
    || MODEL_OPTION_COLLATOR.compare(a.modelId, b.modelId);
}

export function filterModelOptions(options: ModelSelectorOption[], query: string): ModelSelectorOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((option) => (
    // Name, id, the provider's name and id, and provider/modelId all match (upstream #1308, #1514).
    `${option.name} ${option.modelId} ${option.provider} ${option.providerName ?? ""} ${option.provider}/${option.modelId}`
      .toLocaleLowerCase()
      .includes(normalizedQuery)
  ));
}

export function ModelSelector({
  options,
  value,
  onChange,
  onClear,
  emptyLabel,
  selectedLabel,
  disabled = false,
  busy = false,
  isAutoSelection = false,
  ariaLabel,
  variant = "toolbar",
  iconOnly = false,
  placement = "up",
  composerAnchored = false,
  defaultValue,
  onSetDefault,
}: ModelSelectorProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<{ top: number; right: number; bottom: number; left: number; width: number } | null>(null);
  const [filter, setFilter] = useState("");
  const locked = disabled || busy;
  const sortedOptions = useMemo(() => [...options].sort(compareModelOptions), [options]);
  const filteredOptions = filterModelOptions(sortedOptions, filter);
  const showFilter = sortedOptions.length > MODEL_FILTER_THRESHOLD;
  const modelsByProvider: { provider: string; label: string; options: ModelSelectorOption[] }[] = [];

  for (const option of filteredOptions) {
    const group = modelsByProvider.find((item) => item.provider === option.provider);
    if (group) group.options.push(option);
    else modelsByProvider.push({ provider: option.provider, label: option.providerName || option.provider, options: [option] });
  }

  const currentName = selectedLabel ?? (value
    ? sortedOptions.find((option) => option.modelId === value.modelId && option.provider === value.provider)?.name ?? value.modelId
    : emptyLabel ?? (sortedOptions.length > 0 ? "Select model" : "No models"));
  const buttonTitle = busy ? "Switching model" : locked ? currentName : sortedOptions.length > 0 || onClear ? "Change model" : "No available models";
  // With no label to read, the trigger says the model's own name (hover and a11y tree).
  const triggerTitle = iconOnly ? `${currentName} — ${buttonTitle}` : buttonTitle;

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        rootRef.current && !rootRef.current.contains(event.target as Node)
        && panelRef.current && !panelRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
        setFilter("");
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!locked) return;
    setOpen(false);
    setFilter("");
  }, [locked]);

  // The composer toolbar draws every control icon at 14px; the form field keeps its smaller glyph.
  const chipIconSize = variant === "field" ? 11 : 14;

  const buttonStyle: CSSProperties = variant === "field"
    ? {
        display: "flex",
        alignItems: "center",
        gap: 7,
        width: "100%",
        minWidth: 0,
        height: 34,
        padding: "0 9px",
        overflow: "hidden",
        border: "var(--hairline) solid var(--border)",
        borderRadius: "var(--radius-sm)",
        background: locked ? "var(--bg-panel)" : "var(--bg)",
        color: locked ? "var(--text-dim)" : "var(--text)",
        cursor: locked ? "default" : "pointer",
        fontSize: "var(--fs-caption)",
        textAlign: "left",
      }
    : {
        display: "flex",
        alignItems: "center",
        justifyContent: isMobile ? "flex-start" : undefined,
        gap: 6,
        width: isMobile ? "100%" : undefined,
        // Never wider than the row that holds it. A plain `220` cap is not a
        // shrink: on a narrow desktop composer (the workspace panel open, a
        // phone-sized window) the trigger kept its 220px box past the shrunken
        // root and painted over the context-usage ring beside it.
        maxWidth: isMobile ? "100%" : "min(220px, 100%)",
        height: 32,
        padding: isMobile ? "8px 10px" : "8px 12px",
        ...(iconOnly ? {
          // A square icon button, the size every other control in the row is.
          width: 32,
          maxWidth: "none",
          gap: 0,
          padding: 0,
          justifyContent: "center",
        } : null),
        overflow: "hidden",
        border: "none",
        borderRadius: "var(--radius-md)",
        background: open ? "var(--bg-hover)" : "none",
        color: "var(--text-muted)",
        cursor: locked ? "not-allowed" : "pointer",
        fontSize: "var(--fs-caption)",
        opacity: locked ? 0.5 : 1,
        transition: "background var(--dur-fast) var(--ease-native), color var(--dur-fast) var(--ease-native)",
      };

  const choose = (option: ModelSelectorOption) => {
    const active = option.modelId === value?.modelId && option.provider === value?.provider;
    setOpen(false);
    setFilter("");
    if (!active || isAutoSelection) onChange(option.provider, option.modelId);
  };

  const saveDefault = (option: ModelSelectorOption) => {
    onSetDefault?.(option.provider, option.modelId);
  };

  return (
    <div
      ref={rootRef}
      className={`model-selector is-${variant}${locked ? " is-disabled" : ""}`}
      // An icon-only control sizes to its glyph in every tier. The labelled toolbar chip
      // fills its row on a phone (`width: 100%`, `flex: 1 1 auto`), and inside the
      // composer's control strip that width is the strip's own: it put a 22px gap after
      // the model glyph and squeezed the strip's close control from 36px to 15px.
      style={{ position: "relative", width: iconOnly ? undefined : variant === "field" || isMobile ? "100%" : undefined, minWidth: 0, flex: iconOnly ? "0 0 auto" : variant === "toolbar" && isMobile ? "1 1 auto" : undefined }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open || isImeComposing(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setFilter("");
        setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={ariaLabel ?? triggerTitle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={busy || undefined}
        disabled={locked}
        title={triggerTitle}
        style={buttonStyle}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchorRect({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width });
          setOpen((current) => {
            if (current) setFilter("");
            return !current;
          });
        }}
        onMouseEnter={(event) => {
          if (locked) return;
          event.currentTarget.style.background = "var(--bg-hover)";
          event.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(event) => {
          if (locked) {
            event.currentTarget.style.background = variant === "field" ? "var(--bg-panel)" : "none";
            event.currentTarget.style.color = variant === "field" ? "var(--text-dim)" : "var(--text-muted)";
            return;
          }
          event.currentTarget.style.background = open ? "var(--bg-hover)" : variant === "field" ? "var(--bg)" : "none";
          event.currentTarget.style.color = variant === "field" ? "var(--text)" : "var(--text-muted)";
        }}
      >
        {busy ? (
          <svg width={chipIconSize} height={chipIconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }} aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          </svg>
        ) : (
          <svg width={chipIconSize} height={chipIconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={variant === "field" ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
            <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
            <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
            <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
          </svg>
        )}
        {!iconOnly && <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{currentName}</span>}
        {variant === "field" && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, color: "var(--text-dim)" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>

      {open && anchorRect && (() => {
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const spaceAbove = anchorRect.top - 8;
        const spaceBelow = viewportHeight - anchorRect.bottom - 8;
        const openAbove = placement === "up" || spaceAbove > spaceBelow;
        const maxHeight = Math.max(120, Math.min(openAbove ? spaceAbove : spaceBelow, viewportHeight * 0.6));
        // In the composer, the panel hangs from its own button and is placed by the
        // shared engine: a number for the width (never shrink-to-fit on the 32px chip)
        // and a box that stops at the sidebar. `composerPanelAnchoring` returns the
        // anchor's own coordinates, so it is right whatever the containing block is —
        // including the phone's strip, whose transform and backdrop-filter capture a
        // fixed-position descendant (see the prop). Elsewhere (a settings field) the
        // panel stays a viewport-fixed box: full width on a phone, content width on
        // a desktop.
        const anchoring = composerAnchored
          ? composerPanelAnchoring(rootRef.current, COMPOSER_MODEL_MENU_WIDTH, { alignLeft: isMobile })
          : null;
        const position: CSSProperties = composerAnchored
          ? {
              position: "absolute",
              ...(openAbove ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
              ...(anchoring ? { left: anchoring.left, width: anchoring.width } : { width: COMPOSER_MODEL_MENU_WIDTH, ...(isMobile ? { left: 0 } : { right: 0 }) }),
            }
          : {
              position: "fixed",
              ...(openAbove
                ? { bottom: viewportHeight - anchorRect.top + 6 }
                : { top: anchorRect.bottom + 6 }),
              ...(isMobile
                ? { left: 8, right: 8, maxWidth: "calc(100vw - 16px)" }
                : { left: anchorRect.left, width: "max-content", minWidth: anchorRect.width, maxWidth: Math.max(anchorRect.width, viewportWidth - anchorRect.left - 8) }),
            };

        return (
          <div
            ref={panelRef}
            className="native-popover app-menu"
            role="listbox"
            aria-label={ariaLabel}
            style={{
              ...position,
              zIndex: 500,
              display: "flex",
              flexDirection: "column",
              maxHeight,
              overflow: "hidden",
              border: "var(--hairline) solid var(--border)",
              borderRadius: "var(--radius-md)",
              background: "var(--bg)",
              boxShadow: "var(--shadow-popover)",
            }}
          >
            {showFilter && (
              <div style={{ flexShrink: 0, padding: "6px 8px", borderBottom: "var(--hairline) solid var(--border)" }}>
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t("chat.filterModels")}
                  aria-label={t("chat.filterModels")}
                  // On phones, focusing the filter opens the on-screen keyboard,
                  // which shrinks the viewport and pushes the list off-screen
                  // before the user has decided to filter. Tap to filter instead.
                  autoFocus={!isMobile}
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    boxSizing: "border-box",
                    width: "100%",
                    minWidth: isMobile ? 0 : 220,
                    padding: "5px 8px",
                    border: "var(--hairline) solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    outline: "none",
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-micro)",
                  }}
                />
              </div>
            )}
            <div className="app-menu-list">
              {onClear && !filter.trim() && (
                <SelectorRow active={!value} gutter={Boolean(onSetDefault)} onSelect={() => {
                  setOpen(false);
                  setFilter("");
                  onClear();
                }}>
                  <OptionLabel label={emptyLabel ?? "Default"} />
                </SelectorRow>
              )}
              {modelsByProvider.length === 0 ? (
                <div style={{ padding: "8px 12px", color: "var(--text-dim)", fontSize: "var(--fs-caption)", whiteSpace: "nowrap" }}>
                  {filter.trim() ? t("chat.noMatchingModels") : "No available models"}
                </div>
              ) : modelsByProvider.map((group, index) => (
                <div key={group.provider}>
                  {modelsByProvider.length > 1 && (
                    <div style={{ padding: "6px 12px 4px", borderTop: index > 0 || onClear ? "1px solid var(--border)" : "none", color: "var(--text-dim)", fontSize: "var(--fs-micro)", fontWeight: "var(--fw-semibold)", letterSpacing: 0 }}>
                      {group.label}
                    </div>
                  )}
                  {group.options.map((option) => {
                    return (
                      <SelectorRow
                        key={`${option.provider}:${option.modelId}`}
                        active={option.modelId === value?.modelId && option.provider === value?.provider}
                        onSelect={() => choose(option)}
                        star={onSetDefault ? {
                          isDefault: option.modelId === defaultValue?.modelId && option.provider === defaultValue?.provider,
                          saveLabel: t("chat.saveDefaultModel"),
                          defaultLabel: t("chat.defaultModel"),
                          onSave: () => saveDefault(option),
                        } : undefined}
                      >
                        <OptionLabel label={option.name} />
                      </SelectorRow>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function OptionLabel({ label }: { label: string }) {
  return <span title={label} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>;
}
