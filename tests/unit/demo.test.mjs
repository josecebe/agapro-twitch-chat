import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';

function fixture() {
    const timers = new Map();
    let sequence = 0;
    const context = vm.createContext({
        window: {},
        URL,
        setTimeout: (callback) => {
            timers.set(++sequence, callback);
            return sequence;
        },
        clearTimeout: (id) => timers.delete(id)
    });
    vm.runInContext(readWidgetScripts(['demo']), context);
    return {
        widget: context.window.ChatWidget,
        timers,
        advance() {
            const next = timers.entries().next().value;
            if (!next) return;
            timers.delete(next[0]);
            next[1]();
        }
    };
}

test('demo scenes include conversational replies, first messages, rewards, emotes, actions, and moderation', () => {
    const { widget } = fixture();
    for (const language of ['es', 'en']) {
        const events = widget.createDemoEvents(language);
        const messages = events.filter((event) => event.message).map((event) => event.message);
        const reply = messages.find((message) => message.tags.id === 'demo-0-reply');
        const original = messages.find(
            (message) => message.tags.id === reply.tags['reply-parent-msg-id']
        );
        assert.equal(original.tags['user-id'], reply.tags['reply-parent-user-id']);
        assert.equal(original.params[1], reply.tags['reply-parent-msg-body']);
        assert.ok(messages.indexOf(original) < messages.indexOf(reply));
        assert.ok(messages.some((message) => message.tags['first-msg'] === '1'));
        assert.ok(messages.some((message) => message.tags['custom-reward-id']));
        assert.ok(messages.some((message) => message.tags['msg-id'] === 'highlighted-message'));
        assert.ok(messages.some((message) => message.tags.bits === '50'));
        assert.ok(messages.some((message) => message.params[1].startsWith('\u0001ACTION ')));
        const native = messages.find((message) => message.tags.id === 'demo-0-emotes');
        const emotes = widget
            .nativeParts(native.params[1], native.tags.emotes)
            .filter((part) => part.id);
        assert.equal(emotes.length, 2);
        assert.ok(emotes.every((part) => part.text === 'Kappa'));
        const gif = messages.find((message) => message.tags.gifs);
        const parts = widget.nativeParts(gif.params[1], '', gif.tags.gifs);
        assert.equal(parts.length, 1);
        assert.equal(parts[0].text, gif.params[1]);
        assert.ok(parts[0].gif.startsWith('https://media4.giphy.com/'));
        const deletion = events.find((event) => event.moderation);
        assert.ok(
            messages.some(
                (message) => message.tags.id === deletion.moderation.tags['target-msg-id']
            )
        );
    }
});

test('demo streams one event at a time, repeats with fresh IDs, and cancels on stop', async () => {
    const { widget, timers, advance } = fixture();
    const messages = [];
    const deleted = [];
    const config = { language: 'en', demo: true };
    const runtime = {
        config,
        assets: {
            globalEmotes: new Map([['GLOBAL', {}]]),
            start: (value) => assert.equal(value, config)
        },
        paints: {},
        renderer: {
            add: (message) => messages.push(message),
            moderate: (event) => deleted.push(event)
        }
    };
    const controller = widget.startDemo(runtime);
    assert.equal(messages.length, 1);
    assert.equal(timers.size, 1);
    for (let step = 0; step < widget.createDemoEvents('en').length * 2; step++) advance();
    assert.equal(new Set(messages.map((message) => message.tags.id)).size, messages.length);
    assert.ok(
        deleted
            .filter((event) => event.command === 'CLEARMSG')
            .every((event) =>
                messages.some((message) => message.tags.id === event.tags['target-msg-id'])
            )
    );
    assert.equal(
        deleted.length,
        widget.createDemoEvents('en').filter((event) => event.moderation).length * 2
    );
    assert.ok(messages.some((message) => message.params[1] === '7TV: GLOBAL'));
    assert.ok((await runtime.paints.getCosmetics('999000002')).paint.backgroundImage);
    assert.equal(await runtime.paints.getCosmetics('12345'), null);
    controller.stop();
    controller.stop();
    const count = messages.length;
    advance();
    assert.equal(timers.size, 0);
    assert.equal(messages.length, count);
});

