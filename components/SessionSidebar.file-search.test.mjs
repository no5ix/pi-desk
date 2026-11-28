import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./FileExplorer.tsx", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../app/api/files/[...path]/route.ts", import.meta.url), "utf8");

test("provides a debounced file search UI and opens selected results", () => {
  assert.match(source, /searchQuery/);
  assert.match(source, /\/api\/file-index\?cwd=\$\{encodeURIComponent\(cwd\)\}&q=\$\{encodeURIComponent\(query\)\}/);
  assert.match(source, /setTimeout\(\(\) =>/);
  assert.match(source, /onOpenFile\(node\.fullPath, node\.name\)/);
});

test("renders search results with the existing expandable file tree", () => {
  assert.match(source, /buildSearchTree/);
  assert.match(source, /searchRoots\.map/);
  assert.match(source, /<TreeNode/);
  assert.match(source, /expandedPaths=\{searchExpanded\}/);
});

test("search result rows offer mention and download actions like the file tree", () => {
  // The tree moved both actions into the row's menu (the hover buttons took width
  // from the name at a narrow panel), and the search list is the tree's own
  // renderer, so it inherits the same menu. The assertions follow the actions
  // there; what must not regress is that a search row can be mentioned, downloaded
  // and opened like a tree row.
  assert.match(source, /id: "mention",[\s\S]{0,220}getRelativeFilePath\(node\.fullPath, cwd\)/);
  assert.match(source, /id: "download", label: t\("files\.download"\), onSelect: \(\) => downloadFile\(node\.fullPath\)/);
  assert.match(source, /anchor\.href = `\/api\/files\/\$\{encodeFilePathForApi\(filePath\)\}\?type=download`/);
  assert.match(source, /actions=\{actions\}/, "the search tree is drawn with the tree's row actions");
});

test("keeps search on the bounded index and reports request failures", () => {
  assert.match(source, /setSearchError\(true\)/);
  assert.match(source, /role="alert"/);
  assert.doesNotMatch(apiSource, /type === "search"|searchFiles/);
});
