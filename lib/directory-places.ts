import { access, realpath } from "node:fs/promises";
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { userHome } from "./user-home.ts";

/**
 * The folders a folder browser puts in its left rail.
 *
 * The web version has no OS folder panel (a browser page has no path access), so
 * the app's own picker has to answer the question a native one answers for free:
 * *where do people keep projects?* Pi runs sessions on this server, so the answer
 * is read here, off the server's own filesystem, and each place says whether it
 * is there and readable — macOS TCC denies Desktop, Documents and Downloads to
 * the process, and a rail row that opens on a refusal is worse than one that is
 * visibly off.
 */

/** The four folders people mean, under the user's home. */
export const STANDARD_PLACE_DIRS = ["Documents", "Desktop", "Downloads"] as const;

export interface DirectoryPlace {
  /** A stable id the panel names in its own language; never a path. */
  id: "home" | "documents" | "desktop" | "downloads";
  path: string;
  exists: boolean;
  readable: boolean;
}

/** One folder the panel was told about (a favourite, a recent pick). */
export interface ReportedDirectory {
  path: string;
  exists: boolean;
  readable: boolean;
}

/** Readable and listable to this process — what the panel can open. */
export async function isReadableDirectory(dir: string): Promise<boolean> {
  try {
    await access(dir, fsConstants.R_OK | fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function probe(dir: string): Promise<{ exists: boolean; readable: boolean; real: string | null }> {
  try {
    const real = await realpath(dir);
    return { exists: true, readable: await isReadableDirectory(real), real };
  } catch {
    return { exists: false, readable: false, real: null };
  }
}

/**
 * Home, Documents, Desktop, Downloads, in that order.
 *
 * Paths are resolved with `path.join` on the caller's home, so a Windows home
 * with a space, or a home that is itself a link, comes out as one real folder.
 */
export async function listStandardPlaces(home: string = userHome()): Promise<DirectoryPlace[]> {
  const homeReal = await probe(home);
  const base = homeReal.real ?? path.resolve(home);
  const places: DirectoryPlace[] = [
    { id: "home", path: base, exists: homeReal.exists, readable: homeReal.readable },
  ];
  for (const name of STANDARD_PLACE_DIRS) {
    const probed = await probe(path.join(base, name));
    places.push({
      id: name.toLowerCase() as "documents" | "desktop" | "downloads",
      // Report the resolved folder, so the panel's rows and the browse route agree.
      path: probed.real ?? path.join(base, name),
      exists: probed.exists,
      readable: probed.readable,
    });
  }
  return places;
}

/**
 * Report the panel's own remembered paths (favourites, recents) as of now.
 *
 * A favourite whose folder was deleted or moved opens on a refusal, so the panel
 * asks and shows the ones that are gone as what they are. Requests are capped:
 * the panel's own lists are short, and a route that reads the filesystem takes
 * no more than that.
 */
export const REPORTED_PATHS_MAX = 32;

export async function reportDirectories(paths: readonly string[]): Promise<ReportedDirectory[]> {
  const unique = [...new Set(paths.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean))]
    .slice(0, REPORTED_PATHS_MAX);
  return Promise.all(
    unique.map(async (item) => {
      const probed = await probe(item);
      return { path: item, exists: probed.exists, readable: probed.readable };
    }),
  );
}