test('demo covers valid text/emote/emoji and standalone GIF variants in originals and replies', () => {
    const { widget } = fixture();
    for (const language of ['es', 'en']) {
        const messages = widget
            .createDemoEvents(language)
            .filter((event) => event.message)
            .map((event) => event.message);
        const byId = new Map(messages.map((message) => [message.tags.id, message]));
        for (const parentMask of [0, 2, 4, 6, 1]) {
            const parent = byId.get(`demo-0-matrix-${parentMask}`);
            assert.ok(parent);
            const check = (message, mask) => {
                const parts = widget.nativeParts(
                    message.params[1],
                    message.tags.emotes || '',
                    message.tags.gifs || ''
                );
                assert.equal(parts.filter((part) => part.gif).length, mask & 1 ? 1 : 0);
                assert.equal(message.params[1].includes('😀 💜'), !!(mask & 2));
                const emotes = parts.filter((part) => part.id);
                assert.equal(emotes.length, mask & 4 ? 1 : 0);
                assert.ok(emotes.every((part) => part.text === 'Kappa'));
                assert.ok(
                    parts
                        .filter((part) => part.gif)
                        .every((part) => part.text === widget.i18n.translate(language, 'demoGif'))
                );
            };
            check(parent, parentMask);
            for (const bodyMask of [0, 2, 4, 6, 1]) {
                const reply = byId.get(`demo-0-matrix-${parentMask}-reply-${bodyMask}`);
                assert.ok(messages.indexOf(parent) < messages.indexOf(reply));
                assert.equal(reply.tags['reply-parent-msg-id'], parent.tags.id);
                assert.equal(reply.tags['reply-parent-msg-body'], parent.params[1]);
                check(reply, bodyMask);
            }
        }
        for (const message of messages) {
            const parts = widget.nativeParts(
                message.params[1],
                message.tags.emotes || '',
                message.tags.gifs || ''
            );
            assert.ok(parts.filter((part) => part.id).every((part) => part.text === 'Kappa'));
            assert.ok(
                parts
                    .filter((part) => part.gif)
                    .every((part) => part.text === widget.i18n.translate(language, 'demoGif'))
            );
        }
        for (const message of messages.filter((message) => message.tags.gifs)) {
            const parts = widget.nativeParts(
                message.params[1],
                message.tags.emotes || '',
                message.tags.gifs
            );
            assert.equal(parts.length, 1, message.tags.id);
            assert.ok(parts[0].gif, message.tags.id);
            assert.ok(!message.tags.emotes, message.tags.id);
        }
        const events = widget.createDemoEvents(language);
        assert.ok(events.some((event) => event.moderation?.tags['ban-duration']));
        assert.ok(
            events.some(
                (event) =>
                    event.moderation?.command === 'CLEARCHAT' &&
                    !event.moderation.tags['target-user-id']
            )
        );
    }
});

test('7TV demo quotes preserve resolved tokens, including overlays and missing tokens', () => {
    const { widget, advance } = fixture();
    const messages = [];
    const controller = widget.startDemo({
        config: { language: 'en' },
        paints: {},
        assets: {
            start() {},
            globalEmotes: new Map([
                ['BASE', {}],
                ['OVERLAY', { zeroWidth: true }]
            ])
        },
        renderer: { add: (message) => messages.push(message), moderate() {} }
    });
    for (let i = 1; i < widget.createDemoEvents('en').length; i++) advance();
    for (const [mode, text] of [
        ['only', 'BASE'],
        ['overlay', 'BASE OVERLAY'],
        ['isolated-overlay', 'OVERLAY'],
        ['unknown', 'DemoUnknownEmote']
    ]) {
        const parent = messages.find((message) => message.tags.id === 'demo-0-seven-tv-' + mode);
        const reply = messages.find(
            (message) => message.tags.id === 'demo-0-seven-tv-' + mode + '-reply'
        );
        assert.equal(parent.params[1], text);
        assert.equal(reply.tags['reply-parent-msg-body'], text);
        assert.equal(reply.params[1], '@' + parent.prefix.split('!')[0] + ' ' + text);
    }
    controller.stop();
});

test('color resolution preserves picker alpha, supports hex alpha, and rejects invalid colors', () => {
    const { widget } = fixture();
    assert.equal(widget.resolveColor('rgba(12, 34, 56, 0.35)').css, 'rgba(12,34,56,0.35)');
    assert.equal(widget.resolveColor('#1238').alpha, 136 / 255);
    assert.equal(widget.resolveColor('rgb(100% 0% 0% / 25%)').css, 'rgba(255,0,0,0.25)');
    assert.equal(widget.resolveColor('transparent').alpha, 0);
    assert.equal(widget.resolveColor('url(bad)', '#123456').css, 'rgba(18,52,86,1)');
    assert.equal(widget.resolveColor('#000000', '#ffffff', 0.6).css, 'rgba(0,0,0,0.6)');
});

