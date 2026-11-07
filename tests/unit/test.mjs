import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context = vm.createContext({
    window: {},
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console
});
for (const file of ['core', 'domain-tlds', 'providers']) {
    vm.runInContext(
        readFileSync(new URL('../../src/' + file + '.js', import.meta.url), 'utf8'),
        context
    );
}
const A = context.window.ChatWidget;
let count = 0;
function test(name, fn) {
    fn();
    console.log('PASS', name);
    count++;
}
test('IRCv3 parses escapes, prefixes, trailing parameters and Unicode', () => {
    const m = A.parseIRC(
        '@display-name=Ana\\sMaría;custom=a\\:b\\\\c\\r\\n :ana!a@a PRIVMSG #canal :¡Hola  😀!'
    );
    assert.equal(m.tags['display-name'], 'Ana María');
    assert.equal(m.tags.custom, 'a;b\\c\r\n');
    assert.equal(m.params[1], '¡Hola  😀!');
});
test('Localized usernames append the login only for supported scripts', () => {
    for (const [login, displayName, expected] of [
        ['tanesenpaii', 'タネセンパイ', 'タネセンパイ (tanesenpaii)'],
        ['lihua', '李华', '李华 (lihua)'],
        ['minsu', '민수', '민수 (minsu)'],
        ['ahmad', 'أحمد', 'أحمد (ahmad)'],
        ['samplehost', 'Samplehost', 'Samplehost'],
        ['samplehost', '', 'samplehost'],
        ['bob', 'Alice', 'Alice'],
        ['jose', 'José', 'José'],
        ['ivan', 'Иван', 'Иван']
    ]) {
        assert.equal(A.formatDisplayName(login, displayName), expected);
    }
});
test('IRC frames handle multiple lines and incomplete chunks', () => {
    const out = [];
    const s = new A.IRCStream((m) => out.push(m.command));
    s.push('PING :tmi\r\n@room-id=1 :tmi ROOM');
    s.push('STATE #canal\r\n');
    assert.equal(out.join(','), 'PING,ROOMSTATE');
});
test('GIF ranges support Unicode, complete URLs and emotes and reject invalid data', () => {
    const src =
        'https://media4.giphy.com/media/joSNxeswxuc74Juo8X/giphy.gif?cid=test&rid=giphy.gif';
    const text = '😀 [GIF] Kappa';
    const parts = A.nativeParts(text, '25:8-12', `2-6|joSNxeswxuc74Juo8X|${src}`);
    assert.equal(parts.map((part) => part.text).join(''), text);
    assert.equal(parts.find((part) => part.gif).gif, src);
    assert.equal(parts.find((part) => part.id).text, 'Kappa');
    for (const url of [
        'javascript:alert(1)',
        'http://media4.giphy.com/a.gif',
        'https://media4.giphy.com.evil.test/a.gif',
        'https://user:password@media4.giphy.com/a.gif',
        'https://example.com/a.gif'
    ]) {
        assert.ok(!A.nativeParts(text, '', `2-6|id|${url}`).some((part) => part.gif));
    }
    for (const range of ['6-2', '2-99', '-1-6', 'bad']) {
        assert.ok(!A.nativeParts(text, '', `${range}|id|${src}`).some((part) => part.gif));
    }
    const repeated = A.nativeParts('[A][B]', '', `0-2|a|${src},0-2|a|${src},3-5|b|${src}`);
    assert.equal(repeated.filter((part) => part.gif).length, 2);
    assert.equal(repeated.map((part) => part.text).join(''), '[A][B]');
});
test('Links preserve domains, punctuation and Unicode while rejecting unsafe URLs', () => {
    const text =
        'Mira (https://www.youtube.com/watch?v=test), twitch.tv y https://youtube.com.evil.org/x.';
    const parts = A.linkParts(text);
    assert.equal(parts.map((part) => part.text).join(''), text);
    assert.equal(
        parts
            .filter((part) => part.domain)
            .map((part) => part.domain)
            .join(','),
        'youtube.com,twitch.tv,youtube.com.evil.org'
    );
    assert.equal(A.linkParts('https://mañana.es')[0].domain, 'xn--maana-pta.es');
    assert.equal(A.linkParts('https://youtube.com/a(b)')[0].text, 'https://youtube.com/a(b)');
    for (const text of [
        'correo@youtube.com',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        'file:///etc/passwd',
        'ftp://youtube.com/',
        'https://youtube.com@evil.org/',
        'https://127.0.0.1/',
        'https://0x7f000001/',
        'https://[::1]/',
        'https://localhost/',
        'https://router.local/',
        'https://foo.internal/',
        'https://foo.lan/'
    ]) {
        assert.ok(!A.linkParts(text).some((part) => part.domain), text);
    }
});
test('Links validate IANA TLDs, complete token boundaries and internationalized names', () => {
    for (const text of [
        'sr.urticaria',
        'Hola sr.urticaria, buenas tardes.',
        'www.sr.urticaria',
        'https://sr.urticaria/saludo',
        'example.extensioninventada',
        'youtube.com_fake',
        'youtube.com123',
        'youtube.com-extra',
        'youtube.com:abc',
        'youtube.com:123abc',
        'youtube.com:123456',
        'youtube.com:65536',
        'youtube.com.fakeextension',
        'https://' + 'a'.repeat(64) + '.com',
        'a'.repeat(64) + '.com',
        'https://foo..com',
        'https://-foo.com'
    ]) {
        const parts = A.linkParts(text);
        assert.ok(!parts.some((part) => part.domain), text);
        assert.equal(parts.map((part) => part.text).join(''), text);
    }
    for (const [text, domain] of [
        ['twitch.tv', 'twitch.tv'],
        ['youtube.com.', 'youtube.com'],
        ['(example.photography)', 'example.photography'],
        ['example.museum', 'example.museum'],
        ['example.co.uk/path?q=1#top', 'example.co.uk'],
        ['https://mañana.es', 'xn--maana-pta.es'],
        ['mañana.es', 'xn--maana-pta.es'],
        ['пример.рф', 'xn--e1afmkfd.xn--p1ai'],
        ['https://пример.рф', 'xn--e1afmkfd.xn--p1ai']
    ]) {
        const parts = A.linkParts(text);
        assert.equal(parts.filter((part) => part.domain).length, 1, text);
        assert.equal(parts.find((part) => part.domain).domain, domain, text);
        assert.equal(parts.map((part) => part.text).join(''), text);
    }
});
test('Twitch links classify channels, clips and videos without inventing ownership', () => {
    for (const [url, type, channel] of [
        ['https://www.twitch.tv/alice', 'channel', 'alice'],
        ['twitch.tv/Alice/clip/ExampleClip', 'clip', 'alice'],
        ['https://www.twitch.tv/bob/clip/OtherClip', 'clip', 'bob'],
        ['https://clips.twitch.tv/ExampleClip?channel=alice', 'clip', ''],
        ['https://clips.twitch.tv/embed?clip=ExampleClip', 'clip', ''],
        ['https://www.twitch.tv/videos/12345?t=1h', 'video', undefined],
        ['https://player.twitch.tv/?video=v12345', 'video', undefined],
        ['https://player.twitch.tv/?channel=Alice', 'channel', 'alice'],
        ['https://twitch.tv/alice/clips', 'clips', 'alice'],
        ['https://twitch.tv/directory/category/just-chatting', 'directory', undefined],
        ['https://twitch.tv/settings', 'home', undefined]
    ]) {
        const result = A.twitchLink(url, 'alice');
        assert.equal(result.type, type, url);
        assert.equal(result.channel, channel, url);
    }
    assert.equal(A.twitchLink('twitch.tv/alice/clip/ExampleClip', 'alice').current, true);
    assert.equal(A.twitchLink('twitch.tv/bob/clip/ExampleClip', 'alice').current, false);
    assert.equal(A.twitchLink('clips.twitch.tv/ExampleClip?channel=alice', 'alice').current, false);
    for (const url of [
        'https://twitch.tv.evil.org/alice',
        'https://eviltwitch.tv/alice',
        'https://user@twitch.tv/alice',
        'https://twitch.tv:8443/alice',
        'https://twitch.tv/%broken'
    ]) {
        assert.equal(A.twitchLink(url, 'alice'), null, url);
    }
});
test('Native emotes use inclusive code-point ranges around astral emoji', () => {
    const text = '😀 Kappa ñ Kappa!';
    const p = A.nativeParts(text, '25:2-6,10-14');
    assert.equal(p.map((v) => v.text).join(''), text);
    assert.equal(p.filter((v) => v.id).length, 2);
    assert.equal(p[1].text, 'Kappa');
    assert.equal(p[3].text, 'Kappa');
});
test('Corrupt or overlapping emote ranges do not duplicate text', () =>
    assert.equal(
        A.nativeParts('Kappa', '25:0-4,0-4,90-99')
            .map((v) => v.text)
            .join(''),
        'Kappa'
    ));
