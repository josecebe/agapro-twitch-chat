import assert from 'node:assert/strict';
import { compileStyles } from '../../scripts/styles.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';

const browser = await browserSession();
try {
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 800,
        height: 2000,
        deviceScaleFactor: 1,
        mobile: false
    });
    const { css } = compileStyles();
    await browser.evaluate(`(() => {
        const style = document.createElement('style');
        style.textContent = ${JSON.stringify(css)};
        document.head.append(style);
        document.body.innerHTML = '<div id="chat"></div>';
        document.documentElement.style.setProperty('--message-gap', '12px');
        document.documentElement.style.setProperty('--reply-gap', '9px');
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer']));
    await browser.evaluate(`(() => {
        const assets = {listeners:new Set(), emote:() => null};
        const renderer = new ChatWidget.Renderer(document.getElementById('chat'), {
            maxMessages:35, language:'en', showBadges:false, showSevenTVPaints:false,
            showSevenTVBadges:false, showTwitchEmotes:false
        }, assets, {});
        window.testRenderer = renderer;
        const message = (id, text, tags = {}) => ({
            prefix:'alice!test', tags:{id, 'display-name':'Alice', ...tags}, params:['#test', text]
        });
        renderer.add(message('single', 'Single'));
        renderer.add(message('multiple', 'First\\nLast'));
        renderer.add(message('reply', 'Reply', {
            'reply-parent-msg-id':'single', 'reply-parent-user-login':'alice',
            'reply-parent-display-name':'Alice'
        }));
    })()`);
    await browser.evaluate(`(async () => {
        testRenderer.add({prefix:'alice!test', tags:{id:'gif', 'display-name':'Alice',
            gifs:'0-4|test|https://media4.giphy.com/media/test/giphy.gif'}, params:['#test','[GIF]']});
        const image = document.querySelector('.chat-gif');
        image.src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>');
        await image.decode();
        testRenderer.config.showTwitchEmotes = true;
        testRenderer.add({prefix:'alice!test', tags:{id:'emote', 'display-name':'Alice', emotes:'25:0-4'}, params:['#test','Kappa']});
        const emote = document.querySelector('.emote');
        emote.src = image.src;
        await emote.decode();
    })()`);
    for (const font of ['Arial', 'Courier New']) {
        await browser.evaluate(`document.body.style.fontFamily = ${JSON.stringify(font)}`);
        const snapshots = [];
        for (const lineHeight of [1, 1.5, 3]) {
            snapshots.push(
                await browser.evaluate(`(() => {
                document.documentElement.style.setProperty('--message-line-height', '${lineHeight}');
                testRenderer.fit();
                const rows = testRenderer.rows;
                const textRect = (body, last = false) => {
                    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
                    const nodes = [];
                    while (walker.nextNode()) nodes.push(walker.currentNode);
                    const context = document.createElement('canvas').getContext('2d');
                    const rects = [];
                    for (const node of (last ? nodes.slice(-1) : nodes)) {
                        if (!node.textContent.trim()) continue;
                        const range = document.createRange();
                        range.selectNodeContents(node);
                        context.font = getComputedStyle(node.parentElement).font;
                        const metrics = context.measureText(node.textContent);
                        for (const rect of range.getClientRects()) {
                            const baseline = rect.top + metrics.fontBoundingBoxAscent;
                            rects.push({top:baseline-metrics.actualBoundingBoxAscent,bottom:baseline+metrics.actualBoundingBoxDescent});
                        }
                    }
                    return {top:Math.min(...rects.map(rect=>rect.top)),bottom:Math.max(...rects.map(rect=>rect.bottom))};
                };
                return {
                    singleHeight:rows[0].row.getBoundingClientRect().height,
                    outerGap:rows[1].row.getBoundingClientRect().top - rows[0].row.getBoundingClientRect().bottom,
                    visibleGap:textRect(rows[1].body).top - textRect(rows[0].content, true).bottom,
                    replyTopGap:textRect(rows[2].reply.node).top - textRect(rows[1].content, true).bottom,
                    replyGap:textRect(rows[2].content).top - textRect(rows[2].reply.node).bottom,
                    gifBottomGap:rows[3].row.getBoundingClientRect().bottom - rows[3].body.querySelector('.chat-gif').getBoundingClientRect().bottom,
                    emoteHeight:rows[4].row.getBoundingClientRect().height,
                    emoteBottomGap:rows[4].row.getBoundingClientRect().bottom - rows[4].body.querySelector('.emote').getBoundingClientRect().bottom,
                    lineDistance:textRect(rows[1].body, true).top - textRect(rows[1].body).top
                };
            })()`)
            );
        }
        for (const snapshot of snapshots) {
            assert.equal(snapshot.outerGap, 12);
            assert.ok(Math.abs(snapshot.replyTopGap - 12) <= 0.5, JSON.stringify(snapshot));
            assert.ok(Math.abs(snapshot.replyGap - 9) <= 0.5, JSON.stringify(snapshot));
            assert.ok(snapshot.gifBottomGap >= 0, JSON.stringify(snapshot));
            assert.ok(snapshot.emoteBottomGap >= 0, JSON.stringify(snapshot));
            // Font baselines can round differently at fractional line heights.
            for (const key of [
                'singleHeight',
                'visibleGap',
                'replyGap',
                'gifBottomGap',
                'emoteHeight',
                'emoteBottomGap'
            ]) {
                assert.ok(
                    Math.abs(snapshot[key] - snapshots[0][key]) <= 0.5,
                    `${font} ${key}: ${JSON.stringify(snapshots)}`
                );
            }
        }
        assert.equal(snapshots[2].lineDistance - snapshots[0].lineDistance, 50);
    }
    for (const [messageGap, replyGap] of [
        [0, 0],
        [20, 0],
        [0, 20],
        [12, -4],
        [20, -12],
        [12, 9]
    ]) {
        const gaps = await browser.evaluate(`(() => {
            document.documentElement.style.setProperty('--message-gap', '${messageGap}px');
            document.documentElement.style.setProperty('--reply-gap', '${replyGap}px');
            testRenderer.fit();
            const textBounds = node => {
                const range = document.createRange();
                const context = document.createElement('canvas').getContext('2d');
                const glyphs = [];
                const glyphWalker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
                while (glyphWalker.nextNode()) {
                    const text = glyphWalker.currentNode;
                    if (!text.textContent.trim()) continue;
                    context.font = getComputedStyle(text.parentElement).font;
                    const metrics = context.measureText(text.textContent);
                    range.selectNodeContents(text);
                    for (const rect of range.getClientRects()) {
                        const baseline = rect.top + metrics.fontBoundingBoxAscent;
                        glyphs.push({top:baseline-metrics.actualBoundingBoxAscent,bottom:baseline+metrics.actualBoundingBoxDescent});
                    }
                }
                return {top:Math.min(...glyphs.map(r=>r.top)), bottom:Math.max(...glyphs.map(r=>r.bottom))};
            };
            const previous = textBounds(testRenderer.rows[1].content);
            const header = textBounds(testRenderer.rows[2].reply.node);
            const reply = textBounds(testRenderer.rows[2].content);
            return {above:header.top - previous.bottom, below:reply.top - header.bottom};
        })()`);
        assert.ok(Math.abs(gaps.above - messageGap) <= 0.5, JSON.stringify(gaps));
        assert.ok(Math.abs(gaps.below - replyGap) <= 0.5, JSON.stringify(gaps));
    }
    const clippedHeading = await browser.evaluate(`(() => {
        const renderer = testRenderer;
        const record = renderer.rows[2];
        record.reply.node.style.lineHeight = '1';
        renderer.fit();
        const margin = parseFloat(getComputedStyle(record.reply.node).marginBlockStart);
        const topGap = record.reply.heading.getBoundingClientRect().top - renderer.rows[1].row.getBoundingClientRect().bottom;
        record.reply.node.style.lineHeight = '';
        renderer.fit();
        return {margin, topGap};
    })()`);
    assert.ok(Math.abs(clippedHeading.margin) <= 0.5, JSON.stringify(clippedHeading));
    assert.ok(Math.abs(clippedHeading.topGap - 12) <= 0.5, JSON.stringify(clippedHeading));
    const fitted = await browser.evaluate(`(() => {
        testRenderer.root.style.height = '260px';
        testRenderer.root.style.bottom = 'auto';
        testRenderer.fit();
        const frame = testRenderer.root.getBoundingClientRect();
        return testRenderer.rows.map(record => ({
            id: record.id,
            visible: record.row.getBoundingClientRect().bottom > frame.top
        }));
    })()`);
    assert.ok(
        fitted.every((record) => record.visible),
        JSON.stringify(fitted)
    );
    assert.deepEqual(
        fitted.slice(-2).map((record) => record.id),
        ['gif', 'emote']
    );
    for (const layout of ['stack-bottom', 'stack-top']) {
        const clipping = await browser.evaluate(`(() => {
            const renderer = testRenderer;
            for (const record of [...renderer.rows]) renderer.remove(record);
            renderer.seen.clear();
            renderer.config.layout = '${layout}';
            renderer.root.classList.toggle('top', '${layout}' === 'stack-top');
            renderer.root.style.cssText = 'position:fixed;inset:auto;top:100px;left:0;width:400px;height:180px;padding:20px;gap:0';
            const add = id => {
                renderer.add({prefix:'alice!x',tags:{id,'display-name':'Alice'},params:['#test','test']});
                renderer.rows.at(-1).row.style.height = '100px';
                renderer.fit();
            };
            add('edge-first');
            add('edge-second');
            const frame = renderer.root.getBoundingClientRect();
            const oldest = renderer.rows[0].row.getBoundingClientRect();
            const partial = {count:renderer.rows.length, clipped:oldest.top < frame.top || oldest.bottom > frame.bottom};
            add('edge-third');
            const afterExit = renderer.rows.map(record => record.t.id);
            renderer.root.style.height = '80px';
            renderer.fit();
            return {partial, afterExit, oversized:renderer.rows.map(record => record.t.id)};
        })()`);
        assert.deepEqual(
            clipping,
            {
                partial: { count: 2, clipped: true },
                afterExit: ['edge-second', 'edge-third'],
                oversized: ['edge-third']
            },
            layout
        );
    }
    const paintShadows = await browser.evaluate(`(() => {
        const renderer = testRenderer;
        const row = document.createElement('div');
        row.className = 'message';
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = 'PaintedName';
        const mention = document.createElement('span');
        mention.className = 'mention reply-user';
        mention.textContent = '@PaintedName';
        row.append(name, mention);
        document.body.append(row);
        const hadShadow = document.body.classList.contains('shadow');
        const plainPaint = {backgroundImage:'linear-gradient(90deg,#fff,#ff0)',filter:''};
        const ownShadow = {backgroundImage:plainPaint.backgroundImage,filter:'drop-shadow(2px 2px 3px red)'};
        const filters = () => [name, mention].map(node => getComputedStyle(node).filter);
        try {
            document.body.classList.add('shadow');
            renderer.applyPaint(name, plainPaint);
            renderer.applyPaint(mention, plainPaint);
            const fallback = filters();
            const fill = getComputedStyle(name).webkitTextFillColor;
            const background = getComputedStyle(name).backgroundImage;
            renderer.applyPaint(name, ownShadow);
            const equipped = getComputedStyle(name).filter;
            document.body.classList.remove('shadow');
            const disabled = filters();
            document.body.classList.add('shadow');
            renderer.applyPaint(name, plainPaint);
            const restored = getComputedStyle(name).filter;
            renderer.applyPaint(name, null);
            const removed = {filter:getComputedStyle(name).filter,textShadow:getComputedStyle(name).textShadow};
            return {fallback, fill, background, equipped, disabled, restored, removed};
        } finally {
            row.remove();
            document.body.classList.toggle('shadow', hadShadow);
        }
    })()`);
    assert.ok(paintShadows.fallback.every((filter) => filter.startsWith('url(')));
    assert.equal(paintShadows.fill, 'rgba(0, 0, 0, 0)');
    assert.ok(paintShadows.background.includes('linear-gradient'));
    assert.ok(paintShadows.equipped.includes('rgb(255, 0, 0)'));
    assert.equal(paintShadows.equipped.match(/drop-shadow\(/g).length, 1);
    assert.deepEqual(paintShadows.disabled, [paintShadows.equipped, 'none']);
    assert.equal(paintShadows.restored, paintShadows.fallback[0]);
    assert.equal(paintShadows.removed.filter, 'none');
    assert.notEqual(paintShadows.removed.textShadow, 'none');
    // Compare actual pixels with a normal Twitch name at the same position.
    // This catches the excessive halo produced by sequential drop-shadow filters.
    const screenshots = [];
    await browser.evaluate(`(() => {
        window.shadowComparison = document.createElement('div');
        shadowComparison.className = 'shadow';
        shadowComparison.style.cssText = 'position:fixed;inset:0;z-index:999;background:#ddd;padding:20px';
        shadowComparison.innerHTML = '<div class="message"><span class="name">KiwiNebula</span></div>';
        const name = shadowComparison.querySelector('.name');
        name.style.cssText = 'font:bold 32px Arial;color:#e879f9';
        document.body.append(shadowComparison);
    })()`);
    try {
        for (const mode of ['normal', 'paint', 'old']) {
            await browser.evaluate(`(async () => {
                const name = shadowComparison.querySelector('.name');
                if ('${mode}' === 'paint') testRenderer.applyPaint(name, {backgroundImage:'linear-gradient(#e879f9,#e879f9)',filter:''});
                if ('${mode}' === 'old') name.style.filter = 'drop-shadow(0 1px 3px #000) drop-shadow(0 0 2px #000) drop-shadow(1px 1px 1px #000)';
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            })()`);
            const screenshot = await browser.send('Page.captureScreenshot', {
                format: 'png',
                clip: { x: 0, y: 0, width: 350, height: 90, scale: 1 }
            });
            screenshots.push(screenshot.data);
        }
        const difference = await browser.evaluate(`(async () => {
            const pixels = await Promise.all(${JSON.stringify(screenshots)}.map(async data => {
                const image = new Image();
                image.src = 'data:image/png;base64,' + data;
                await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.width;
                canvas.height = image.height;
                const context = canvas.getContext('2d');
                context.drawImage(image, 0, 0);
                return context.getImageData(0, 0, image.width, image.height).data;
            }));
            const diff = image => image.reduce((total, value, index) => total + Math.abs(value - pixels[0][index]), 0);
            return {paint:diff(pixels[1]),old:diff(pixels[2])};
        })()`);
        assert.ok(difference.old > 0, JSON.stringify(difference));
        assert.ok(difference.paint < difference.old * 0.5, JSON.stringify(difference));
    } finally {
        await browser.evaluate('shadowComparison.remove()');
    }
    console.log(
        'PASS painted names and mentions use fallback shadows, preserve equipped shadows, and respect the shadow setting'
    );
    console.log(
        'PASS line spacing preserves message/reply gaps and full GIF/emote bounds with proportional and monospace fonts'
    );
} finally {
    await browser.close();
}
