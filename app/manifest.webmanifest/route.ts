import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

export function GET() {
  const appName = process.env.PI_WEB_APP_NAME?.trim() || "Pi Web";
  // Every env(safe-area-inset-*) is 0 without `viewport-fit=cover`, so the
  // installed app needs it on its own viewport source: Safari reads that only
  // from the page's meta tag (app/layout.tsx sets `viewportFit: "cover"`, and no
  // Safari version supports the manifest's `viewport` member), while Chromium
  // 124+ reads it from the manifest for an installed app. The same string in
  // both keeps an installed app full-bleed on either engine, which is what the
  // shell's inset padding is written for. Next's `MetadataRoute.Manifest` type
  // predates the member.
  const manifest: MetadataRoute.Manifest & { viewport: string } = {
    id: "/",
    name: appName,
    short_name: appName,
    description: "Local web interface for the pi coding agent",
    start_url: "/",
    scope: "/",
    display: "standalone",
    viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
    background_color: "#ffffff",
    theme_color: "#1a1a1a",
    categories: ["developer", "productivity"],
    lang: "en",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };

  return Response.json(manifest, {
    headers: { "content-type": "application/manifest+json" },
  });
}
