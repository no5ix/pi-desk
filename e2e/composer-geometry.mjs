import assert from "node:assert/strict";
import {mkdir} from 'node:fs/promises';

export async function checkComposerGeometry(page) {
  await mkdir('test-results/ui-send', {recursive:true});
  const input = page.locator(".chat-input-textarea");
  const previousDraft = await input.inputValue();
  const card = page.locator('.chat-composer');
  const previousSize = await card.evaluate(el => el.style.getPropertyValue('--chat-content-font-size'));
  const heights = [];
  try {
    // The text area owns the card's whole width and every control shares one row
    // under it. Across the supported font sizes: the row is one row, the text is a
    // full-width block above it, the control buttons print no words, and an empty
    // box never grows a scrollbar.
    for (const size of [12, 14, 20, 24]) {
      await card.evaluate((el, size) => el.style.setProperty('--chat-content-font-size', `${size}px`), size);
      for (const draft of ['', '给 Pi 发消息…', 'First line\nSecond line\nThird line']) {
        await input.fill(draft);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const layout = await card.evaluate(el => {
          const text = el.querySelector('textarea');
          const actions = el.querySelector('.chat-composer-actions');
          const cardBox = el.getBoundingClientRect();
          const box = text.getBoundingClientRect();
          const rowBox = actions.getBoundingClientRect();
          const cardStyle = getComputedStyle(el);
          const editorStyle = getComputedStyle(el.querySelector('.chat-composer-editor'));
          const inset = parseFloat(cardStyle.paddingLeft) + parseFloat(cardStyle.borderLeftWidth);
          // Buttons inside a popup (the phone's More strip floats above the row on an
          // absolutely positioned cell) are not in the row; the ones in flow are.
          const inPopup = (button) => {
            let node = button.parentElement;
            while (node && node !== actions) {
              const position = getComputedStyle(node).position;
              if (position === 'absolute' || position === 'fixed') return true;
              node = node.parentElement;
            }
            return false;
          };
          const centres = [...actions.querySelectorAll('button')]
            .filter((button) => !inPopup(button))
            .map((button) => {
              const r = button.getBoundingClientRect();
              return r.y + r.height / 2;
            });
          // Every option-menu control in the row (reasoning, tools, model) must be
          // icon-only: no words printed, the state carried in the title.
          const labelled = [...actions.querySelectorAll('.chat-composer-controls button[aria-haspopup="listbox"]')]
            .map(b => ({
              name: b.getAttribute('aria-label') || 'control',
              text: b.textContent.trim(),
              title: b.getAttribute('title') || '',
            }));
          return {
            widthGap: cardBox.width - box.width - inset * 2
              - parseFloat(editorStyle.paddingLeft) - parseFloat(editorStyle.paddingRight),
            rowSpread: centres.length ? Math.max(...centres) - Math.min(...centres) : 99,
            flowCount: centres.length,
            textAboveRow: box.bottom <= rowBox.top + 0.5,
            placeholderLine: parseFloat(getComputedStyle(text, '::placeholder').lineHeight),
            line: parseFloat(getComputedStyle(text).lineHeight),
            overflow: text.scrollHeight - text.clientHeight,
            labelled,
          };
        });
        assert.ok(Math.abs(layout.widthGap) < 1, `The text area spans the card at ${size}px: ${JSON.stringify(layout)}`);
        assert.ok(layout.rowSpread < 1, `Attach, the controls and Send share one row at ${size}px: spread ${layout.rowSpread}`);
        assert.ok(layout.flowCount >= 2, `The row holds at least the attach button and Send at ${size}px: ${layout.flowCount}`);
        assert.ok(layout.textAboveRow, `The text sits above the control row at ${size}px: ${JSON.stringify(layout)}`);
        if (page.viewportSize().width >= 700) {
          // A phone folds these into the More menu, so only the wide passes can
          // demand they are in the row. The model chip is not always there (a chat
          // session, an empty model list), the reasoning and tools controls are.
          assert.ok(layout.labelled.length >= 2, `Reasoning and tools are in the row at ${size}px: ${JSON.stringify(layout.labelled)}`);
        }
        for (const control of layout.labelled) {
          assert.equal(control.text, "", `The ${control.name} button is icon-only at ${size}px`);
          assert.ok((control.title || "").length > 0, `The ${control.name} button names its state in the title at ${size}px`);
        }
        assert.ok(Math.abs(layout.placeholderLine - layout.line) < 0.1, 'Placeholder must use the actual text line height');
        if (!draft) assert.ok(layout.overflow <= 1, `Empty input must not have a vertical scrollbar at ${size}px / ${page.viewportSize().width}px: ${JSON.stringify(layout)}`);
        if (size === 14) {
          const theme=await page.locator('html').evaluate(el=>el.classList.contains('dark')?'dark':'light');
          const width=page.viewportSize().width;
          await card.screenshot({path:`test-results/ui-send/composer-alignment-${theme}-${width}-${draft.includes('\n')?'multiline':draft?'text':'empty'}.png`});
        }
      }
    }
    await card.evaluate((el, size) => size ? el.style.setProperty('--chat-content-font-size', size) : el.style.removeProperty('--chat-content-font-size'), previousSize);
    for (const draft of ["Short draft", "First line\nSecond line\nThird line\nFourth line", "A long draft that wraps naturally. ".repeat(80), "Short again"]) {
      await input.fill(draft);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const geometry = await page.locator(".chat-composer").evaluate((card) => {
        const button = card.querySelector(".composer-send-button");
        const outer = card.getBoundingClientRect();
        const inner = button.getBoundingClientRect();
        const radius = parseFloat(getComputedStyle(card).borderBottomRightRadius);
        return {
          height: outer.height,
          width: inner.width,
          buttonHeight: inner.height,
          radius,
          dx: outer.right - radius - (inner.left + inner.width / 2),
          dy: outer.bottom - radius - (inner.top + inner.height / 2),
        };
      });
      assert.ok(Math.abs(geometry.width - geometry.buttonHeight) < 0.5, "Send must remain circular");
      assert.ok(Math.abs(geometry.dx) < 0.5, `Horizontal arc centers must coincide: ${JSON.stringify(geometry)}`);
      assert.ok(Math.abs(geometry.dy) < 0.5, `Vertical arc centers must coincide after resizing: ${JSON.stringify(geometry)}`);
      heights.push(geometry.height);
    }
    assert.ok(heights[1] > heights[0], "Newlines must grow the input card");
    assert.ok(heights[2] >= heights[1], "Wrapped text must preserve the geometry through the height limit");
    assert.ok(Math.abs(heights[3] - heights[0]) < 0.5, "Removing newlines must shrink the card back");
  } finally {
    await card.evaluate((el, size) => size ? el.style.setProperty('--chat-content-font-size', size) : el.style.removeProperty('--chat-content-font-size'), previousSize);
    await input.fill(previousDraft);
  }
}
