import { artifactPath } from '../helpers/artifacts.mjs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { browserSession } from '../helpers/browser-session.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Live probes use explicitly supplied accounts instead of hard-coded identities.
const testChannel = String(process.env.TWITCH_TEST_CHANNEL || '')
    .trim()
    .toLowerCase();
const testUserId = String(process.env.TWITCH_TEST_USER_ID || '').trim();
if (testChannel && !/^[a-z0-9_]{1,25}$/.test(testChannel))
    throw Error('Invalid TWITCH_TEST_CHANNEL');
if (testUserId && !/^\d+$/.test(testUserId)) throw Error('Invalid TWITCH_TEST_USER_ID');
const browser = await browserSession();
const { send, evaluate } = browser;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
try {
    if (process.argv.includes('--badge-validation')) {
        await send('Page.enable');
        await send('Emulation.setDeviceMetricsOverride', {
            width: 450,
            height: 800,
            deviceScaleFactor: 1,
            mobile: false
        });
        await send('Page.navigate', {
            url: pathToFileURL(path.join(root, 'index.html')).href
        });
        await delay(12000);
        const result = await evaluate(`
(async () => {
    const { assets: a, renderer: r, config: c } = CHAT_WIDGET_RUNTIME;
    r.config.showSevenTVPaints = false;
    const channelId = a.channelId;
    if (!channelId) {
        throw Error('No room-id received');
    }
    const initial = {
        globalSets: Object.keys(a.globalBadges).length,
        channelSets: Object.keys(a.channelBadges).length
    };
    a.globalBadges = {};
    a.channelBadges = {};
    for (const row of [...r.rows]) {
        r.remove(row);
    }
    const fixtures = [
        ['broadcaster/1,subscriber/6', 'Sample: broadcaster and 6-month subscriber'],
        ['moderator/1,subscriber/3', 'Sample: moderator and 3-month subscriber'],
        ['vip/1,founder/0', 'Sample: VIP and founder'],
        ['bits/100', 'Sample: Bits'],
        ['does-not-exist/1', 'Sample: unknown badge omitted']
    ];
    for (let i = 0; i < fixtures.length; i++) {
        r.add({
            tags: {
                id: 'badge-test-' + i,
                badges: fixtures[i][0],
                'display-name': 'Sample ' + (i + 1),
                color: '#a6f3d1'
            },
            prefix: 'sample!x',
            params: ['#' + c.channel, fixtures[i][1]]
        });
    }
    const before = document.querySelectorAll('.badge').length;
    await Promise.all([a.badges(), a.badges(channelId)]);
    await Promise.all(
        [...document.querySelectorAll('.badge')].map((img) =>
            img.complete
                ? Promise.resolve()
                : new Promise((resolve) => {
                      img.addEventListener('load', resolve, {
                          once: true
                      });
                      img.addEventListener('error', resolve, {
                          once: true
                      });
                      setTimeout(resolve, 8000);
                  })
        )
    );
    const rows = r.rows.map((row) => ({
        requested: row.t.badges,
        images: [...row.badges.querySelectorAll('img')].map((img) => ({
            title: img.title,
            url: img.src,
            loaded: img.complete && img.naturalWidth > 0
        })),
        expected: row.t.badges
            .split(',')
            .map((token) => a.badge(...token.split('/')))
            .filter(Boolean).length
    }));
    return {
        channel: c.channel,
        channelId,
        initial,
        before,
        globalSets: Object.keys(a.globalBadges).length,
        channelSets: Object.keys(a.channelBadges).length,
        rows
    };
})();
`);
        assert.ok(result.globalSets > 0);
        assert.ok(result.channelSets > 0);
        assert.equal(result.before, 0);
        assert.ok(
            result.rows.every(
                (r) => r.images.length === r.expected && r.images.every((i) => i.loaded)
            )
        );
        assert.ok(result.rows[0].images.some((i) => i.title === '6-Month Subscriber'));
        assert.equal(result.rows.at(-1).images.length, 0);
        console.log(
            'PASS real badges, pending-message updates and CDN loading',
            JSON.stringify(result)
        );
        await writeFile(
            await artifactPath('badge-results.json'),
            JSON.stringify(result, null, 4) + '\n'
        );
        const screenshot = await send('Page.captureScreenshot', {
            format: 'png'
        });
        await writeFile(
            await artifactPath('badges-preview.png'),
            Buffer.from(screenshot.data, 'base64')
        );
        await send('Browser.close').catch(() => {});
    } else if (process.argv.includes('--badge-probe')) {
        if (!testChannel) throw Error('Set TWITCH_TEST_CHANNEL to run the channel badge probe');
        await send('Page.enable');
        await send('Page.navigate', {
            url: pathToFileURL(path.join(root, 'index.html')).href + '?demo=1'
        });
        await delay(1000);
        const result = await evaluate(`
(async () => {
    const out = [];
    for (const url of [
        'https://api.ivr.fi/v2/twitch/badges/global',
        'https://api.ivr.fi/v2/twitch/badges/channel?login=' + encodeURIComponent(${JSON.stringify(testChannel)})
    ]) {
        try {
            const d = await ChatWidget.fetchJSON(url);
            out.push({
                url,
                data: d
            });
        } catch (e) {
            out.push({
                url,
                error: e.message
            });
        }
    }
    return out;
})();
`);
        await writeFile(
            await artifactPath('badge-probe.json'),
            JSON.stringify(result, null, 4) + '\n'
        );
        console.log(JSON.stringify(result).slice(0, 2400));
        await send('Browser.close').catch(() => {});
    } else if (process.argv.includes('--channel-only')) {
        await send('Page.enable');
        await send('Page.navigate', {
            url: pathToFileURL(path.join(root, 'index.html')).href
        });
        await delay(15000);
        const result = await evaluate(`
({
    sources: CHAT_WIDGET_RUNTIME.sources.map((s) => ({
        id: s.id,
        channel: s.channel,
        channelId: s.assets.channelId,
        status: CHAT_WIDGET_RUNTIME.status.get(s.id + ' · connection')
    })),
    messages: CHAT_WIDGET_RUNTIME.renderer.rows.length
});
`);
        console.log('Configured sources', JSON.stringify(result));
        assert.ok(result.sources.length);
        assert.ok(result.sources.every((s) => s.status?.startsWith('connected')));
        await writeFile(
            await artifactPath('channel-results.json'),
            JSON.stringify(result, null, 4) + '\n'
        );
        await send('Browser.close').catch(() => {});
    } else {
        await send('Page.enable');
        await send('Page.navigate', {
            url: pathToFileURL(path.join(root, 'index.html')).href + '?demo=1'
        });
        await delay(1500);
        const offline = await evaluate(`
({
    url: location.href,
    scripts: !!window.ChatWidget,
    rows: document.querySelectorAll('.message').length,
    bg: getComputedStyle(document.body).backgroundColor,
    safe: !document.querySelector('.body script'),
    text: document.querySelectorAll('.body')[2]?.textContent
});
`);
        assert.ok(offline.scripts);
        assert.ok(offline.rows > 0);
        assert.equal(offline.bg, 'rgba(0, 0, 0, 0)');
        assert.equal(offline.safe, true);
        console.log('PASS file://, classic scripts, safe DOM and transparency', offline);
        const dom = await evaluate(`
(() => {
    const R = CHAT_WIDGET_RUNTIME.renderer;
    R.root.style.height = '4000px';
    R.config.maxMessages = 35;
    R.config.showSevenTVPaints = false;
    const add = (id, user, text) =>
        R.add({
            tags: {
                id,
                'user-id': user,
                'display-name': user
            },
            prefix: user + '!x',
            params: ['#demo', text]
        });
    add('mod-one', '101', 'borrar');
    R.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'mod-one'
        },
        params: []
    });
    const deleted = !R.rows.some((r) => r.id === 'mod-one');
    add('mod-two', '102', 'timeout');
    R.moderate({
        command: 'CLEARCHAT',
        tags: {
            'target-user-id': '102'
        },
        params: ['#demo', '102']
    });
    const timeout = !R.rows.some((r) => r.user === '102');
    add('shared-one', '103', 'Shared');
    R.add({
        tags: {
            id: 'shared-two',
            'source-id': 'shared-one',
            'user-id': '103'
        },
        prefix: 'u!x',
        params: ['#demo', 'Shared']
    });
    const shared = R.rows.filter((r) => r.user === '103').length === 1;
    for (let i = 0; i < 60; i++) {
        add('bound-' + i, '104', 'limit');
    }
    return {
        deleted,
        timeout,
        shared,
        bounded: R.rows.length === 35
    };
})();
`);
        assert.ok(Object.values(dom).every(Boolean));
        console.log('PASS moderation, Shared Chat and DOM limits', dom);
        const live = await evaluate(`
(async () => {
    const out = {};
    const userId = ${JSON.stringify(testUserId)};
    for (const [name, url, options] of [
        ['global7TV', 'https://7tv.io/v3/emote-sets/global'],
        ['channel7TV', 'https://7tv.io/v3/users/twitch/' + encodeURIComponent(userId)],
        ['badges', 'https://badges.twitch.tv/v1/badges/global/display'],
        [
            'paint',
            'https://7tv.io/v4/gql',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: ChatWidget.paintQuery,
                    variables: {
                        id: userId
                    }
                })
            }
        ]
    ].filter(([name]) => userId || ['global7TV', 'badges'].includes(name))) {
        try {
            const d = await ChatWidget.fetchJSON(url, options);
            out[name] = {
                ok: true,
                count: d.emotes?.length || d.emote_set?.emotes?.length,
                paint: d.data?.users?.userByConnection?.style?.activePaint,
                errors: d.errors
            };
        } catch (e) {
            out[name] = {
                ok: false,
                error: e.message
            };
        }
    }
    return out;
})();
`);
        const irc = testChannel
            ? await evaluate(`
new Promise((resolve) => {
    const records = [];
    let n = 0;
    const chat = new ChatWidget.TwitchChat(
        ${JSON.stringify(testChannel)},
        (m) => {
            if (m.command === 'PRIVMSG' && n++ < 2) {
                records.push({
                    command: m.command,
                    tags: Object.keys(m.tags),
                    room: m.tags['room-id'],
                    hasNativeEmotes: !!m.tags.emotes
                });
            }
        },
        (state, detail) =>
            records.push({
                state,
                detail
            })
    );
    chat.connect();
    setTimeout(() => {
        chat.stop();
        resolve(records);
    }, 20000);
});
`)
            : { skipped: true, reason: 'Set TWITCH_TEST_CHANNEL to run the live IRC probe' };
        const resources = await evaluate(`
(async () => {
    const load = (src) =>
        new Promise((resolve) => {
            const i = new Image();
            i.onload = () =>
                resolve({
                    ok: true,
                    width: i.naturalWidth,
                    height: i.naturalHeight
                });
            i.onerror = () =>
                resolve({
                    ok: false
                });
            i.src = src;
            setTimeout(
                () =>
                    resolve({
                        ok: false,
                        error: 'timeout'
                    }),
                10000
            );
        });
    const a = CHAT_WIDGET_RUNTIME.assets;
    const emote = a.globalEmotes.values().next().value;
    return {
        twitch: await load('https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0'),
        sevenTV: emote ? await load(emote.src) : null,
        zeroWidth: (() => {
            a.channelEmotes.set('BASE', {
                src: emote?.src || '',
                ratio: 1
            });
            a.channelEmotes.set('OVER', {
                src: emote?.src || '',
                ratio: 1,
                zeroWidth: true
            });
            const n = document.createElement('span');
            CHAT_WIDGET_RUNTIME.renderer.body(n, 'BASE OVER OVER aislado', '');
            return (
                n.querySelectorAll('.emote-stack').length === 1 &&
                n.querySelectorAll('.overlay').length === 2
            );
        })()
    };
})();
`);
        let realPaint = null;
        if (live.paint?.ok && live.paint.paint) {
            realPaint = await evaluate(`
(async () => {
    const css = ChatWidget.paintCSS(${JSON.stringify(live.paint.paint)});
    const node = document.querySelector('.name');
    Object.assign(node.style, css);
    node.classList.add('painted');
    const urls = [...css.backgroundImage.matchAll(/url\\("([^"]+)"\\)/g)].map((m) => m[1]);
    const loaded = await Promise.all(
        urls.map(
            (src) =>
                new Promise((resolve) => {
                    const i = new Image();
                    i.onload = () => resolve(true);
                    i.onerror = () => resolve(false);
                    i.src = src;
                    setTimeout(() => resolve(false), 10000);
                })
        )
    );
    return {
        css,
        loaded
    };
})();
`);
        }
        console.log('Assets and composition', JSON.stringify(resources));
        console.log('Real paint applied', JSON.stringify(realPaint));
        console.log('APIs file://', JSON.stringify(live));
        console.log('Live IRC', JSON.stringify(irc));
        await writeFile(
            await artifactPath('browser-results.json'),
            JSON.stringify(
                {
                    testedAt: new Date().toISOString(),
                    browser: 'Chrome headless, file://, seguridad predeterminada',
                    offline,
                    dom,
                    live,
                    irc,
                    resources,
                    realPaint
                },
                null,
                4
            ) + '\n'
        );
        await send('Browser.close').catch(() => {});
    }
} finally {
    await browser.close();
}
