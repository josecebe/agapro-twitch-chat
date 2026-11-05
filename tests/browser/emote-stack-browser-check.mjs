import assert from 'node:assert/strict';
import { compileStyles } from '../../scripts/styles.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';

const browser = await browserSession();
try {
    const { css } = compileStyles();
    await browser.evaluate(`(() => {
        const style = document.createElement('style');
        style.textContent = ${JSON.stringify(css)};
        document.head.append(style);
        document.body.innerHTML = '<div id="chat"></div>';
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer']));
    const cases = await browser.evaluate(`(async () => {
        const asset = (ratio, zeroWidth = false) => ({
            src: 'data:image/svg+xml,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="' + ratio * 32 + '" height="32"/>'
            ), ratio, zeroWidth
        });
        const emotes = new Map([
            ['SAJ', asset(1)], ['SAJ2', asset(3, true)],
            ['WIDE', asset(4)], ['SMALL', asset(0.5, true)]
        ]);
        const renderer = new ChatWidget.Renderer(document.getElementById('chat'), {
            maxMessages:35, language:'en', showBadges:false, showSevenTVPaints:false,
            showSevenTVBadges:false, showSevenTVEmotes:true
        }, {listeners:new Set(), emote:token => emotes.get(token)}, {});
        const results = [];
        for (const preview of [false, true]) {
            for (const text of ['SAJ SAJ2 SOY ESE', 'WIDE SMALL SOY ESE', 'SAJ SAJ2 SMALL SOY ESE', 'SAJ2 SOY ESE']) {
                const node = document.createElement('span');
                node.style.whiteSpace = 'pre-wrap';
                if (preview) {
                    node.className = 'reply-preview';
                    renderer.previewText(node, text, node);
                } else {
                    renderer.body(node, text, '');
                }
                document.body.append(node);
                await Promise.all([...node.querySelectorAll('img')].map(img => img.decode()));
                const stack = node.querySelector('.emote-stack');
                const bounds = stack.getBoundingClientRect();
                const layers = [...stack.children].map(img => {
                    const rect = img.getBoundingClientRect();
                    return {left:rect.left, right:rect.right, width:rect.width, top:rect.top};
                });
                const range = document.createRange();
                range.selectNodeContents(node.lastChild);
                const trailing = range.getBoundingClientRect();
                results.push({text, preview, width:bounds.width, left:bounds.left, right:bounds.right,
                    layers, trailingLeft:trailing.left, stacks:node.querySelectorAll('.emote-stack').length});
                node.remove();
            }
        }
        // A stack must wrap as a single unit when the wider overlay cannot fit.
        const wrapped = document.createElement('div');
        wrapped.style.cssText = 'width:140px; font:20px Arial; overflow-wrap:anywhere';
        renderer.body(wrapped, 'prefix SAJ SAJ2 end', '');
        document.body.append(wrapped);
        await Promise.all([...wrapped.querySelectorAll('img')].map(img => img.decode()));
        const stack = wrapped.querySelector('.emote-stack').getBoundingClientRect();
        const container = wrapped.getBoundingClientRect();
        const prefix = document.createRange();
        prefix.selectNodeContents(wrapped.firstChild);
        const prefixBounds = prefix.getBoundingClientRect();
        results.push({wrapped:true, left:stack.left, right:stack.right,
            containerLeft:container.left, containerRight:container.right,
            top:stack.top, prefixBottom:prefixBounds.bottom});
        return results;
    })()`);
    for (const result of cases) {
        const detail = JSON.stringify(result);
        if (result.wrapped) {
            assert.ok(result.left >= result.containerLeft - 0.5, detail);
            assert.ok(result.right <= result.containerRight + 0.5, detail);
            assert.ok(result.top >= result.prefixBottom - 0.5, detail);
            continue;
        }
        assert.equal(result.stacks, 1, detail);
        assert.ok(
            Math.abs(result.width - Math.max(...result.layers.map((layer) => layer.width))) < 0.5,
            detail
        );
        assert.ok(result.trailingLeft >= result.right - 0.5, detail);
        for (const layer of result.layers) {
            assert.ok(
                Math.abs((layer.left + layer.right) / 2 - (result.left + result.right) / 2) < 0.5,
                detail
            );
            assert.ok(Math.abs(layer.top - result.layers[0].top) < 0.5, detail);
        }
    }
    console.log('Emote stack browser checks passed');
} finally {
    await browser.close();
}
