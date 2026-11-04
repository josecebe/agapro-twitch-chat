import assert from 'node:assert/strict';
import { compileStyles } from '../../scripts/styles.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';

const browser = await browserSession();
const requests = [];
try {
    await browser.send('Page.enable');
    browser.on('Fetch.requestPaused', async ({ requestId, request }) => {
        requests.push(request.url);
        await browser.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
            body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHe8AAAAASUVORK5CYII='
        });
    });
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
    const { css } = compileStyles();
    await browser.evaluate(`(() => {
        const style = document.createElement('style');
        style.textContent = ${JSON.stringify(css)};
        document.head.append(style);
        document.body.innerHTML = '<div id="chat"></div>';
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer']));
    await browser.evaluate(`(async () => {
        const renderer = new ChatWidget.Renderer(document.getElementById('chat'), {
            maxMessages:35, language:'en', showBadges:false, showSevenTVPaints:false,
            showSevenTVBadges:false, showLinkLabels:true, showLinkFavicons:true
        }, {listeners:new Set(), emote:() => null}, {});
        window.testRenderer = renderer;
        renderer.add({prefix:'alice!test', tags:{id:'link', 'display-name':'Alice'},
            params:['#test','Mira (https://www.youtube.com/watch?v=private), https://youtube.com.evil.org/path?token=secret']});
        await Promise.all([...document.querySelectorAll('.link-favicon')].map(img=>img.decode()));
    })()`);
    const labels = await browser.evaluate(`(() => {
        const record = testRenderer.rows[0];
        return [...record.body.querySelectorAll('.link-label')].map(label => {
            const icon = label.querySelector('img');
            const style = getComputedStyle(label);
            return {text:label.textContent, src:icon.src, referrer:icon.referrerPolicy,
                rounded:parseFloat(style.borderRadius)>0, background:style.backgroundColor,
                inside:label.getBoundingClientRect().bottom <= record.row.getBoundingClientRect().bottom + 0.5};
        });
    })()`);
    assert.deepEqual(
        labels.map((label) => label.text),
        ['YOUTUBE.COM', 'YOUTUBE.COM.EVIL.ORG']
    );
    assert.ok(
        labels.every((label) => label.rounded && label.inside && label.referrer === 'no-referrer')
    );
    assert.ok(labels.every((label) => label.background !== 'rgba(0, 0, 0, 0)'));
    assert.equal(requests.length, 2);
    assert.ok(requests.every((url) => new URL(url).hostname === 'icons.duckduckgo.com'));
    assert.ok(
        requests.every(
            (url) => !url.includes('?') && !url.includes('private') && !url.includes('secret')
        )
    );
    await browser.evaluate(`(() => {
        const renderer = testRenderer;
        renderer.rows[0].body.querySelector('.link-favicon').onerror();
        if (renderer.rows[0].body.querySelector('.link-label').textContent !== 'YOUTUBE.COM') throw Error('Missing fallback');
        renderer.config.showLinkFavicons = false;
        renderer.refresh();
        if (document.querySelector('.link-favicon')) throw Error('Favicons still enabled');
        renderer.config.showLinkLabels = false;
        renderer.refresh();
        if (document.querySelector('.link-label')) throw Error('Labels still enabled');
        if (!renderer.rows[0].body.textContent.includes('watch?v=private')) throw Error('Original URL lost');
    })()`);
    assert.equal(requests.length, 2);
    const twitchLabels = await browser.evaluate(`(() => {
        const renderer = testRenderer;
        renderer.config.showLinkLabels = true;
        renderer.config.language = 'es';
        const add = (id, room) => renderer.add({prefix:'alice!test', tags:{id, 'display-name':'Alice'},
            params:[room, 'https://twitch.tv/alice/clip/ExampleClip https://clips.twitch.tv/ExampleClip?channel=alice']});
        add('clip-here', '#alice');
        add('clip-other', '#bob');
        const texts = () => renderer.rows.slice(1).map(record => [...record.body.querySelectorAll('.link-label')].map(label => label.textContent));
        const before = texts();
        renderer.refresh();
        return {before, after:texts()};
    })()`);
    assert.deepEqual(twitchLabels.before, [
        ['CLIP', 'CLIP'],
        ['CLIP', 'CLIP']
    ]);
    assert.deepEqual(twitchLabels.after, twitchLabels.before);
    const preview = await browser.evaluate(`(() => {
        const renderer = testRenderer;
        const root = renderer.root;
        root.style.width = '1000px';
        renderer.add({prefix:'bob!test', tags:{id:'preview-link', 'display-name':'Bob',
            'reply-parent-msg-id':'original-link', 'reply-parent-user-login':'alice',
            'reply-parent-display-name':'Alice',
            'reply-parent-msg-body':'Mira https://store.steampowered.com/app/3976340/Cucina_Stellata/ https://youtube.com/watch?v=preview'},
            params:['#test', 'https://youtube.com/watch?v=reply']});
        window.previewRecord = renderer.rows.at(-1);
        const {reply, body} = previewRecord;
        const bounds = reply.quote.getBoundingClientRect();
        return {
            labels:[...reply.quote.querySelectorAll('.link-label')].map(label => ({text:label.textContent, visible:!label.hidden,
                inside:label.getBoundingClientRect().left >= bounds.left - 0.5 && label.getBoundingClientRect().right <= bounds.right + 0.5})),
            previewFont:parseFloat(getComputedStyle(reply.quote.querySelector('.link-label')).fontSize),
            normalFont:parseFloat(getComputedStyle(body.querySelector('.link-label')).fontSize),
            height:reply.node.getBoundingClientRect().height,
            headingWidth:reply.heading.getBoundingClientRect().width,
            ellipsisHidden:reply.quote._previewEllipsis.hidden
        };
    })()`);
    assert.deepEqual(
        preview.labels.map((label) => label.text),
        ['LINK', 'LINK']
    );
    assert.ok(preview.labels.every((label) => label.visible && label.inside));
    assert.ok(preview.previewFont < preview.normalFont);
    assert.equal(preview.ellipsisHidden, true);
    const narrow = await browser.evaluate(`(() => {
        const renderer = testRenderer;
        const {reply} = previewRecord;
        const rootStyle = getComputedStyle(renderer.root);
        const padding = parseFloat(rootStyle.paddingLeft) + parseFloat(rootStyle.paddingRight);
        renderer.root.style.width = (reply.heading.getBoundingClientRect().width + parseFloat(getComputedStyle(reply.node).columnGap) + padding + 30) + 'px';
        renderer.fit();
        return {allHidden:[...reply.quote.querySelectorAll('.link-label')].every(label => label.hidden),
            ellipsis:!reply.quote._previewEllipsis.hidden, height:reply.node.getBoundingClientRect().height,
            headingWidth:reply.heading.getBoundingClientRect().width};
    })()`);
    assert.equal(narrow.allHidden, true);
    assert.equal(narrow.ellipsis, true);
    assert.ok(Math.abs(narrow.height - preview.height) <= 0.5);
    assert.ok(Math.abs(narrow.headingWidth - preview.headingWidth) <= 0.5);
    const restored = await browser.evaluate(`(() => {
        testRenderer.root.style.width = '1000px';
        testRenderer.fit();
        const quote = previewRecord.reply.quote;
        return {visible:[...quote.querySelectorAll('.link-label')].every(label => !label.hidden), ellipsisHidden:quote._previewEllipsis.hidden};
    })()`);
    assert.equal(restored.visible, true);
    assert.equal(restored.ellipsisHidden, true);
    const mediaPreview = await browser.evaluate(`(() => {
        const renderer = testRenderer;
        renderer.config.showTwitchEmotes = true;
        renderer.config.showSevenTVEmotes = true;
        renderer.assets.emote = token => token === 'Wave' ? {src:'https://cdn.7tv.app/emote/test/2x.webp',ratio:2} : null;
        document.documentElement.style.setProperty('--username-font-family', 'monospace');
        renderer.add({prefix:'alice!x',tags:{id:'media-parent',emotes:'25:0-4'},params:['#test','Kappa Wave [GIF] 😀 @alice']});
        renderer.add({prefix:'bob!x',tags:{id:'media-reply','reply-parent-msg-id':'media-parent',
            'reply-parent-user-login':'alice','reply-parent-msg-body':'Kappa Wave [GIF] 😀 @alice'},params:['#test','reply']});
        const quote = renderer.rows.at(-1).reply.quote;
        renderer.rememberColor('alice','Alice','#ff0000');
        const mention = quote.querySelector('.mention');
        return {images:quote.querySelectorAll('.emote').length,
            heights:[...quote.querySelectorAll('.emote')].map(image=>image.getBoundingClientRect().height),
            fontSize:parseFloat(getComputedStyle(quote).fontSize),
            mentionFont:getComputedStyle(mention).fontFamily,
            neutral:mention.style.color === '' && !mention.classList.contains('painted'),
            gif:quote.querySelector('.gif-label').textContent,
            gifImages:quote.querySelectorAll('.chat-gif').length,
            height:quote.getBoundingClientRect().height, whiteSpace:getComputedStyle(quote).whiteSpace,
            oneLine:getComputedStyle(quote).whiteSpace === 'nowrap' && quote.getBoundingClientRect().height < parseFloat(getComputedStyle(quote).fontSize) * 1.6};
    })()`);
    assert.equal(mediaPreview.images, 2);
    assert.ok(
        mediaPreview.heights.every((height) => Math.abs(height - mediaPreview.fontSize) < 0.5)
    );
    assert.equal(mediaPreview.mentionFont, 'monospace');
    assert.equal(mediaPreview.neutral, true);
    assert.equal(mediaPreview.gif, 'GIF');
    assert.equal(mediaPreview.gifImages, 0);
    assert.equal(mediaPreview.oneLine, true, JSON.stringify(mediaPreview));
    const clippedMedia = await browser.evaluate(`(() => {
        const renderer = testRenderer;
        const record = renderer.rows.at(-1);
        const style = getComputedStyle(renderer.root);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        renderer.root.style.width = (record.reply.heading.getBoundingClientRect().width + parseFloat(getComputedStyle(record.reply.node).columnGap) + padding + 30) + 'px';
        renderer.fit();
        const hidden = record.reply.quote.querySelector('.gif-label').hidden;
        const ellipsis = !record.reply.quote._previewEllipsis.hidden;
        renderer.root.style.width = '1000px';
        renderer.fit();
        return {hidden,ellipsis,restored:!record.reply.quote.querySelector('.gif-label').hidden};
    })()`);
    assert.deepEqual(clippedMedia, { hidden: true, ellipsis: true, restored: true });
    const falseLinks = await browser.evaluate(`(() => {
        const renderer = testRenderer;
        renderer.config.showLinkFavicons = false;
        renderer.add({prefix:'alice!test', tags:{id:'not-a-link', 'display-name':'Alice'},
            params:['#test','Hola sr.urticaria, youtube.com_fake y https://sr.urticaria']});
        renderer.add({prefix:'bob!test', tags:{id:'not-a-link-reply', 'display-name':'Bob',
            'reply-parent-msg-id':'not-a-link', 'reply-parent-user-login':'alice',
            'reply-parent-msg-body':'Hola sr.urticaria, youtube.com_fake y https://sr.urticaria'},
            params:['#test','sr.urticaria y twitch.tv']});
        const parent = renderer.rows.at(-2);
        const reply = renderer.rows.at(-1);
        return {
            parentLabels: parent.body.querySelectorAll('.link-label').length,
            quoteLabels: reply.reply.quote.querySelectorAll('.link-label').length,
            replyLabels: reply.body.querySelectorAll('.link-label').length,
            parentText: parent.body.textContent,
            quoteText: reply.reply.quote.textContent
        };
    })()`);
    assert.equal(falseLinks.parentLabels, 0);
    assert.equal(falseLinks.quoteLabels, 0);
    assert.equal(falseLinks.replyLabels, 1);
    assert.ok(falseLinks.parentText.includes('sr.urticaria'));
    assert.ok(falseLinks.quoteText.includes('sr.urticaria'));
    const replyEdges = await browser.evaluate(`(() => {
        const renderer = testRenderer;
        const results = [];
        document.body.classList.add('shadow');
        for (const language of ['es', 'en']) {
            renderer.config.language = language;
            renderer.root.style.width = '1000px';
            renderer.add({prefix:'bob!test', tags:{id:'shadow-edges-' + language, 'display-name':'Bob',
                'reply-parent-msg-id':'shadow-parent', 'reply-parent-user-login':'prismanocturno',
                'reply-parent-display-name':'PrismaNocturno', 'reply-parent-msg-body':'A long quoted message that yields space to the recipient name'},
                params:['#test','reply']});
            const {reply} = renderer.rows.at(-1);
            renderer.applyPaint(reply.mention, {backgroundImage:'linear-gradient(90deg,red,gold)',filter:''});
            for (const width of [1000, 420, 120]) {
                renderer.root.style.width = width + 'px';
                renderer.fit();
                const heading = reply.heading.getBoundingClientRect();
                const quote = reply.quote.getBoundingClientRect();
                const range = document.createRange();
                range.selectNodeContents(reply.heading);
                const text = range.getBoundingClientRect();
                const style = getComputedStyle(reply.heading);
                results.push({language,width,
                    leftBleed:text.left-heading.left,
                    rightBleed:heading.right-text.right,
                    padding:parseFloat(style.paddingRight),
                    overflow:style.overflowX,
                    ellipsis:style.textOverflow,
                    clipped:reply.heading.scrollWidth > reply.heading.clientWidth,
                    separated:quote.left >= reply.mention.getBoundingClientRect().right,
                    oneLine:reply.node.getBoundingClientRect().height <= parseFloat(getComputedStyle(reply.node).lineHeight) + 1
                });
            }
        }
        return results;
    })()`);
    for (const edge of replyEdges) {
        assert.ok(edge.leftBleed >= 5.5, JSON.stringify(edge));
        assert.ok(edge.padding >= 6, JSON.stringify(edge));
        assert.equal(edge.overflow, 'hidden');
        assert.equal(edge.ellipsis, 'ellipsis');
        assert.equal(edge.oneLine, true, JSON.stringify(edge));
        if (edge.width >= 420) {
            assert.ok(edge.rightBleed >= 5.5, JSON.stringify(edge));
            assert.equal(edge.clipped, false, JSON.stringify(edge));
            assert.equal(edge.separated, true, JSON.stringify(edge));
        } else {
            assert.equal(edge.clipped, true, JSON.stringify(edge));
        }
    }
    console.log(
        'PASS reply headings preserve shadow/glyph edges and still truncate in narrow layouts'
    );
    console.log(
        'PASS rounded domain labels, actual hostnames, favicon-only network requests, fallback and settings'
    );
} finally {
    await browser.close();
}
