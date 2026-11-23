import type { MetadataRoute } from "next";

export const dynamic = "force-dynamic";

export function GET() {
  const appName = process.env.PI_WEB_APP_NAME?.trim() || "Pi Web";
  // `viewport` is the manifest member iOS 16.4+ reads for the *installed* app:
  // a home-screen install takes its viewport from the manifest, not from the
  // page's meta tag, so without `viewport-fit=cover` here the installed app
  // never gets the full-bleed viewport the shell's safe-area padding is written
  // for. Next's `MetadataRoute.Manifest` type predates the member.
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
