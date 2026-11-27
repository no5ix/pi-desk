import { NextResponse } from "next/server";
import { listStandardPlaces, reportDirectories } from "@/lib/directory-places";
import { errorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/cwd/places[?path=<folder>&path=…]
 *
 * The folder browser's left rail: the standard places on this computer, and the
 * state of the paths the panel remembers (its favourites and its recents).
 *
 * Nothing is written here, and no path is invented: the standard places are the
 * four folders under the user's home, and the caller's paths are only answered
 * with exists/readable. The list itself comes from the panel's own storage.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requested = url.searchParams.getAll("path");
    const [places, directories] = await Promise.all([listStandardPlaces(), reportDirectories(requested)]);
    return NextResponse.json({ places, directories });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 500 });
  }
}
