import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { POST, dynamic } = await jiti.import("./route.ts");

// POST /api/cwd/pick runs the native macOS folder panel, so the tests cover the gates
// and the contract; nothing here opens a dialog on the developer's screen. The osascript
// half is pinned by source sentinel.

const JSON_HEADERS = { "content-type": "application/json" };

function post(body, headers = { host: "localhost", ...JSON_HEADERS }) {
  return POST(new Request("http://localhost/api/cwd/pick", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body ?? {}),
  }));
}

test("the folder panel is dynamic, so no cache answers it", () => {
  assert.equal(dynamic, "force-dynamic");
});

test("a page that is not Pi on this computer cannot open a Finder panel", async () => {
  const refusals = [
    { host: "pi.example.com", ...JSON_HEADERS },
    { host: "192.168.0.20", ...JSON_HEADERS },
    { host: "macb00kpr0m4.taila0e40f.ts.net", ...JSON_HEADERS },
    { host: "localhost", ...JSON_HEADERS, "tailscale-user-login": "user@example.com" },
    { host: "localhost", ...JSON_HEADERS, "tailscale-funnel-request": "1" },
  ];
  for (const headers of refusals) {
    const response = await post({}, headers);
    assert.equal(response.status, 403, `${headers.host} ${headers["tailscale-user-login"] ?? ""} must be refused`);
    assert.match((await response.json()).error, /only available on the computer running Pi/);
  }
});

test("the route is macOS-only and the picked path is validated by the caller", () => {
  const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  assert.match(source, /isLocalRequest\(req\)/, "the local gate, never a bare loopback Host check");
  assert.match(source, /process\.platform !== "darwin"/, "macOS only");
  assert.match(source, /choose folder with prompt/, "the native Finder panel");
  assert.match(source, /panelOpen/, "one panel per process");

  const client = readFileSync(new URL("../../../../lib/project-directory-pick.ts", import.meta.url), "utf8");
  assert.match(client, /"\/api\/cwd\/pick"/);
  assert.match(client, /"\/api\/cwd\/validate"/, "the picked folder goes through the same validation as the Tauri pick");

  const sidebar = readFileSync(new URL("../../../../components/SessionSidebar.tsx", import.meta.url), "utf8");
  assert.match(sidebar, /import \{ pickProjectDirectoryFromServer \} from "@\/lib\/project-directory-pick";/);
  assert.match(sidebar, /const picked = await pickProjectDirectoryFromServer\(t\("sidebar\.addProjectPrompt"\)\);\s*if \(picked\) \{\s*activateProject\(picked\);\s*return;\s*\}\s*setProjectPickerOpen\(true\);/,
    "the web Add project button uses the Finder pick, and the in-app picker is the fallback");
});
