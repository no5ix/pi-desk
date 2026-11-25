import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./SideChatIcon.tsx", import.meta.url), "utf8");

/** Every component in the app, so a retired glyph cannot hide in a file nobody read. */
function appComponents() {
  const dir = new URL("./", import.meta.url);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => [name, readFileSync(new URL(name, dir), "utf8")]);
}

test("one side-chat glyph, drawn once and imported everywhere", () => {
  // The app draws "side chat" in six places: the composer's button, the sidebar's leading
  // glyph, the header's family chip, the Agents panel's row head and its new-side-chat
  // button, a right-panel tab, and the quote bar's ask-in-a-side-chat button. They are one
  // shape, in one file; six copies of one path string is how the mark drifted apart before.
  const sites = {
    "ChatInput.tsx": "SideChatPlusIcon",
    "SessionSidebar.tsx": "SideChatPlusIcon",
    "TopbarSubagents.tsx": "SideChatGlyph",
    "AgentSessionPanel.tsx": "SideChatIcon",
    "TabBar.tsx": "SideChatIcon",
    "ChatWindow.tsx": "SideChatIcon",
  };
  for (const [file, name] of Object.entries(sites)) {
    const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(text, /from "\.\/SideChatIcon"/, `${file} takes the shared glyph`);
    assert.ok(text.includes(name), `${file} renders ${name}`);
  }
  // The panel names both: a bubble on the row, a bubble-plus on the button that opens one.
  assert.match(readFileSync(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8"),
    /import \{ SideChatIcon, SideChatPlusIcon \} from "\.\/SideChatIcon";/);
});

test("the retired circle-and-plus glyph is out of the app", () => {
  // The mark the user called ugly: a circle with a cut corner, its plus touching the rim.
  // It is gone from every component and from the fork's stylesheet, so a merge cannot
  // leave one row wearing it while the rest of the app moved on.
  const retired = [/1\.4-3\.4/, /M13 8\.5v7/, /M9\.5 12h7/];
  for (const [name, text] of appComponents()) {
    for (const pattern of retired) {
      assert.ok(!pattern.test(text), `${name} still draws the retired glyph (${pattern})`);
    }
  }
  for (const sheet of ["../app/native-theme.css", "../app/globals.css"]) {
    const css = readFileSync(new URL(sheet, import.meta.url), "utf8");
    for (const pattern of retired) {
      assert.ok(!pattern.test(css), `${sheet} still carries the retired glyph (${pattern})`);
    }
  }
});

test("the bubble is the square chat bubble with a plus centred in its body", () => {
  // The shape the user picked: a square bubble, rounded corners, tail at the bottom left,
  // plus centred in the body (lucide's `message-square-plus`). The square is what keeps it
  // off the plain session bubble, which is a circle.
  assert.match(source, /export const SIDE_CHAT_BUBBLE = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";/);
  assert.match(source, /export const SIDE_CHAT_PLUS = "M12 7v6M9 10h6";/, "the plus sits in the body, not at the rim");
  assert.match(source, /strokeLinecap="round"\n\s*strokeLinejoin="round"/, "the round caps the app's other glyphs use");
  assert.match(source, /aria-hidden="true"/, "the glyph is decoration; the labels carry the words");
  assert.match(source, /stroke = "currentColor"/, "it colours with the row it sits in");
});

test("both variants render, and only the plus variant adds the plus", async () => {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
  const React = await jiti.import("react");
  const { renderToStaticMarkup } = await jiti.import("react-dom/server");
  const { SideChatIcon, SideChatPlusIcon } = await jiti.import("./SideChatIcon.tsx");

  const plain = renderToStaticMarkup(React.createElement(SideChatIcon, { size: 12 }));
  const plus = renderToStaticMarkup(React.createElement(SideChatPlusIcon, { size: 12 }));
  assert.equal((plain.match(/<path/g) ?? []).length, 1, "the bubble alone");
  assert.equal((plus.match(/<path/g) ?? []).length, 2, "the bubble and the plus");
  for (const html of [plain, plus]) {
    assert.match(html, /width="12" height="12" viewBox="0 0 24 24"/, "one 24-unit grid at every size");
    assert.match(html, /aria-hidden="true"/);
  }
});
