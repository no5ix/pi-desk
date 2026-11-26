import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { webkit } from "playwright";

/**
 * The composer on the phone's engine: WebKit, 390px, keyboard open.
 *
 * The user's screenshot was mobile Safari, where the composer "was total broken": the
 * card's control row packed every control to the left, Send included, with a wide empty
 * band beside it. The cause is the phone's keyboard rule —
 * `html[data-keyboard-open] .chat-composer-controls { display: none }` — which removes
 * the row's flex filler; the row then packs, and Send leaves the card's bottom-right
 * corner it is meant to sit concentric with. Chromium's mobile emulation is not enough
 * to catch layout that only WebKit shows, so this runs WebKit.
 *
 * The fixture mirrors the composer's structure and inline styles; the check asserts that
 * mirror against ChatInput's source, so a fixture that drifts measures nothing.
 */
const out = "test-results/composer-ios";
await mkdir(out, { recursive: true });
await build({
  entryPoints: ["e2e/composer-ios.fixture.jsx"],
  bundle: true,
  platform: "browser",
  outfile: `${out}/fixture.js`,
  jsx: "automatic",
  alias: { "@": process.cwd() },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
const js = await readFile(`${out}/fixture.js`);
const css = (await Promise.all(["app/globals.css", "app/settings.css", "app/native-theme.css"]
  .map((path) => readFile(path, "utf8")))).map((text) => text.replace(/^@import[^;]*;/gm, "")).join("\n");

const server = createServer((req, res) => {
  if (req.url === "/fixture.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(js);
    return;
  }
  if (req.url === "/styles.css") {
    res.setHeader("Content-Type", "text/css");
    res.end(css);
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head>
<body style="margin:0;background:var(--bg)"><div id="root"></div><script src="/fixture.js"></script></body></html>`);
});

const chatInput = await readFile("components/ChatInput.tsx", "utf8");
for (const needle of [
  'className="chat-composer-editor"',
  'data-inline={compact ? undefined : "true"}',
  'flexDirection: compact ? "column" : "row",',
  'alignItems: compact ? "stretch" : "flex-end",',
  'className="chat-input-textarea"',
  'flex: compact ? "none" : "1 1 auto",',
  'className="chat-composer-actions"',
  'className="native-toolbar-button composer-attach-button"',
  'className="chat-composer-controls"',
  'className="composer-side-chat-button"',
  'composer-send-button',
]) {
  assert.ok(chatInput.includes(needle), `the composer ships ${needle}; the fixture must mirror it`);
}

const measure = () => {
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, left: b.left, bottom: b.bottom };
  };
  const card = document.querySelector(".chat-composer");
  const actions = document.querySelector(".chat-composer-actions");
  const style = getComputedStyle(card);
  const inset = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
  const insetRight = parseFloat(style.paddingRight) + parseFloat(style.borderRightWidth);
  const send = document.querySelector(".composer-send-button");
  const sendStyle = getComputedStyle(send);
  return {
    keyboard: document.documentElement.dataset.keyboardOpen ?? null,
    card: rect(card),
    editor: rect(document.querySelector(".chat-composer-editor")),
    textarea: rect(document.querySelector(".chat-input-textarea")),
    textareaMargin: (() => {
      const s = getComputedStyle(document.querySelector(".chat-input-textarea"));
      return { left: parseFloat(s.marginLeft), right: parseFloat(s.marginRight) };
    })(),
    editorPad: (() => {
      const s = getComputedStyle(document.querySelector(".chat-composer-editor"));
      return { left: parseFloat(s.paddingLeft) + parseFloat(s.borderLeftWidth), right: parseFloat(s.paddingRight) + parseFloat(s.borderRightWidth) };
    })(),
    actions: rect(actions),
    plus: (() => {
      const el = document.querySelector(".composer-plus-button, .composer-attach-button");
      return el ? rect(el) : null;
    })(),
    controls: (() => {
      const el = document.querySelector(".chat-composer-controls");
      return { ...rect(el), display: getComputedStyle(el).display };
    })(),
    sideChat: (() => {
      const el = document.querySelector(".composer-side-chat-button");
      return { ...rect(el), display: getComputedStyle(el).display };
    })(),
    send: rect(send),
    sendRadius: sendStyle.borderRadius,
    sendSize: { w: send.getBoundingClientRect().width, h: send.getBoundingClientRect().height },
    inset, insetRight,
    scrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  };
};

const browser = await webkit.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector(".composer-send-button");

// A phone with the on-screen keyboard up is the state in the screenshot. The row used
// to lose its controls there — the fork hid the strip, and the composer kept only `+`
// and Send — so the keyboard state is measured against the resting one, control by
// control: the row keeps what it has, in the place it already had it.
const geometry = {};
for (const state of ["rest", "keyboard"]) {
  await page.evaluate((on) => {
    if (on) document.documentElement.setAttribute("data-keyboard-open", "true");
    else document.documentElement.removeAttribute("data-keyboard-open");
  }, state === "keyboard");
  await page.waitForTimeout(150);
  const m = await page.evaluate(measure);
  geometry[state] = m;
  const cardRightInner = m.card.right - m.insetRight;
  const cardLeftInner = m.card.left + m.inset;

  assert.ok(m.plus && m.plus.w > 0 && m.plus.h > 0, `${state}: the row's first control is the \`+\``);
  assert.ok(m.send.w > 0 && m.send.h > 0, `${state}: Send has a box`);
  // Send stays in the card's bottom-right corner, concentric with its arc.
  assert.ok(Math.abs(m.send.right - cardRightInner) <= 1.5,
    `${state}: Send is at the card's right edge (${Math.round(m.send.right)} of ${Math.round(cardRightInner)})`);
  assert.ok(Math.abs(m.send.bottom - m.card.bottom + m.insetRight) <= 2,
    `${state}: Send sits on the card's bottom edge (${Math.round(m.send.bottom)} of ${Math.round(m.card.bottom)})`);
  assert.ok(Math.abs(m.sendSize.w - m.sendSize.h) < 0.6, `${state}: Send stays circular`);
  // The row is not packed into the middle of the card: it starts at the card's inset, with
  // the text in its own column between the `+` and Send.
  assert.ok(m.plus.left >= cardLeftInner - 1.5, `${state}: the row starts at the card's inset`);
  assert.ok(m.textarea.left >= m.plus.right - 0.5 && m.textarea.right <= m.send.left + 0.5,
    `${state}: the text keeps its column, the \`+\` to its left and Send to its right`);
  // The text area is inside the card, and as wide as the box it is stretched in. That
  // box is `.chat-composer-editor`'s content: the card's padding, then 4px of editor
  // padding on the left (the card's own inset), so measuring against the card's box
  // would demand 4px that belongs to the editor. The textarea's own horizontal margin is
  // part of the inset too — it is stretched (`width: auto`), so a margin can only inset,
  // and the left one (half the send disc less 10px) is what stands the text's ink on the
  // `+` glyph's edge. Counted here, the check still catches the bug it was written for: a
  // text box wider than the box it is stretched in, which crossed the card's right edge.
  const editorStyle = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector(".chat-composer-editor"));
    return { paddingLeft: parseFloat(s.paddingLeft), paddingRight: parseFloat(s.paddingRight), borderLeft: parseFloat(s.borderLeftWidth), borderRight: parseFloat(s.borderRightWidth) };
  });
  const editorLeft = m.editor.left + editorStyle.paddingLeft + editorStyle.borderLeft;
  const editorRight = m.editor.right - editorStyle.paddingRight - editorStyle.borderRight;
  const contentWidth = editorRight - editorLeft - m.textareaMargin.left - m.textareaMargin.right;
  assert.ok(m.textarea.right <= editorRight + 0.5,
    `${state}: the text area does not pass the card's right edge (${Math.round(m.textarea.right)} of ${Math.round(editorRight)})`);
  // The text is the row's filler: it never outgrows the card's content box, and it is not
  // the browser's 20-character default left under the controls.
  assert.ok(m.textarea.w <= contentWidth + 1,
    `${state}: the text stays inside the card's content (${Math.round(m.textarea.w)} of ${Math.round(contentWidth)})`);
  assert.ok(m.textarea.w >= contentWidth * 0.35,
    `${state}: the text fills the row, not a 20-character box (${Math.round(m.textarea.w)} of ${Math.round(contentWidth)})`);
  assert.ok(m.scrollWidth <= m.viewport, `${state}: the page does not scroll sideways (${m.scrollWidth} of ${m.viewport})`);

  if (state === "keyboard") {
    // The row is whole under the keyboard: the session controls keep their box, the
    // side-chat bubble keeps its own, and neither moves.
    assert.notEqual(m.controls.display, "none", "the keyboard hides no session control");
    assert.ok(m.controls.w > 0 && m.controls.h > 0, `the session controls keep a box (${Math.round(m.controls.w)}×${Math.round(m.controls.h)})`);
    assert.ok(m.sideChat.w > 0 && m.sideChat.h > 0, `the side-chat bubble keeps a box (${Math.round(m.sideChat.w)}×${Math.round(m.sideChat.h)})`);
    for (const part of ["controls", "sideChat", "send"]) {
      const rest = geometry.rest[part];
      for (const axis of ["x", "y", "w"]) {
        assert.ok(Math.abs(m[part][axis] - rest[axis]) <= 1.5,
          `the keyboard leaves the ${part}'s ${axis} alone (${Math.round(m[part][axis])} of ${Math.round(rest[axis])})`);
      }
    }
    await page.screenshot({ path: `${out}/keyboard.png`, clip: { x: 0, y: Math.max(0, m.card.y - 8), width: 390, height: m.card.h + 16 } });
    // The control pass: the corner is bought, not given. Two rules put Send where it is —
    // the prompt's fill (`flex: 1 1 auto`, the row's only filler) and Send's
    // `margin-left: auto` — so narrow the prompt, take the auto margin, and hide the
    // controls that would otherwise fill the row. Without this, the checks above could pass
    // on a card whose row simply happens to be full.
    await page.addStyleTag({ content: [
      ".chat-composer-editor[data-inline] > .chat-input-textarea { flex: 0 0 auto !important; width: 40px !important; }",
      ".chat-composer-actions > .chat-composer-controls, .chat-composer-actions > .composer-side-chat-button { display: none !important; }",
      ".chat-composer-actions > .composer-send-button { margin-left: 0 !important; }",
    ].join(" ") });
    await page.waitForTimeout(120);
    const loose = await page.evaluate(measure);
    const gap = cardRightInner - loose.send.right;
    assert.ok(gap > 24, `the control pass: without the prompt's fill and the auto margin, Send drifts ${Math.round(gap)}px from the corner`);
    await page.screenshot({ path: `${out}/keyboard-broken.png`, clip: { x: 0, y: Math.max(0, m.card.y - 8), width: 390, height: m.card.h + 16 } });
    await page.evaluate(() => {
      for (const node of document.querySelectorAll("style")) {
        if (node.textContent.includes("chat-input-textarea") || node.textContent.includes("composer-send-button")) node.remove();
      }
    });
    await page.waitForTimeout(120);
    const back = await page.evaluate(measure);
    assert.ok(Math.abs(back.send.right - cardRightInner) <= 1.5, "and the rule put back brings Send to the corner");
  }
}

// Typing grows the card, and the row keeps the corner with the text above it.
await page.locator(".chat-input-textarea").fill("remove this button in the chat composer djfhhfdjsjd. dddcc dxhdjdnnndhhsjs");
await page.waitForTimeout(200);
const typed = await page.evaluate(measure);
const rest = await page.evaluate(measure);
assert.ok(typed.card.h > 0 && typed.textarea.h > 0, "the card holds the typed text");
assert.ok(Math.abs(typed.send.right - (typed.card.right - typed.insetRight)) <= 1.5,
  `a filled composer keeps Send in the corner (${Math.round(typed.send.right)} of ${Math.round(typed.card.right - typed.insetRight)})`);
assert.ok(typed.textarea.right <= typed.card.right - typed.insetRight + 0.5, "the typed text stays inside the card");
// The text is the row's filler: it keeps the card's content width less the controls, and a
// box wider than that content box is the overflow this check exists for.
const typedContentWidth = typed.editor.w - typed.editorPad.left - typed.editorPad.right
  - typed.textareaMargin.left - typed.textareaMargin.right;
assert.ok(typed.textarea.w <= typedContentWidth + 1 && typed.textarea.w >= typedContentWidth * 0.35,
  `the typed text keeps the card's width (${Math.round(typed.textarea.w)} of ${Math.round(typedContentWidth)})`);
await page.screenshot({ path: `${out}/typed.png`, clip: { x: 0, y: Math.max(0, typed.card.y - 8), width: 390, height: typed.card.h + 16 } });
assert.equal(rest.scrollWidth <= rest.viewport, true, "no sideways scroll with a long draft");

await browser.close();
server.close();
console.log("PASS: WebKit 390px — the composer's row keeps Send in the card's corner with the keyboard open, and the text stays inside the card (the control pass moved Send off it)");
