import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

/**
 * The composer's geometry, measured.
 *
 * The card is one row on every platform: the `+`, the prompt, the session controls, Send.
 * The resting card is one line tall — the text's line and the two round controls that
 * bracket it — and it grows downward as the prompt wraps, with the controls pinned to the
 * text's bottom edge. The corner that opens the tall editor is not part of the resting
 * card: it arrives with the second line, in the card's upper-left.
 *
 * What is measured, at every supported chat font size and in both pointer tiers:
 *  - the row is one row (the controls share one line, the prompt sits on it), the `+` is
 *    the row's first control and Send its last, and nothing crosses the card's edge;
 *  - the row is the 80% card the ask is about: the disc, the `+` and the card's height all
 *    follow `--composer-send-size` / `--composer-inset`, and the arc that meets Send's
 *    center keeps its arithmetic as the card grows;
 *  - the ink lines up, not only the boxes: the prompt's first character, the `+` glyph, the
 *    `/ @ #` hint's last character, Send's arrow;
 *  - the corner: absent on a one-line card, in the upper-right with the text clear of it
 *    once the prompt has a second line.
 */
export async function checkComposerGeometry(page, { cornerCapable = false } = {}) {
  await mkdir('test-results/ui-send', { recursive: true });
  const input = page.locator(".chat-input-textarea");
  const previousDraft = await input.inputValue();
  const card = page.locator('.chat-composer');
  const previousSize = await card.evaluate(el => el.style.getPropertyValue('--chat-content-font-size'));
  const heights = [];
  try {
    for (const size of [12, 14, 20, 24]) {
      await card.evaluate((el, size) => el.style.setProperty('--chat-content-font-size', `${size}px`), size);
      for (const draft of ['', '给 Pi 发消息…', 'First line\nSecond line\nThird line']) {
        await input.fill(draft);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        // The hint fades in (`opacity var(--dur-base)`), so read it after the fade lands.
        await page.waitForTimeout(220);
        const layout = await card.evaluate(el => {
          const rect = (node) => node.getBoundingClientRect();
          const text = el.querySelector('textarea');
          const cardBox = rect(el);
          const box = rect(text);
          const send = el.querySelector('.composer-send-button');
          const sendBox = rect(send);
          const plus = el.querySelector('.composer-attach-button, .composer-plus-button');
          const plusBox = plus ? rect(plus) : null;
          const corner = el.querySelector('.chat-composer-expand');
          const cardStyle = getComputedStyle(el);
          const inset = parseFloat(cardStyle.paddingLeft) + parseFloat(cardStyle.borderLeftWidth);
          const token = parseFloat(cardStyle.getPropertyValue('--composer-send-size'));
          const coarse = matchMedia('(pointer: coarse)').matches;
          // Buttons inside a popup (the phone's `+` menu, a strip above the row) are not in
          // the row; the ones in flow are.
          const inPopup = (button) => {
            let node = button.parentElement;
            while (node && node !== el) {
              const position = getComputedStyle(node).position;
              if (position === 'absolute' || position === 'fixed') return true;
              node = node.parentElement;
            }
            return false;
          };
          const inFlow = [...el.querySelectorAll('button')].filter((button) => !inPopup(button));
          const centres = inFlow.map((button) => {
            const r = rect(button);
            return r.y + r.height / 2;
          });
          const bottoms = inFlow.map((button) => rect(button).bottom);
          const textStyle = getComputedStyle(text);
          // Every option-menu control in the row (reasoning, tools, model) must be
          // icon-only: no words printed, the state carried in the title.
          const labelled = [...el.querySelectorAll('.chat-composer-controls button[aria-haspopup="listbox"]')]
            .map(b => ({
              name: b.getAttribute('aria-label') || 'control',
              text: b.textContent.trim(),
              title: b.getAttribute('title') || '',
            }));
          return {
            coarse,
            token,
            inset,
            sendWidth: sendBox.width,
            sendHeight: sendBox.height,
            plusWidth: plusBox ? plusBox.width : null,
            plusLeft: plusBox ? plusBox.left : null,
            plusTop: plusBox ? plusBox.top : null,
            textLeft: box.left + parseFloat(textStyle.paddingLeft) + parseFloat(textStyle.borderLeftWidth),
            textRight: box.right,
            textCenterY: box.y + box.height / 2,
            textHeight: box.height,
            textBottom: box.bottom,
            sendCenterY: sendBox.y + sendBox.height / 2,
            sendRight: sendBox.right,
            sendRightGap: cardBox.right - inset - sendBox.right,
            cardHeight: cardBox.height,
            cardLeft: cardBox.left,
            cardTop: cardBox.top,
            rowSpread: centres.length ? Math.max(...centres) - Math.min(...centres) : 99,
            bottomSpread: bottoms.length ? Math.max(...bottoms) - Math.min(...bottoms) : 99,
            flowCount: inFlow.length,
            corner: corner ? {
              rightGap: cardBox.right - rect(corner).right,
              topGap: rect(corner).top - cardBox.top,
              w: rect(corner).width,
              label: corner.getAttribute('aria-label') || '',
            } : null,
            taPadLeft: parseFloat(textStyle.paddingLeft),
            taPadRight: parseFloat(textStyle.paddingRight),
            stacked: el.querySelector('.chat-composer-editor')?.dataset.stacked === 'true',
            placeholderLine: parseFloat(getComputedStyle(text, '::placeholder').lineHeight),
            line: parseFloat(textStyle.lineHeight),
            overflow: text.scrollHeight - text.clientHeight,
            // A card taller than its first line is a control in the row that outgrows the
            // disc; the message names it, because that is the whole point of the rule.
            tall: [...el.querySelectorAll('.chat-composer-editor *')]
              .filter((node) => node.getBoundingClientRect().height > Math.max(sendBox.width, parseFloat(textStyle.lineHeight)) + 2)
              .map((node) => `${node.tagName.toLowerCase()}.${(node.className || '').toString().split(' ').slice(0, 2).join('.')}=${node.getBoundingClientRect().height.toFixed(1)}`)
              .slice(0, 6),
            labelled,
          };
        });
        // One row, on every tier: the controls share one line, and the prompt rides it.
        assert.ok(layout.flowCount >= 2, `The row holds the \`+\` and Send at ${size}px: ${layout.flowCount}`);
        assert.ok(layout.rowSpread <= 2, `Every control in the row shares one line at ${size}px: spread ${layout.rowSpread}`);
        assert.ok(layout.bottomSpread <= 2, `The row's controls sit on one bottom edge at ${size}px: ${layout.bottomSpread}`);
        const textHeight = (layout.textBottom - layout.textCenterY) * 2;
        const multiline = textHeight > layout.line * 1.8;
        if (multiline) {
          // Past one line the card is STACKED: the text is the card's block at its whole width
          // and the `+` and Send keep a row of their own under it (the ask: the typing happens
          // in the red frame, and the band between the two controls is not the field). The two
          // controls still share one line and one bottom edge — asserted above — with Send in
          // the card's bottom-right arc.
          assert.ok(layout.stacked, `A prompt with a second line is the stacked card at ${size}px`);
          assert.ok(layout.sendCenterY > layout.textBottom,
            `The \`+\` and Send keep a row under the text at ${size}px: Send's centre ${Math.round(layout.sendCenterY)}, the text ends ${Math.round(layout.textBottom)}`);
        } else {
          // One row means the disc's center lies inside the text's own vertical band: the
          // two are on the same line, whichever of them is the taller (a 24px chat font
          // makes the text's line box taller than the disc, and the disc rides the bottom).
          const textTop = layout.textCenterY - layout.textHeight / 2;
          const textBottom = layout.textCenterY + layout.textHeight / 2;
          assert.ok(layout.sendCenterY >= textTop - 1 && layout.sendCenterY <= textBottom + 1,
            `The prompt and Send share one line at ${size}px: Send at ${layout.sendCenterY} of ${textTop}..${textBottom}`);
          // The resting card is one row: the row's tallest item — the text's own line box
          // (its `line-height` plus the text area's UA padding) or the disc, whichever is
          // taller — and the card's band. A control in the row that outgrows both grows the
          // card past one row, and the message names it.
          const firstLine = Math.max(layout.sendWidth, layout.textHeight);
          assert.ok(layout.cardHeight <= firstLine + layout.inset * 2 + 3,
            `One line, one row: the card is the first line plus its band at ${size}px (${layout.cardHeight} of ${firstLine + layout.inset * 2}; tallest in the row ${JSON.stringify(layout.tall)})`);
        }
        // The `+` is the row's first control, Send its last, and the text is between them.
        assert.ok(layout.plusLeft !== null, `The \`+\` is in the card at ${size}px`);
        assert.ok(layout.plusLeft >= layout.cardLeft + layout.inset - 0.5,
          `The \`+\` starts at the card's own inset at ${size}px: ${layout.plusLeft}`);
        assert.ok(layout.textLeft > layout.plusLeft, `The \`+\` stands before the prompt at ${size}px`);
        assert.ok(layout.textLeft - layout.plusLeft <= layout.sendWidth + 12,
          `The prompt starts beside the \`+\` disc, not across the card at ${size}px: ${layout.textLeft - layout.plusLeft}`);
        assert.ok(layout.sendRightGap <= 0.5, `Send keeps the card's right edge at ${size}px: ${layout.sendRightGap}`);
        // The row's size is the disc the ask is about: 80% of the card this row was (29px),
        // with a finger's tier keeping its 44px touch target. The `+` and Send are cut from
        // the same number, so the row is one line of one height.
        const expected = layout.coarse ? 44 : 28.8;
        assert.ok(Math.abs(layout.sendWidth - expected) < 0.6 && Math.abs(layout.sendHeight - expected) < 0.6,
          `Send is the row's ${expected}px disc for this pointer at ${size}px: ${layout.sendWidth}x${layout.sendHeight}`);
        assert.ok(Math.abs(layout.plusWidth - expected) < 0.6,
          `The \`+\` is Send's twin at ${size}px: ${layout.plusWidth} of ${expected}`);
        // The text is the row's filler: it never crosses the card. The right-edge rule is
        // measured below (`chrome.textRightGap`, `chrome.sendLeftGap`).
        for (const control of layout.labelled) {
          assert.equal(control.text, "", `The ${control.name} button is icon-only at ${size}px`);
          assert.ok((control.title || "").length > 0, `The ${control.name} button names its state in the title at ${size}px`);
        }
        // The row's ink edges, not only its boxes: the `+` glyph's left, the prompt's first
        // character, the hint's last character, Send's arrow. The discs paint no disc, so
        // the only ink in them is the glyph, and the ink is what the eye compares.
        const ink = await card.evaluate((el) => {
          const box = (n) => n ? n.getBoundingClientRect() : null;
          const text = el.querySelector("textarea");
          const ts = getComputedStyle(text);
          const plus = el.querySelector(".composer-attach-button > svg, .composer-plus-button > svg");
          const send = el.querySelector(".composer-send-button > svg");
          const hint = el.querySelector(".composer-trigger-hint");
          const cluster = el.querySelector(".chat-composer-controls");
          const clusterBox = cluster ? cluster.getBoundingClientRect() : null;
          return {
            textLeft: box(text).left + parseFloat(ts.paddingLeft) + parseFloat(ts.borderLeftWidth),
            plusLeft: plus ? box(plus).left : null,
            plusGlyphWidth: plus ? box(plus).width : null,
            sendRight: send ? box(send).right : null,
            hintInkRight: hint ? box(hint).right : null,
            clusterLeft: clusterBox && clusterBox.width > 0 ? clusterBox.left : null,
          };
        });
        if (ink.plusLeft !== null) {
          // The `+` is centered in its disc, so its glyph's left edge sits inside the disc;
          // the prompt starts after the disc. What is forbidden is the prompt crowding the
          // glyph (the text on top of the `+`) or drifting a window's width away from it.
          // The `+` is centered in its disc (the disc paints nothing, the glyph is its ink),
          // and the prompt starts after the disc. What is forbidden is the prompt crowding
          // the glyph, or drifting a window's width away from it.
          const discInset = (layout.sendWidth - ink.plusGlyphWidth) / 2;
          assert.ok(ink.plusLeft >= layout.plusLeft + discInset - 1 && ink.plusLeft <= layout.plusLeft + discInset + 1,
            `The \`+\` glyph stays centered in its disc at ${size}px: ${ink.plusLeft}`);
          assert.ok(ink.textLeft > ink.plusLeft + 4 && ink.textLeft - ink.plusLeft <= layout.sendWidth + 10,
            `The prompt follows the \`+\` glyph, clear of it, at ${size}px: ${ink.textLeft} after ${ink.plusLeft}`);
        }
        if (ink.hintInkRight !== null) {
          // The `/ @ #` hint is the row's own item between the prompt and the controls, so
          // its last character stops before the first glyph — it used to be an absolute
          // overlay ending at Send's disc, and in a one-row card that put the sentence
          // under the model and reasoning glyphs.
          if (ink.clusterLeft !== null) {
            assert.ok(ink.hintInkRight <= ink.clusterLeft + 1,
              `The \`/ @ #\` hint stays clear of the row's controls at ${size}px: ${ink.hintInkRight} of ${ink.clusterLeft}`);
          }
          assert.ok(ink.hintInkRight > ink.textLeft,
            `and it sits to the right of the prompt at ${size}px: ${ink.hintInkRight} after ${ink.textLeft}`);
        }
        assert.ok(Math.abs(layout.placeholderLine - layout.line) < 0.1, 'Placeholder must use the actual text line height');
        if (!draft) assert.ok(layout.overflow <= 1, `Empty input must not have a vertical scrollbar at ${size}px / ${page.viewportSize().width}px: ${JSON.stringify(layout)}`);
        // The corner is not part of the resting card. It arrives with the line PAST THREE, in
        // the card's UPPER-RIGHT, on Send's vertical line, at an equal inset from the card's
        // top and right edges, and only the text's FIRST line stops short of it (the field's
        // `padding-right`, never a padding band above the box the user cannot type in).
        // components/ChatInput.tsx measures the lines; lib/composer-textarea-height.ts
        // releases the box at the one-row width to do it.
        const cornerChrome = await card.evaluate((el) => {
          const corner = el.querySelector('.chat-composer-expand');
          const cardBox = el.getBoundingClientRect();
          if (!corner) return { present: false };
          const b = corner.getBoundingClientRect();
          return {
            present: true,
            rightGap: cardBox.right - b.right,
            topGap: b.top - cardBox.top,
            width: b.width,
            expanded: el.classList.contains('is-expanded'),
          };
        });
        const hasCornerLine = cornerCapable && draft.split('\n').length > 3;
        if (hasCornerLine) {
          assert.ok(cornerChrome.present, `A prompt past three lines raises the corner at ${size}px`);
          assert.ok(Math.abs(cornerChrome.rightGap - cornerChrome.topGap) < 1,
            `The corner keeps the same distance to the card's top edge as to its right edge at ${size}px: ${cornerChrome.topGap.toFixed(1)} / ${cornerChrome.rightGap.toFixed(1)}`);
          assert.ok(cornerChrome.rightGap >= 4 && cornerChrome.rightGap <= 20,
            `The corner sits on Send's vertical line at ${size}px: ${Math.round(cornerChrome.rightGap)}px in`);
          assert.ok(layout.taPadRight >= 34,
            `The text's FIRST line stops short of the corner (the field's padding-right, never a band above the box) at ${size}px: ${layout.taPadRight}`);
        } else {
          assert.equal(cornerChrome.present, false, `A prompt of three lines or fewer shows no corner at ${size}px`);
        }
        // No "clear" button, the text stays inside the card, and the `/ @ #` hint — shown
        // only on a wide, idle, empty card — never outlives the text.
        const chrome = await card.evaluate((el) => {
          const hint = el.querySelector('.composer-trigger-hint');
          const text = el.querySelector('textarea');
          const cardBox = el.getBoundingClientRect();
          const textRightGap = cardBox.right - text.getBoundingClientRect().right;
          const sendBox = el.querySelector('.composer-send-button').getBoundingClientRect();
          const sendLeftGap = sendBox.left - text.getBoundingClientRect().right;
          const clear = el.querySelectorAll('.composer-clear-button:not(.composer-side-chat-button)').length;
          if (!hint) return { present: false, textRightGap, sendLeftGap, clear };
          const hb = hint.getBoundingClientRect();
          const tb = text.getBoundingClientRect();
          const cluster = el.querySelector('.chat-composer-controls');
          const clusterBox = cluster ? cluster.getBoundingClientRect() : null;
          return {
            present: true,
            opacity: getComputedStyle(hint).opacity,
            centerDelta: (hb.top + hb.bottom) / 2 - (tb.top + tb.bottom) / 2,
            rightGap: clusterBox && clusterBox.width > 0 ? clusterBox.left - hb.right : Infinity,
            textRightGap,
            sendLeftGap,
            clear,
          };
        });
        assert.equal(chrome.clear, 0, `No clear button in the card at ${size}px`);
        assert.ok(chrome.textRightGap >= -0.5, `The text stays inside the card at ${size}px: ${chrome.textRightGap}`);
        assert.ok(chrome.sendLeftGap >= 0, `The text ends before Send's disc at ${size}px: ${chrome.sendLeftGap}`);
        if (page.viewportSize().width >= 700) {
          // A phone folds these into the `+` menu, so only the wide passes can demand the
          // option menus are in the row.
          assert.ok(layout.labelled.length >= 2, `Reasoning and tools are in the row at ${size}px: ${JSON.stringify(layout.labelled)}`);
          if (draft) {
            assert.equal(chrome.present, false, `The trigger hint leaves once there is text (${size}px)`);
          } else if (chrome.present) {
            assert.ok(Number(chrome.opacity) > 0.9, `The hint is readable while the empty card is focused at ${size}px: ${chrome.opacity}`);
            assert.ok(Math.abs(chrome.centerDelta) < 5,
              `The hint sits on the placeholder's row at ${size}px: ${chrome.centerDelta}px off its centre`);
            assert.ok(chrome.rightGap >= 0,
              `The hint ends before the controls begin at ${size}px: ${chrome.rightGap}`);
          }
        }
        if (size === 14) {
          const theme = await page.locator('html').evaluate(el => el.classList.contains('dark') ? 'dark' : 'light');
          const width = page.viewportSize().width;
          await card.screenshot({ path: `test-results/ui-send/composer-alignment-${theme}-${width}-${draft.includes('\n') ? 'multiline' : draft ? 'text' : 'empty'}.png` });
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

    // The project a new session picks, and the branch of it, are not in the card: they are
    // the row under it. A card that carries a chip is a card with a second band of chrome,
    // which is the thing the ask took out.
    const pickers = await page.evaluate(() => {
      const card = document.querySelector(".chat-composer");
      const row = document.querySelector(".composer-context-row");
      const chips = [...document.querySelectorAll(".chat-project-context")];
      const wrap = document.querySelector(".chat-composer-wrap");
      return {
        chipCount: chips.length,
        cardHasChip: Boolean(card?.querySelector(".chat-project-context")),
        cardBottom: card ? card.getBoundingClientRect().bottom : null,
        row: row ? {
          top: row.getBoundingClientRect().top,
          chips: row.querySelectorAll(".chat-project-context").length,
          inWrap: Boolean(wrap?.contains(row)),
        } : null,
      };
    });
    if (pickers.chipCount > 0) {
      assert.equal(pickers.cardHasChip, false, "the card carries no project chip: the card is the row");
      assert.ok(pickers.row?.inWrap, "the pickers' row is the wrap's, under the card");
      assert.equal(pickers.row.chips, pickers.chipCount, "every project picker sits in the row under the card");
      assert.ok(pickers.row.top >= pickers.cardBottom - 1, "the row is below the card, not beside it");
    }
  } finally {
    await card.evaluate((el, size) => size ? el.style.setProperty('--chat-content-font-size', size) : el.style.removeProperty('--chat-content-font-size'), previousSize);
    await input.fill(previousDraft);
  }
}
