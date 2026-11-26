import React from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../hooks/useI18n";
import { ImagePreview } from "../components/ImagePreview";

/**
 * A turn's images in a gallery container, in a real browser.
 *
 * The overlay used to hold one picture and no way out except the ×: on a phone a thumb
 * had nothing to swipe, and a trackpad's flick did nothing. The overlay now travels the
 * images of its own container, so the fixture is a row of them, the way a turn's images
 * are a row in the conversation. The pictures are three solid colours, so a check can
 * read which one is on screen from its own pixels.
 */
function svg(label, color) {
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="${color}"/><text x="16" y="90" font-size="48" fill="#111111">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(body)}`;
}

const IMAGES = [
  { src: svg("one", "#f2a2a2"), alt: "first picture" },
  { src: svg("two", "#a2f2b4"), alt: "second picture" },
  { src: svg("three", "#a2c4f2"), alt: "third picture" },
];

createRoot(document.getElementById("root")).render(
  <I18nProvider>
    <div className="app-shell">
      <div data-image-gallery className="image-row">
        {IMAGES.map((image) => (
          <ImagePreview key={image.src} src={image.src} alt={image.alt}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.src} alt={image.alt} style={{ width: 96, height: 64, objectFit: "cover", display: "block" }} />
          </ImagePreview>
        ))}
      </div>
      {/* One picture, on its own: the overlay has nothing to travel, so it says nothing
          and shows no direction. */}
      <div className="markdown-body">
        <ImagePreview src={IMAGES[0].src} alt="first picture">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={IMAGES[0].src} alt="first picture" style={{ width: 96, height: 64, objectFit: "cover", display: "block" }} />
        </ImagePreview>
      </div>
    </div>
  </I18nProvider>,
);
