import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import reactSyntaxHighlighter from "react-syntax-highlighter";

const source = await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const { Prism: SyntaxHighlighter } = reactSyntaxHighlighter;

function functionBlock(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start) : source.length;
  assert.notEqual(start, -1, `${name} not found`);
  assert.notEqual(end, -1, `${nextName} not found after ${name}`);
  return source.slice(start, end);
}

for (const [name, nextName] of [
  ["ImageViewer", "formatDuration"],
  ["AudioViewer", "VideoViewer"],
  ["VideoViewer", "DocumentViewer"],
  ["DocumentViewer", "FileViewer"],
  ["TextFileViewer", null],
]) {
  test(`${name} watches through the page's shared stream and synchronizes after connecting`, () => {
    const block = functionBlock(name, nextName);
    const watch = block.indexOf("useFileWatch(");
    const connected = block.indexOf("onConnected:", watch);
    const synchronize = block.indexOf("synchronize();", connected);

    assert.ok(watch >= 0, "the shared watcher is missing");
    assert.match(block, /useFileWatch\(filePath, sourceSessionId, watchEnabled, \{/);
    assert.ok(synchronize > connected, "the connected synchronization is missing");
    assert.match(block, /onDisconnected: \(\) => setWatching\(false\)/);
  });
}

test("no viewer opens a file-watch connection of its own", () => {
  // A browser allows about six open connections to one host over HTTP/1.1. One EventSource
  // per open file tab used to spend them all, and a refresh's document request then queued
  // behind watchers of files nobody was looking at: the service worker answered the starved
  // navigation with a fallback page on a healthy server (e2e/offline-navigation.mjs).
  assert.doesNotMatch(source, /new EventSource/, "the watcher must go through lib/file-watch-channel.ts");
  assert.doesNotMatch(source, /getFileApiUrl\(filePath, "watch"/);
});

test("the shared watcher subscribes through the channel, and reports a removed file as a change", () => {
  const block = functionBlock("useFileWatch", "DownloadLink");
  assert.match(block, /subscribeFileWatch\(/);
  assert.match(block, /onRemoved: \(\) => handlersRef\.current\.onChange\(\{ size: 0 \}\)/);
  assert.match(block, /onDisconnect: \(\) => handlersRef\.current\.onDisconnected\(\)/);
  // The handlers are read through a ref, so a re-render does not resubscribe the file.
  assert.match(block, /\}, \[filePath, sourceSessionId, enabled\]\);/);
});

test("FileViewer forwards watcher state to every viewer implementation", () => {
  const block = functionBlock("FileViewer", "TextFileViewer");
  assert.equal(block.match(/watchEnabled=\{watchEnabled\}/g)?.length, 5);
});

test("TextFileViewer snapshots and restores lightweight tab state", () => {
  const block = functionBlock("TextFileViewer", null);
  assert.match(block, /onStateChangeRef\.current\?\.\(\{ \.\.\.viewerStateRef\.current \}\)/);
  assert.match(block, /displayMode: requestedInitialDisplayMode/);
  assert.match(block, /viewerStateRef\.current\.displayMode = nextDisplayMode/);
  assert.match(block, /viewerStateRef\.current\.wrapLines = next/);
  assert.match(block, /viewerStateRef\.current\.scrollTop = event\.currentTarget\.scrollTop/);
  assert.match(block, /viewerStateRef\.current\.scrollLeft = event\.currentTarget\.scrollLeft/);
  assert.match(block, /content\.scrollTop = viewerStateRef\.current\.scrollTop/);
  assert.match(block, /content\.scrollLeft = viewerStateRef\.current\.scrollLeft/);
});

test("TextFileViewer resolves the preview default before the first content render", () => {
  const block = functionBlock("TextFileViewer", null);
  // The path is part of the initial-mode resolution, so a markdown file's very
  // first render after the fetch is already the preview. Deciding the default
  // after the contents arrived painted the source view for a frame first.
  assert.match(block, /resolveInitialFileDisplayMode\(initialState, initialDisplayMode, filePath\)/);
  assert.match(block, /useState<DisplayMode>\(requestedInitialDisplayMode\)/);
  assert.doesNotMatch(block, /updateDisplayMode\("preview"\)/);
});

test("TextFileViewer falls back to source while the preview is unavailable", () => {
  const block = functionBlock("TextFileViewer", null);
  // A truncated (not fully loaded) file has no preview, so a preview default
  // must not paint a partial document or leave both switch buttons inactive.
  // A CSV/TSV table previews from its first chunk; DelimitedTable marks it incomplete.
  assert.match(block, /const hasPreview = isDelimitedTable \|\| \(!data\?\.truncated && \(isHtml \|\| isMarkdown\)\);/);
  assert.match(block, /displayMode === "preview" && !hasPreview\s*\? "source"/);
});

test("markdown table tokens stay inline despite Tailwind's table utility", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      SyntaxHighlighter,
      { language: "markdown" },
      "| Name | Desc |\n| --- | --- |\n| A | first |",
    ),
  );

  assert.match(html, /class="token table[ "]/);
  assert.match(cssSource, /span\.token\.table\s*\{[^}]*display:\s*inline;/);
});

test("a CSV/TSV preview is its table and a binary file offers only its download (F1, F3)", async () => {
  const source = (await readFile(new URL("./FileViewer.tsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  assert.match(source, /isDelimitedTable && effectiveDisplayMode === "preview" \? \(\s*<DelimitedTable/);
  assert.match(source, /\) : isBinary \? \([\s\S]*?t\("files\.binaryNoPreview"\)[\s\S]*?getFileApiUrl\(filePath, "download", sourceSessionId\)/);
  // The wrap switch is for text only, and a wide line keeps its number in view.
  assert.match(source, /effectiveDisplayMode === "source" && !isBinary && \(/);
  assert.match(source, /lineNumberStyle=\{wrapLines \? FILE_LINE_NUMBER_STYLE : FILE_PINNED_LINE_NUMBER_STYLE\}/);
});
