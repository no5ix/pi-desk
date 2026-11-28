import { NextResponse } from "next/server";
import { isApiRequestAllowed } from "@/lib/request-security";
import { invalidateProjectBranch, readProjectBranches } from "@/lib/project-branches";

/**
 * The branch of each project folder the app lists.
 *
 * The project lists name a folder by path, and the sidebar's rows and the Git
 * panel's switcher already carry the branch: eight checkouts of one repository,
 * differing only by branch, are indistinguishable in a list of folder names. The
 * client asks for the paths it is about to show and paints the answer on the
 * rows.
 *
 * A path outside the app's authorized roots, a folder that is gone, and a folder
 * that is not a checkout are all answered the same way — `isRepo: false`, no
 * name, no branch — so the endpoint never confirms that something exists.
 */
export async function GET(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const url = new URL(request.url);
  const cwds = url.searchParams.getAll("cwd");
  if (cwds.length === 0) {
    return NextResponse.json({ error: "cwd must be given at least once" }, { status: 400 });
  }
  if (url.searchParams.get("refresh") === "1") invalidateProjectBranch();

  const projects = await readProjectBranches(cwds);
  return NextResponse.json({ projects });
}