function seededRandom(seed) {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

test('random cycles vary order, authors and content while preserving reply and deletion dependencies', () => {
    const { widget } = fixture();
    const first = widget.createDemoEvents('en', 0, { random: seededRandom(7) });
    const second = widget.createDemoEvents('en', 0, { random: seededRandom(42) });
    assert.notDeepEqual(
        first.map((event) => event.message?.tags.id),
        second.map((event) => event.message?.tags.id)
    );
    const messages = first.filter((event) => event.message).map((event) => event.message);
    assert.ok(new Set(messages.map((message) => message.tags['display-name'])).size >= 24);
    assert.notDeepEqual(
        messages.map((message) => message.params[1]),
        second.filter((event) => event.message).map((event) => event.message.params[1])
    );
    const positions = new Map(messages.map((message, index) => [message.tags.id, index]));
    for (const [index, message] of messages.entries()) {
        const parentId = message.tags['reply-parent-msg-id'];
        if (!parentId || !positions.has(parentId)) continue;
        const parent = messages[positions.get(parentId)];
        assert.ok(positions.get(parentId) < index);
        assert.equal(message.tags['reply-parent-user-login'], parent.prefix.split('!')[0]);
        assert.equal(message.tags['reply-parent-user-id'], parent.tags['user-id']);
        assert.equal(message.tags['reply-parent-msg-body'], parent.params[1]);
    }
    for (const [index, event] of first.entries()) {
        const target = event.moderation?.tags['target-msg-id'];
        if (target)
            assert.ok(
                first.slice(0, index).some((previous) => previous.message?.tags.id === target)
            );
    }
});

test('many demo users have distinct stable 7TV paints', async () => {
    const { widget, advance } = fixture();
    const messages = [];
    const runtime = {
        config: { language: 'en' },
        paints: {},
        assets: { start() {}, globalEmotes: new Map() },
        renderer: { add: (message) => messages.push(message), moderate() {} }
    };
    const controller = widget.startDemo(runtime, { random: seededRandom(31) });
    for (let i = 1; i < widget.createDemoEvents('en').length; i++) advance();
    const styles = new Set();
    for (const id of new Set(messages.map((message) => message.tags['user-id']))) {
        const cosmetic = await runtime.paints.getCosmetics(id);
        if (!cosmetic) continue;
        styles.add(cosmetic.paint.backgroundImage);
        assert.equal(await runtime.paints.getCosmetics(id), cosmetic);
    }
    assert.ok(styles.size >= 20);
    controller.stop();
});

test('Stained Glass demo uses the captured 7TV paint and includes a reply to its wearer', async () => {
    const capture = JSON.parse(
        readFileSync(new URL('../fixtures/stained-glass-paint.json', import.meta.url), 'utf8')
    );
    const { widget, advance } = fixture();
    const messages = [];
    const runtime = {
        config: { language: 'en' },
        paints: {},
        assets: { start() {}, globalEmotes: new Map() },
        renderer: { add: (message) => messages.push(message), moderate() {} }
    };
    const controller = widget.startDemo(runtime);
    for (let i = 1; i < widget.createDemoEvents('en').length; i++) advance();
    const providers = vm.createContext({ window: {}, URL });
    vm.runInContext(readWidgetScripts(['providers']), providers);
    const expected = providers.window.ChatWidget.paintCSS(capture.paint);
    const parent = messages.find((message) => message.tags.id === 'demo-0-stained-glass');
    const reply = messages.find((message) => message.tags.id === 'demo-0-stained-glass-reply');
    assert.equal(parent.tags['display-name'], 'PrismaNocturno');
    assert.equal(reply.tags['reply-parent-user-id'], parent.tags['user-id']);
    const cosmetics = await runtime.paints.getCosmetics(parent.tags['user-id']);
    assert.equal(cosmetics.paint.backgroundImage, expected.backgroundImage);
    assert.equal(cosmetics.paint.filter, expected.filter);
    assert.ok(expected.backgroundImage.startsWith('repeating-linear-gradient(135deg'));
    assert.equal(expected.filter.match(/drop-shadow\(/g).length, 2);
    assert.equal(capture.paint.data.shadows[1].blur, 4);
    controller.stop();
});

test('Epiphany demo preserves the captured orange outer glow', async () => {
    const capture = JSON.parse(
        readFileSync(new URL('../fixtures/epiphany-paint.json', import.meta.url), 'utf8')
    );
    const { widget } = fixture();
    const runtime = {
        config: { language: 'en' },
        paints: {},
        assets: { start() {}, globalEmotes: new Map() },
        renderer: { add() {}, moderate() {} }
    };
    const controller = widget.startDemo(runtime);
    const events = widget.createDemoEvents('en');
    const parent = events.find((event) => event.message?.tags.id === 'demo-0-epiphany').message;
    assert.equal(parent.tags['display-name'], 'ZorroSolar');
    const css = (await runtime.paints.getCosmetics(parent.tags['user-id'])).paint;
    assert.equal(capture.paint.name, 'Epiphany');
    assert.equal(css.filter, 'drop-shadow(0px 0px 4px rgba(255,162,0,1))');
    assert.equal(capture.paint.data.shadows[0].offsetX, 0);
    assert.equal(capture.paint.data.shadows[0].offsetY, 0);
    assert.ok(
        events.some((event) => event.message?.tags['reply-parent-msg-id'] === parent.tags.id)
    );
    controller.stop();
});
