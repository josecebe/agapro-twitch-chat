import assert from 'node:assert/strict';
import { compileStyles } from '../../scripts/styles.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';

const browser = await browserSession();
try {
    await browser.send('Page.enable');
    browser.on('Fetch.requestPaused', async ({ requestId }) => {
        await browser.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
            body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHe8AAAAASUVORK5CYII='
        });
    });
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
    await browser.evaluate(`(() => {
        const style = document.createElement('style');
        style.textContent = ${JSON.stringify(compileStyles().css)};
        document.head.append(style);
        document.body.innerHTML = '<div id="chat"></div>';
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer', 'demo']));
    for (const language of ['es', 'en']) {
        for (const mode of ['all', 'no-gifs', 'no-emotes', 'no-replies', 'no-preview']) {
            const result = await browser.evaluate(`(() => {
                const config = {
                    language: '${language}', maxMessages: 35, showBadges: false,
                    showTwitchGifs: '${mode}' !== 'no-gifs',
                    showTwitchEmotes: '${mode}' !== 'no-emotes',
                    showReplies: '${mode}' !== 'no-replies',
                    showReplyPreview: '${mode}' !== 'no-preview'
                };
                const root = document.getElementById('chat');
                root.replaceChildren();
                const renderer = new ChatWidget.Renderer(root, config, { listeners: new Set(), emote: () => null }, {});
                const errors = [];
                let checked = 0;
                try {
                    for (const event of ChatWidget.createDemoEvents(config.language, 0, { ordered: true })) {
                        if (event.moderation) {
                            renderer.moderate(event.moderation);
                            continue;
                        }
                        const message = event.message;
                        renderer.add(message);
                        const match = message.tags.id.match(/matrix-(\\d)-reply-(\\d)$/);
                        if (!match) continue;
                        checked++;
                        const record = renderer.rows.at(-1);
                        const [parentMask, bodyMask] = match.slice(1).map(Number);
                        const check = (condition, detail) => { if (!condition) errors.push(message.tags.id + ': ' + detail); };
                        check(record.id === message.tags.id, 'missing reply');
                        check(record.body.querySelectorAll('.chat-gif').length === (config.showTwitchGifs && (bodyMask & 1) ? 1 : 0), 'GIF body');
                        check(record.body.querySelectorAll('.gif-label').length === (!config.showTwitchGifs && (bodyMask & 1) ? 1 : 0), 'GIF fallback label');
                        if (!config.showTwitchGifs && (bodyMask & 1)) check(record.body.textContent === 'GIF', 'GIF marker replaced');
                        check(record.body.querySelectorAll('.emote').length === (config.showTwitchEmotes && (bodyMask & 4) ? 1 : 0), 'emote body');
                        check(record.body.textContent.includes('😀 💜') === !!(bodyMask & 2), 'emoji body');
                        check(!!record.reply === config.showReplies, 'reply visibility');
                        if (record.reply) {
                            check(!/^@[a-z0-9_]+/i.test(record.body.textContent), 'mention not stripped');
                            check(!!record.reply.quote === config.showReplyPreview, 'preview visibility');
                            if (record.reply.quote) {
                                check(record.reply.quote.querySelectorAll('.gif-label').length === (parentMask & 1 ? 1 : 0), 'GIF preview');
                                check(record.reply.quote.querySelectorAll('.emote').length === (config.showTwitchEmotes && (parentMask & 4) ? 1 : 0), 'emote preview');
                                check(record.reply.quote.textContent.includes('😀 💜') === !!(parentMask & 2), 'emoji preview');
                            }
                        }
                    }
                } finally { renderer.stop(); }
                return { checked, errors };
            })()`);
            assert.equal(result.checked, 25);
            assert.deepEqual(result.errors, [], language + ': ' + mode);
        }
    }
    console.log(
        'Demo: 250 reply combinations rendered across two languages and five visibility modes.'
    );
} finally {
    await browser.close();
}
