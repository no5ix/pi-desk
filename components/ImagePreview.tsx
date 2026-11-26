"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { isImeComposing } from "@/lib/ime";

interface ImagePreviewProps {
  src: string;
  alt?: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/** A swipe is a swipe, on a finger and on a trackpad alike: the distance that counts
 *  as "the user meant to turn the page". Below it, a press that ends where it began is
 *  a tap, and a tap on the image closes the overlay. */
const SWIPE_MIN_PX = 40;
/** A trackpad's momentum sends dozens of wheel events per gesture; they add up to one
 *  page turn, then a short rest before the next gesture is taken seriously. */
const WHEEL_STEP_PX = 60;
const WHEEL_COOLDOWN_MS = 260;

interface GalleryItem {
  src: string;
  alt: string;
}

export function ImagePreview({ src, alt = "", children, className, style }: ImagePreviewProps) {
  const { t } = useI18n();
  const previewLabel = t("chat.previewImage");
  const triggerLabel = alt.trim() ? `${previewLabel}: ${alt}` : previewLabel;
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // The images of the open preview, in the order the conversation shows them.
  const [gallery, setGallery] = useState<GalleryItem[]>([{ src, alt }]);
  const swipeRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const swipedRef = useRef(false);
  const wheelRef = useRef({ acc: 0, at: 0 });

  /** The previews this one travels with: the gallery container if there is one, the
   *  rendered document a markdown image sits in, and otherwise the row it stands in.
   *  Read from the DOM at the moment the overlay opens, because the conversation is
   *  what decides the order — an image's neighbours are its siblings in the page, not
   *  a list a caller has to keep in step. */
  const collectGallery = useCallback((): GalleryItem[] => {
    const trigger = triggerRef.current;
    if (!trigger) return [{ src, alt }];
    const scope: ParentNode =
      trigger.closest<HTMLElement>("[data-image-gallery], .markdown-body, .message-assistant, .message-user")
      ?? trigger.parentElement
      ?? document;
    const nodes = Array.from(scope.querySelectorAll<HTMLElement>("[data-image-preview-src]"));
    if (nodes.length < 2) return [{ src, alt }];
    const items = nodes
      .map((node) => ({ src: node.dataset.imagePreviewSrc ?? "", alt: node.dataset.imagePreviewAlt ?? "" }))
      .filter((item) => item.src.length > 0);
    const at = nodes.findIndex((node) => node.dataset.imagePreviewSrc === src);
    setIndex(at >= 0 ? at : 0);
    return items.length > 1 ? items : [{ src, alt }];
  }, [src, alt]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = triggerRef.current;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      if (trigger?.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, [open]);

  const openPreview = () => {
    setGallery(collectGallery());
    setOpen(true);
  };

  const closePreview = () => {
    if (dialogRef.current?.open) dialogRef.current.close();
    setOpen(false);
  };

  const count = gallery.length;
  const current = gallery[Math.min(index, count - 1)] ?? { src, alt };

  const step = useCallback((delta: number) => {
    setIndex((value) => {
      if (count < 2) return value;
      // The images of a turn are a ring: swiping past the last one arrives at the first.
      return (value + delta + count) % count;
    });
  }, [count]);

  // A trackpad sends wheel events in a momentum burst; the horizontal intent is
  // summed, one page is turned per burst, and the rest of the burst is ignored.
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onWheel = (event: WheelEvent) => {
      if (count < 2) return;
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      const now = Date.now();
      if (now - wheelRef.current.at < WHEEL_COOLDOWN_MS) {
        wheelRef.current.acc = 0;
        return;
      }
      wheelRef.current.acc += event.deltaX;
      if (Math.abs(wheelRef.current.acc) < WHEEL_STEP_PX) return;
      step(wheelRef.current.acc > 0 ? 1 : -1);
      wheelRef.current = { acc: 0, at: now };
    };
    dialog.addEventListener("wheel", onWheel, { passive: true });
    return () => dialog.removeEventListener("wheel", onWheel);
  }, [open, count, step]);

  // Neighbours are fetched while the current image is being looked at, so a swipe
  // reveals a picture that is already there.
  useEffect(() => {
    if (!open || count < 2) return;
    for (const delta of [1, -1]) {
      const next = gallery[(index + delta + count) % count];
      if (next?.src) {
        const image = new window.Image();
        image.src = next.src;
      }
    }
  }, [open, gallery, index, count]);

  const onPointerDown = (event: React.PointerEvent<HTMLDialogElement>) => {
    if (event.pointerType === "mouse") return;
    swipeRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    swipedRef.current = false;
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDialogElement>) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    // The engine sends a click after a finger's release, and the swipe lands on the
    // image: the mark says that click is the end of a swipe, not a tap. It is cleared
    // as soon as the click has been answered, so the next tap closes the overlay.
    swipedRef.current = true;
    window.setTimeout(() => { swipedRef.current = false; }, 0);
    step(dx < 0 ? 1 : -1);
  };

  const onImageClick = () => {
    // A swipe ends on the image too: only a press that stayed where it was is a tap.
    if (swipedRef.current) {
      swipedRef.current = false;
      return;
    }
    closePreview();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (isImeComposing(event)) return;
    // Escape belongs to this overlay: it is answered here, and stopped, so the app's
    // global Escape (stop the running agent) does not fire behind it. The arrows are the
    // ring's, and only when there is a ring.
    if (event.key !== "Escape") {
      if (count < 2) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closePreview();
  };

  const counter = useMemo(
    () => (count > 1 ? `${index + 1} / ${count}` : null),
    [count, index],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        data-image-preview-src={src}
        data-image-preview-alt={alt || undefined}
        style={{
          display: "block",
          padding: 0,
          border: "none",
          background: "none",
          color: "inherit",
          cursor: "zoom-in",
          ...style,
        }}
        onClick={openPreview}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={previewLabel}
      >
        {children}
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          className="image-preview-dialog"
          data-count={count}
          aria-label={t("chat.previewImage")}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            closePreview();
          }}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { swipeRef.current = null; }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closePreview();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={current.src}
            className="image-preview-image"
            src={current.src}
            alt={current.alt}
            onClick={onImageClick}
          />
          {counter && (
            <span className="image-preview-count" aria-live="polite">{counter}</span>
          )}
          {/* No direction plates: the ring is travelled by the hand — a swipe, a
              trackpad flick, the arrow keys — and the picture's own count says where it
              is. Two big white discs over the user's photo covered the very thing they
              were looking at, and they sat on top of the image's own tap-to-close area. */}
          <button
            ref={closeButtonRef}
            type="button"
            className="image-preview-close"
            onClick={closePreview}
            aria-label={t("chat.close")}
            title={t("chat.close")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </dialog>
      )}
    </>
  );
}