test('Asset URLs reject external hosts, credentials and unsupported protocols', () => {
    assert.equal(A.safeURL('javascript:alert(1)', ['cdn.7tv.app']), null);
    assert.equal(A.safeURL('https://cdn.7tv.app.evil/x', ['cdn.7tv.app']), null);
    assert.equal(A.safeURL('https://user@cdn.7tv.app/x', ['cdn.7tv.app']), null);
});
const paint = {
    data: {
        layers: [
            {
                opacity: 1,
                ty: {
                    __typename: 'PaintLayerTypeLinearGradient',
                    angle: 90,
                    repeating: false,
                    stops: [
                        {
                            at: 0,
                            color: {
                                r: 255,
                                g: 0,
                                b: 0,
                                a: 255
                            }
                        },
                        {
                            at: 1,
                            color: {
                                r: 0,
                                g: 0,
                                b: 255,
                                a: 255
                            }
                        }
                    ]
                }
            }
        ],
        shadows: [
            {
                offsetX: 1,
                offsetY: 1,
                blur: 2,
                color: {
                    r: 0,
                    g: 0,
                    b: 0,
                    a: 255
                }
            }
        ]
    }
};
test('Paint CSS supports gradients and shadows and rejects unsafe CSS', () => {
    assert.match(A.paintCSS(paint).backgroundImage, /linear-gradient\(90deg/);
    assert.match(A.paintCSS(paint).filter, /drop-shadow/);
    assert.equal(
        A.paintCSS({
            data: {
                layers: [
                    {
                        opacity: 1,
                        ty: {
                            __typename: 'PaintLayerTypeImage',
                            images: [
                                {
                                    url: 'https://evil.org/x'
                                }
                            ]
                        }
                    }
                ]
            }
        }),
        null
    );
});
test('Badges use exact versions with channel precedence and omit unknown badges', () => {
    const assets = new A.Assets(() => {});
    assets.globalBadges = {
        subscriber: {
            versions: {
                6: {
                    title: 'global'
                },
                12: {
                    title: '12'
                }
            }
        }
    };
    assets.channelBadges = {
        subscriber: {
            versions: {
                6: {
                    title: 'canal'
                }
            }
        }
    };
    assert.equal(assets.badge('subscriber', '6').title, 'canal');
    assert.equal(assets.badge('subscriber', '7'), undefined);
});
test('Badge catalogs normalize IVR and Helix formats, preserve tiers and validate CDN hosts', () => {
    const sets = A.normalizeBadges([
        {
            set_id: 'subscriber',
            versions: [
                {
                    id: '6',
                    title: '6 meses',
                    image_url_4x: 'https://static-cdn.jtvnw.net/badges/v1/sub6/3'
                },
                {
                    id: '2006',
                    title: 'Tier 2, 6 meses',
                    image_url_2x: 'https://static-cdn.jtvnw.net/badges/v1/tier2/2'
                },
                {
                    id: '12',
                    image_url_4x: 'https://evil.org/falso'
                }
            ]
        }
    ]);
    assert.equal(sets.subscriber.versions['6'].title, '6 meses');
    assert.equal(sets.subscriber.versions['2006'].title, 'Tier 2, 6 meses');
    assert.equal(sets.subscriber.versions['12'], undefined);
    assert.equal(Object.keys(A.normalizeBadges([])).length, 0);
    assert.throws(() =>
        A.normalizeBadges({
            badge_sets: {}
        })
    );
});
test('Badge catalog keys cannot pollute prototypes', () => {
    const s = A.normalizeBadges([
        {
            set_id: '__proto__',
            versions: [
                {
                    id: '__proto__',
                    image_url_1x: 'https://static-cdn.jtvnw.net/badges/v1/example/1'
                }
            ]
        }
    ]);
    assert.equal(Object.getPrototypeOf(s), null);
    assert.equal(Object.getPrototypeOf(s.__proto__.versions), null);
});
test('7TV aliases, animation and zero-width behavior follow the source flags', () => {
    const a = new A.Assets(() => {});
    const m = a.normalize(
        {
            emotes: [
                {
                    id: 'id',
                    name: 'Alias',
                    data: {
                        name: 'Original',
                        animated: true,
                        flags: 256,
                        host: {
                            url: '//cdn.7tv.app/emote/id',
                            files: [
                                {
                                    name: '2x.webp',
                                    width: 64,
                                    height: 32
                                }
                            ]
                        }
                    }
                }
            ]
        },
        'canal'
    );
    assert.equal(m.get('Alias').zeroWidth, true);
    assert.equal(m.has('Original'), false);
    assert.equal(m.get('Alias').ratio, 2);
});
test('7TV selects the smallest 1x WebP/AVIF before other variants by size', () => {
    const assets = new A.Assets(() => {});
    const select = (files) =>
        assets
            .normalize(
                {
                    emotes: [
                        {
                            id: 'id',
                            name: 'Alias',
                            data: {
                                animated: true,
                                flags: 256,
                                host: { url: '//cdn.7tv.app/emote/id', files }
                            }
                        }
                    ]
                },
                'channel'
            )
            .get('Alias');
    const variants = [
        { name: '4x.avif', size: 40 },
        { name: '1x.webp', size: 200 },
        { name: '2x.gif', size: 30 },
        { name: '1x.avif', size: 100, width: 64, height: 32 },
        { name: '2x.webp', size: 50 },
        { name: '1x_static.webp', size: 1 },
        { name: '1x.png', size: 1 }
    ];
    const base = 'https://cdn.7tv.app/emote/id/';
    const emote = select(variants);
    assert.equal(emote.src, base + '1x.avif');
    assert.equal(emote.animated, true);
    assert.equal(emote.zeroWidth, true);
    assert.equal(emote.ratio, 2);
    assert.equal(emote.origin, 'channel');
    assert.equal(variants[0].name, '4x.avif');
    assert.equal(
        select([
            { name: '1x.webp', size: 50 },
            { name: '1x.avif', size: 100 }
        ]).src,
        base + '1x.webp'
    );
    assert.equal(
        select(variants.filter((file) => !/^1x\.(webp|avif)$/.test(file.name))).src,
        base + '2x.gif'
    );
    assert.equal(
        select([
            { name: '3x.webp', size: 50 },
            { name: '2x.avif', size: 100 }
        ]).src,
        base + '3x.webp'
    );
    assert.equal(
        select([
            { name: '1x.avif', size: 50 },
            { name: '1x.webp', size: 50 }
        ]).src,
        base + '1x.webp'
    );
    for (const size of [undefined, null, 0, -1, NaN, Infinity, '1']) {
        assert.equal(
            select([
                { name: '1x.webp', size },
                { name: '1x.avif', size: 50 }
            ]).src,
            base + '1x.avif'
        );
        assert.equal(
            select([
                { name: '2x.webp', size },
                { name: '3x.avif', size: 50 }
            ]).src,
            base + '3x.avif'
        );
    }
    assert.equal(select([{ name: '1x.avif' }, { name: '1x.webp' }]).src, base + '1x.webp');
    assert.equal(select([{ name: '1x_static.webp' }, { name: '1x.png' }]), undefined);
});
let calls = 0;
let active = 0;
let maxActive = 0;
const paints = new A.Paints(
    () => {},
    async (_url, options) => {
        calls++;
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        const id = JSON.parse(options.body).variables.id;
        return {
            data: {
                users: {
                    userByConnection:
                        id === '2'
                            ? null
                            : {
                                  style: {
                                      activePaint: id === '3' ? null : paint
                                  }
                              }
                }
            }
        };
    }
);
const results = await Promise.all(
    Array.from(
        {
            length: 20
        },
        () => paints.get('1')
    )
);
test('Twenty concurrent paint requests share one lookup', () => {
    assert.equal(calls, 1);
    assert.ok(results.every((v) => v === results[0]));
});
await paints.get('1');
await Promise.all(['2', '3', '4', '5', '6', '7'].map((id) => paints.get(id)));
test('Paint caches handle unequipped users and limit concurrency to three', () => {
    assert.equal(calls, 7);
    assert.ok(maxActive <= 3);
    assert.equal(paints.cache.get('2').value, null);
    assert.equal(paints.cache.get('3').value, null);
});
let limitedCalls = 0;
const limited = new A.Paints(
    () => {},
    async () => {
        limitedCalls++;
        const e = Error('429');
        e.status = 429;
        e.retryAfter = 10000;
        throw e;
    }
);
await limited.get('1');
await limited.get('2');
test('Paint 429 responses pause lookups and preserve fallback colors', () => {
    assert.equal(limitedCalls, 1);
    assert.ok(limited.cooldown > Date.now());
});
let schemaCalls = 0;
const malformed = new A.Paints(
    () => {},
    async () => {
        schemaCalls++;
        return {
            data: {
                surprise: true
            }
        };
    }
);
assert.equal(await malformed.get('1'), null);
test('Unknown paint schemas preserve fallback colors', () => assert.equal(schemaCalls, 1));
test('Anonymous IRC handles handshake, JOIN deduplication, PONG and clean shutdown', () => {
    const sent = [];
    class Socket {
        constructor() {
            this.readyState = 0;
            Socket.last = this;
        }
        send(s) {
            sent.push(s);
        }
        close() {
            this.readyState = 3;
            this.onclose?.();
        }
    }
    context.WebSocket = Socket;
    const states = [];
    const messages = [];
    const chat = new A.TwitchChat(
        'canal',
        (m) => messages.push(m),
        (s) => states.push(s)
    );
    chat.connect();
    const s = Socket.last;
    s.readyState = 1;
    s.onopen();
    s.onmessage({
        data: ':tmi 001 justinfan :ok\r\n:tmi 001 justinfan :ok\r\nPING :server\r\n@room-id=1 :tmi ROOMSTATE #canal\r\n'
    });
    assert.equal(sent.filter((s) => s.startsWith('JOIN')).length, 1);
    assert.ok(sent.includes('PONG :server\r\n'));
    assert.ok(sent.every((s) => !s.startsWith('PRIVMSG')));
    assert.ok(states.includes('connected'));
    chat.stop();
    assert.equal(s.onmessage, null);
    assert.equal(s.readyState, 3);
});
let httpCalls = 0;
context.fetch = async () => {
    httpCalls++;
    return {
        ok: false,
        status: 429,
        headers: {
            get: () => '1200'
        }
    };
};
await assert.rejects(
    A.fetchJSON('https://7tv.io/test'),
    (e) => e.status === 429 && e.retryAfter === 1200000
);
await assert.rejects(A.fetchJSON('https://7tv.io/other'), (e) => e.status === 429);
test('HTTP Retry-After is respected across endpoints on the same host', () =>
    assert.equal(httpCalls, 1));
const premiumBadge = {
    id: 'premium-fixture',
    name: '7TV Premium',
    images: [
        {
            url: 'https://cdn.7tv.app/badge/premium-fixture/2x.webp',
            mime: 'image/webp',
            scale: 2
        }
    ]
};
test('Equipped 7TV badges validate CDN images and reject external URLs', () => {
    assert.equal(A.sevenTVBadge(premiumBadge).title, '7TV Premium');
    assert.equal(
        A.sevenTVBadge({
            ...premiumBadge,
            images: [
                {
                    url: 'https://evil.org/premium.webp',
                    mime: 'image/webp',
                    scale: 2
                }
            ]
        }),
        null
    );
    assert.equal(A.sevenTVBadge(null), null);
});
let cosmeticCalls = 0;
const cosmetics = new A.Paints(
    () => {},
    async () => {
        cosmeticCalls++;
        await new Promise((r) => setTimeout(r, 2));
        return {
            data: {
                users: {
                    userByConnection: {
                        style: {
                            activePaint: paint,
                            activeBadge: premiumBadge
                        }
                    }
                }
            }
        };
    }
);
const [both, justPaint] = await Promise.all([cosmetics.getCosmetics('123'), cosmetics.get('123')]);
test('Paints and badges share requests, caches and author identity', () => {
    assert.equal(cosmeticCalls, 1);
    assert.ok(both.paint);
    assert.equal(both.badge.id, 'premium-fixture');
    assert.equal(justPaint, both.paint);
});
const badgeOnly = new A.Paints(
    () => {},
    async () => ({
        data: {
            users: {
                userByConnection: {
                    style: {
                        activePaint: null,
                        activeBadge: premiumBadge
                    }
                }
            }
        }
    })
);
assert.equal((await badgeOnly.getCosmetics('124')).badge.id, 'premium-fixture');
assert.equal(await badgeOnly.get('124'), null);
test('Equipped badges remain available when no paint is equipped', () =>
    assert.ok(badgeOnly.cache.get('124').value.badge));
const ownedOnly = new A.Paints(
    () => {},
    async () => ({
        data: {
            users: {
                userByConnection: {
                    style: {
                        activePaint: null,
                        activeBadge: null
                    },
                    inventory: {
                        badges: [premiumBadge]
                    }
                }
            }
        }
    })
);
assert.equal(await ownedOnly.getCosmetics('125'), null);
test('Owned cosmetics are never mistaken for equipped cosmetics', () =>
    assert.equal(ownedOnly.cache.get('125').value, null));
console.log(`${count} tests PASS`);
