import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");

test("does not autofocus the model filter on mobile", () => {
  // Autofocus would open the on-screen keyboard as soon as the picker opens.
  assert.match(source, /aria-label=\{t\("chat\.filterModels"\)\}[\s\S]*?autoFocus=\{!isMobile\}/);
  assert.doesNotMatch(source, /^\s*autoFocus\s*$/m);
});

test("groups show the provider's display name and the filter matches it, its id and provider/model (M4)", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
  const { filterModelOptions } = await jiti.import("./ModelSelector.tsx");
  const options = [
    { provider: "zai-coding-cn", providerName: "Z.AI Coding CN", modelId: "glm-5.3", name: "GLM-5.3" },
    { provider: "deepseek", providerName: "DeepSeek", modelId: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { provider: "aliyun-bailian", modelId: "qwen3.7-plus", name: "Qwen 3.7 Plus" },
  ];
  const ids = (query) => filterModelOptions(options, query).map((option) => option.modelId);
  assert.deepEqual(ids("z.ai coding"), ["glm-5.3"]);
  assert.deepEqual(ids("zai-coding-cn"), ["glm-5.3"]);
  assert.deepEqual(ids("aliyun-bailian/qwen"), ["qwen3.7-plus"]);
  assert.deepEqual(ids("deepseek"), ["deepseek-v4-pro"]);
  assert.match(source, /label: option\.providerName \|\| option\.provider/);
  assert.match(source, /\{group\.label\}/);
  assert.doesNotMatch(source, /textTransform: "uppercase"/);
});

test("the composer's picker hangs from its own button, never at a fixed viewport box", async () => {
  // On a phone the composer's control row is the strip the More button opens. That
  // strip animates with `translate`/`scale` and blurs its backdrop, and both make it
  // the containing block for a `position: fixed` descendant — so the picker's phone
  // rule (`left: 8; right: 8`, meant for the viewport) measured the strip's own ~200px
  // and the model list opened as a narrow column that cut every model name.
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
  const { COMPOSER_MODEL_MENU_WIDTH } = await jiti.import("../lib/composer-panel-placement.ts");
  const composer = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  // The panel renders from the pop transition's mounted flag, kept for the exit.
  const panel = source.slice(source.indexOf("{pop.mounted && anchorRect"));

  // The composer's model control opts in, and the panel it gets is absolute: the
  // placement engine hands back coordinates in the anchor's own space, so whichever
  // ancestor ends up the containing block, the box is the page's.
  const control = composer.slice(composer.indexOf("<ModelSelector"), composer.indexOf("  // A virtual model routes each request"));
  assert.ok(control.length > 100, "the composer's model control is in ChatInput");
  assert.match(control, /composerAnchored/, "it passes composerAnchored");
  assert.ok(control.indexOf("iconOnly") < control.indexOf("composerAnchored"),
    "the icon-only chip is the composer's model control");
  assert.match(panel, /composerAnchored\s*\n?\s*\? \{\s*position: "absolute",\s*\.\.\.\(openAbove \? \{ bottom: "calc\(100% \+ 6px\)" \}/,
    "the composer's panel is absolute, hanging above the chip that opened it");
  assert.ok(panel.indexOf('position: "absolute"') < panel.indexOf('position: "fixed"'),
    "the fixed box stays the non-composer path only");
  assert.match(panel, /composerPanelAnchoring\(rootRef\.current, COMPOSER_MODEL_MENU_WIDTH, \{ alignLeft: isMobile \}\)/);

  // A phone gets the whole page: the width asked for is wider than a phone, so the
  // placement clamps to the box, and the panel is no longer a column of truncated names.
  const { placeComposerPanel, COMPOSER_PANEL_EDGE_GUTTER } = await jiti.import("../lib/composer-panel-placement.ts");
  const page = 440;
  const bounds = { left: COMPOSER_PANEL_EDGE_GUTTER, right: page - COMPOSER_PANEL_EDGE_GUTTER };
  const placed = placeComposerPanel({ left: 18, right: 50 }, COMPOSER_MODEL_MENU_WIDTH, bounds, { alignLeft: true });
  assert.equal(placed.width, page - 2 * COMPOSER_PANEL_EDGE_GUTTER, "as much of the screen width as can be shown");
  assert.ok(placed.width > 4 * 50, "many times the 200px the strip used to impose");
});
