import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
class Node {
    constructor(text = null) {
        this.text = text;
        this.children = [];
        this.style = {};
        this.dataset = {};
    }
    get classList() {
        return {
            add: (name) => {
                this.className = [
                    ...new Set([...(this.className || '').split(' ').filter(Boolean), name])
                ].join(' ');
            },
            remove: (name) => {
                this.className = (this.className || '')
                    .split(' ')
                    .filter((c) => c !== name)
                    .join(' ');
            },
            contains: (name) => (this.className || '').split(' ').includes(name)
        };
    }
    append(...nodes) {
        for (const n of nodes) {
            n.parent = this;
            this.children.push(n);
        }
    }
    replaceWith(node) {
        const i = this.parent?.children.indexOf(this);
        if (i >= 0) {
            this.parent.children[i] = node;
            node.parent = this.parent;
        }
    }
    remove() {
        const i = this.parent?.children.indexOf(this);
        if (i >= 0) {
            this.parent.children.splice(i, 1);
        }
    }
    replaceChildren(...nodes) {
        this.text = null;
        this.children = [];
        this.append(...nodes);
    }
    set textContent(text) {
        this.text = text;
        this.children = [];
    }
    get textContent() {
        return this.text ?? this.children.map((n) => n.textContent).join('');
    }
    querySelectorAll(selector) {
        const out = [];
        for (const n of this.children) {
            if (n.classList.contains(selector.slice(1))) {
                out.push(n);
            }
            out.push(...n.querySelectorAll(selector));
        }
        return out;
    }
}
const document = {
    createElement: () => new Node(),
    createTextNode: (text) => new Node(text)
};
const paintImages = [];
class Image {
    constructor() {
        paintImages.push(this);
    }
}
const context = vm.createContext({
    window: {},
    document,
    CSS: {
        supports: () => true
    },
    Image,
    URL,
    clearInterval,
    clearTimeout
});
vm.runInContext(readWidgetScripts(['providers', 'renderer']), context);
const A = context.window.ChatWidget;
const config = {
    colorMentions: true,
    hideBotMessages: true,
    hideCommands: true,
    botLogins: ['nightbot']
};
let count = 0;
const test = (name, fn) => {
    fn();
    console.log('PASS', name);
    count++;
};
test('Filters recognize whitespace and ACTION commands and listed bot logins', () => {
    assert.ok(A.hideMessage(config, 'alice', '  !hola'));
    assert.ok(A.hideMessage(config, 'alice', '\x01ACTION !hola\x01'));
    assert.ok(A.hideMessage(config, 'NightBot', 'Respuesta automática'));
    assert.equal(A.hideMessage(config, 'alice', '¡Hola!'), false);
    assert.equal(A.hideMessage(config, 'alice', 'Esto contiene !hola'), false);
    assert.equal(
        A.hideMessage(
            {
                ...config,
                hideCommands: false
            },
            'alice',
            '!hola'
        ),
        false
    );
});
test('Filters support comma-separated literal prefixes, empty values and ACTION', () => {
    const custom = { ...config, commandPrefixes: ' !, /, $, hola , , ' };
    for (const text of [
        '!comando',
        '  /comando',
        '$consulta',
        'hola chat',
        '\x01ACTION /saluda\x01'
    ]) {
        assert.equal(A.hideMessage(custom, 'alice', text), true, text);
        assert.equal(A.hideMessage({ ...custom, hideCommands: false }, 'alice', text), false, text);
    }
    for (const text of ['mensaje normal', 'Hola chat', 'texto !comando']) {
        assert.equal(A.hideMessage(custom, 'alice', text), false, text);
    }
    assert.equal(A.hideMessage({ ...config, commandPrefixes: '/' }, 'alice', '!visible'), false);
    assert.equal(
        A.hideMessage({ ...config, commandPrefixes: ' , , ' }, 'alice', '!visible'),
        false
    );
    assert.equal(A.hideMessage({ ...config, commandPrefixes: '' }, 'alice', '!visible'), false);
});
const r = Object.create(A.Renderer.prototype);
Object.assign(r, {
    config,
    root: new Node(),
    userColors: new Map(),
    userPaints: new Map(),
    assets: {
        emote: () => null
    }
});
r.rememberColor('alice', 'Alice', '#12ab34');
test('Mentions use case-insensitive user colors and preserve punctuation and Unicode', () => {
    const node = new Node();
    r.appendText(node, '😀 Hola,(@ALICE)! y @bob.');
    r.root.append(node);
    assert.equal(node.textContent, ' Hola,(@ALICE)! y @bob.');
    assert.equal(node.querySelectorAll('.twemoji')[0].alt, '😀');
    const mentions = node.querySelectorAll('.mention');
    assert.equal(mentions.length, 2);
    assert.equal(mentions[0].style.color, '#12ab34');
    assert.equal(mentions[1].style.color, undefined);
});
test('Existing mentions update when their user speaks or changes color', () => {
    r.rememberColor('bob', 'Bob', '#aabbcc');
    assert.equal(r.root.querySelectorAll('.mention')[1].style.color, '#aabbcc');
    r.rememberColor('alice', 'Alice', '#ff0000');
    assert.equal(r.root.querySelectorAll('.mention')[0].style.color, '#ff0000');
});

test('Known names without @ use mention colors and preserve the original text', () => {
    const node = new Node();
    const text = 'Hola, (ALICE)! bob, desconocido y @desconocido.';
    r.appendText(node, text);
    assert.equal(node.textContent, text);
    const mentions = node.querySelectorAll('.mention');
    assert.deepEqual(
        mentions.map((n) => n.textContent),
        ['ALICE', 'bob', '@desconocido']
    );
    assert.equal(mentions[0].style.color, '#ff0000');
    assert.equal(mentions[1].style.color, '#aabbcc');
});

test('Bare names match whole words and leave emails and URL paths untouched', () => {
    const node = new Node();
    const text =
        'malice alice_extra aliceé éalice alice\u0301 alice@example.com correo@alice.com https://example.com/alice alice.com alice.';
    r.appendMentions(node, text);
    assert.equal(node.textContent, text);
    assert.deepEqual(
        node.querySelectorAll('.mention').map((n) => n.textContent),
        ['alice']
    );
});

test('Disabling mention colors also disables bare-name highlighting', () => {
    const renderer = Object.create(r);
    renderer.config = { ...config, colorMentions: false };
    const node = new Node();
    renderer.appendText(node, 'alice @alice');
    assert.equal(node.textContent, 'alice @alice');
    assert.equal(node.querySelectorAll('.mention').length, 0);
});
test('Mentions do not match email addresses, overlong logins or HTML', () => {
    const text = 'correo@alice.com @abcdefghijklmnopqrstuvwxyz <script>alert(1)</script> @alice';
    const node = new Node();
    r.appendText(node, text);
    assert.equal(node.textContent, text);
    assert.equal(node.querySelectorAll('.mention').length, 1);
    assert.equal(node.children.filter((n) => n.className).length, 1);
});
test('Native and 7TV emotes resolve before mention coloring', () => {
    r.config = {
        ...config,
        showTwitchEmotes: true,
        showSevenTVEmotes: true
    };
    const node = new Node();
    r.body(node, 'Kappa @alice', '25:0-4');
    assert.equal(node.querySelectorAll('.emote-stack').length, 1);
    assert.equal(node.querySelectorAll('.mention').length, 1);
    r.assets.emote = (token) =>
        token === '@alice' || token === 'alice'
            ? {
                  src: 'https://cdn.7tv.app/example',
                  ratio: 1
              }
            : null;
    r.body(node, '@alice', '');
    assert.equal(node.querySelectorAll('.emote-stack').length, 1);
    assert.equal(node.querySelectorAll('.mention').length, 0);
    r.body(node, 'alice', '');
    assert.equal(node.querySelectorAll('.emote-stack').length, 1);
    assert.equal(node.querySelectorAll('.mention').length, 0);
});
test('Bots and commands are discarded before nodes or paint lookups are created', () => {
    r.rows = [];
    for (const [login, text] of [
        ['nightbot', 'Respuesta'],
        ['alice', ' !comando']
    ]) {
        r.add({
            tags: {},
            prefix: login + '!x',
            params: ['#canal', text]
        });
    }
    assert.equal(r.rows.length, 0);
});
test('Cheers select the correct amount tier and reject malformed numbers', () => {
    for (const [amount, tier] of [
        [1, 1],
        [50, 1],
        [99, 1],
        [100, 100],
        [999, 100],
        [1000, 1000],
        [5000, 5000],
        [10000, 10000]
    ]) {
        assert.ok(A.cheerToken('Cheer' + amount, amount).src.includes('/' + tier + '/2.gif'));
    }
    for (const token of [
        'Cheer0',
        'Cheer-1',
        'Cheer1.5',
        'xCheer50',
        'Cheer9007199254740993',
        'Custom50'
    ]) {
        assert.equal(A.cheerToken(token, 100), null);
    }
    assert.equal(A.cheerToken('Cheer100', 50), null);
});
test('Cheer50 shows its animation and amount only with confirmed Bits', () => {
    const node = new Node();
    r.body(node, 'Cheer50 gracias', '', '50');
    assert.equal(node.querySelectorAll('.cheer').length, 1);
    assert.equal(node.querySelectorAll('.cheer-amount')[0].textContent, '50');
    assert.equal(node.querySelectorAll('.cheer-icon')[0].alt, 'Cheer50');
    r.body(node, 'Cheer50 gracias', '');
    assert.equal(node.querySelectorAll('.cheer').length, 0);
    assert.equal(node.textContent, 'Cheer50 gracias');
});
test('Multiple Cheers and emoji preserve Twitch ranges, mentions and 7TV emotes', () => {
    r.assets.emote = (token) =>
        token === 'WAVE'
            ? {
                  src: 'https://cdn.7tv.app/example',
                  ratio: 1
              }
            : null;
    const node = new Node();
    r.body(node, 'Cheer50 😀 Kappa Cheer100 @alice WAVE', '25:10-14', '150');
    assert.equal(node.querySelectorAll('.cheer').length, 2);
    assert.equal(node.querySelectorAll('.emote-stack').length, 2);
    assert.equal(node.querySelectorAll('.mention').length, 1);
    r.body(node, 'Cheer50 Cheer100', '', '50');
    assert.equal(node.querySelectorAll('.cheer').length, 1);
    assert.ok(node.textContent.endsWith(' Cheer100'));
});
test('Failed Cheer images restore their original token exactly once', () => {
    const node = new Node();
    r.body(node, 'Cheer50 gracias', '', '50');
    node.querySelectorAll('.cheer-icon')[0].onerror();
    assert.equal(node.textContent, 'Cheer50 gracias');
    assert.equal(node.querySelectorAll('.cheer-amount').length, 0);
});
test('Asset refreshes preserve the Bits tag and rendered Cheers', () => {
    const node = new Node();
    const renderer = Object.create(r);
    renderer.rows = [
        {
            body: node,
            text: 'Cheer50 gracias',
            emotes: '',
            t: {
                bits: '50'
            }
        }
    ];
    renderer.badges = () => {};
    renderer.fit = () => {};
    renderer.refresh();
    assert.equal(node.querySelectorAll('.cheer').length, 1);
});
const gradient = {
    backgroundImage: 'linear-gradient(90deg, rgb(150, 50, 255), rgb(30, 240, 70))',
    filter: ''
};
test('Late 7TV paints update existing and new mentions', () => {
    r.config = {
        ...r.config,
        showSevenTVPaints: true
    };
    r.rememberColor('pixelot', 'pixelot', '#b8b2ff');
    const node = new Node();
    r.appendText(node, '@pixelot @alice');
    r.root.append(node);
    assert.equal(node.querySelectorAll('.painted').length, 0);
    r.rememberPaint('pixelot', 'pixelot', gradient);
    assert.equal(
        node.querySelectorAll('.mention')[0].style.backgroundImage,
        gradient.backgroundImage
    );
    assert.equal(node.querySelectorAll('.mention')[1].classList.contains('painted'), false);
    const later = new Node();
    r.appendText(later, '@PIXELOT');
    assert.equal(later.querySelectorAll('.painted').length, 1);
    assert.equal(later.textContent, '@PIXELOT');
});

test('Bare-name mentions receive late paints, color changes and paint removal', () => {
    const node = new Node();
    r.rememberColor('bare_user', 'Bare_User', '#123456');
    r.appendText(node, 'Bare_User');
    r.root.append(node);
    const mention = node.querySelectorAll('.mention')[0];
    assert.equal(mention.style.color, '#123456');
    r.rememberPaint('bare_user', 'Bare_User', gradient);
    assert.equal(mention.style.backgroundImage, gradient.backgroundImage);
    const later = new Node();
    r.appendText(later, 'BARE_USER');
    assert.equal(later.querySelectorAll('.painted').length, 1);
    r.rememberColor('bare_user', 'Bare_User', '#654321');
    r.rememberPaint('bare_user', 'Bare_User', null);
    assert.equal(mention.classList.contains('painted'), false);
    assert.equal(mention.style.color, '#654321');
});
test('Users keep separate mention paints and removing a paint restores color', () => {
    const other = {
        backgroundImage: 'linear-gradient(90deg, red, blue)',
        filter: ''
    };
    r.rememberPaint('alice', 'Alice', other);
    const node = new Node();
    r.appendText(node, '@pixelot @alice');
    r.root.append(node);
    assert.equal(
        node.querySelectorAll('.mention')[0].style.backgroundImage,
        gradient.backgroundImage
    );
    assert.equal(node.querySelectorAll('.mention')[1].style.backgroundImage, other.backgroundImage);
    r.rememberPaint('pixelot', 'pixelot', null);
    const mention = node.querySelectorAll('.mention')[0];
    assert.equal(mention.classList.contains('painted'), false);
    assert.equal(mention.style.color, '#b8b2ff');
    assert.equal(mention.style.backgroundImage, '');
});
test('Mentions and reply users share the username gradient until a 7TV paint applies', () => {
    const previous = r.config;
    r.config = { ...previous, usernameGradient: true, showSevenTVPaints: true };
    r.rememberColor('grad', 'Grad', '#204080');
    const node = new Node();
    r.appendText(node, '@grad');
    r.root.append(node);
    const mention = node.querySelectorAll('.mention')[0];
    assert.ok(mention.classList.contains('painted'));
    assert.match(mention.style.backgroundImage, /^linear-gradient\(180deg, .*#204080 50%/);
    r.tombstones ||= new Map();
    const reply = r.replyContext(
        { 'reply-parent-msg-id': 'p', 'reply-parent-user-login': 'grad' },
        'twitch'
    );
    const replyUser = reply.mention;
    r.root.append(reply.node);
    assert.equal(replyUser.style.backgroundImage, mention.style.backgroundImage);
    r.rememberColor('grad', 'Grad', '#802040');
    assert.match(mention.style.backgroundImage, /#802040 50%/);
    assert.match(replyUser.style.backgroundImage, /#802040 50%/);
    r.rememberPaint('grad', 'Grad', gradient);
    assert.equal(mention.style.backgroundImage, gradient.backgroundImage);
    r.rememberColor('grad', 'Grad', '#408020');
    assert.equal(mention.style.backgroundImage, gradient.backgroundImage);
    r.rememberPaint('grad', 'Grad', null);
    assert.match(mention.style.backgroundImage, /#408020 50%/);
    r.config = previous;
});
test('Failed paint textures restore a readable username color', () => {
    const node = new Node();
    node.style.color = '#123456';
    r.applyPaint(node, {
        backgroundImage: 'url("https://cdn.7tv.app/paint/example/2x.webp")',
        filter: ''
    });
    assert.ok(node.classList.contains('painted'));
    paintImages.at(-1).onerror();
    assert.equal(node.classList.contains('painted'), false);
    assert.equal(node.style.color, '#123456');
});
test('Authors without an IRC color share their fallback color with mentions', () => {
    const rr = Object.create(A.Renderer.prototype);
    Object.assign(rr, {
        config: {
            maxMessages: 35
        },
        assets: {
            channelId: '100'
        },
        root: new Node(),
        rows: [],
        seen: new Map(),
        tombstones: new Map(),
        userClears: new Map(),
        userColors: new Map(),
        userPaints: new Map(),
        roomClear: 0
    });
    rr.add({
        tags: {
            id: 'no-color',
            'display-name': 'Pixelot'
        },
        prefix: 'pixelot!x',
        params: ['#canal', 'Hola']
    });
    const node = new Node();
    rr.appendText(node, '@pixelot');
    assert.equal(node.querySelectorAll('.mention')[0].style.color, rr.rows[0].name.style.color);
});
test('Equipped 7TV badges follow Twitch badges and respect size, alignment and settings', () => {
    const node = new Node();
    const renderer = Object.create(r);
    renderer.config = {
        showBadges: true,
        showSevenTVBadges: true
    };
    renderer.assets = {
        badge: () => ({
            title: 'Moderator',
            image_url_4x: 'https://static-cdn.jtvnw.net/badges/v1/mod/3'
        })
    };
    const badge = {
        title: '7TV Premium',
        src: 'https://cdn.7tv.app/badge/premium-fixture/2x.webp'
    };
    renderer.badges(
        node,
        {
            badges: 'moderator/1'
        },
        badge
    );
    assert.equal(node.children.length, 2);
    assert.equal(node.children[0].title, 'Moderator');
    assert.equal(node.children[1].title, '7TV · 7TV Premium');
    assert.equal(node.children[1].className, 'badge');
    renderer.config.showSevenTVBadges = false;
    renderer.badges(
        node,
        {
            badges: 'moderator/1'
        },
        badge
    );
    assert.equal(node.children.length, 1);
});
test('Twitch and 7TV refreshes preserve each messages equipped badge', () => {
    const renderer = Object.create(r);
    renderer.config = {
        showBadges: true,
        showSevenTVBadges: true
    };
    renderer.assets = {
        badge: () => null
    };
    const badges = new Node();
    renderer.rows = [
        {
            badges,
            body: new Node(),
            text: 'Hola',
            emotes: '',
            t: {},
            sevenTVBadge: {
                title: '7TV Premium',
                src: 'https://cdn.7tv.app/badge/premium-fixture/2x.webp'
            }
        }
    ];
    renderer.fit = () => {};
    renderer.refresh();
    assert.equal(badges.children.length, 1);
    assert.equal(badges.children[0].title, '7TV · 7TV Premium');
});
let releaseSource;
const sourceGate = new Promise((resolve) => {
    releaseSource = resolve;
});
let sourceCalls = 0;
const sourceAssets = new A.Assets(
    () => {},
    async (url) => {
        sourceCalls++;
        await sourceGate;
        return url.includes('api.ivr.fi')
            ? [
                  {
                      set_id: 'subscriber',
                      versions: [
                          {
                              id: '6',
                              title: 'Sub de origen, 6 meses',
                              image_url_4x: 'https://static-cdn.jtvnw.net/badges/v1/origin/3'
                          }
                      ]
                  }
              ]
            : {
                  emote_set: {
                      emotes: [
                          {
                              id: 'source-emote',
                              name: 'ALIAS',
                              data: {
                                  flags: 0,
                                  host: {
                                      url: '//cdn.7tv.app/emote/source',
                                      files: [
                                          {
                                              name: '2x.webp',
                                              width: 64,
                                              height: 64
                                          }
                                      ]
                                  }
                              }
                          }
                      ]
                  }
              };
    }
);
sourceAssets.channelId = '100';
sourceAssets.config = {
    showBadges: true,
    showSevenTVEmotes: true
};
sourceAssets.channelBadges = {
    subscriber: {
        versions: {
            6: {
                title: 'NO es el sub de origen'
            }
        }
    }
};
const sharedRenderer = Object.create(A.Renderer.prototype);
Object.assign(sharedRenderer, {
    config: {
        showBadges: true,
        showSevenTVEmotes: true,
        showTwitchEmotes: true,
        showSevenTVBadges: false,
        maxMessages: 35
    },
    assets: sourceAssets,
    root: new Node(),
    rows: [],
    seen: new Map(),
    tombstones: new Map(),
    userClears: new Map(),
    userColors: new Map(),
    userPaints: new Map(),
    roomClear: 0
});
sourceAssets.listeners.add(() => sharedRenderer.refresh());
const sharedMessage = {
    tags: {
        id: 'shared-copy',
        'source-id': 'shared-original',
        'room-id': '100',
        'source-room-id': '200',
        'source-badges': 'subscriber/6',
        badges: 'moderator/1',
        emotes: '25:2-6'
    },
    prefix: 'shareduser!x',
    params: ['#canal', '😀 Kappa ALIAS']
};
sharedRenderer.add(sharedMessage);
test('Shared Chat renders immediately and requests the origin channel assets', () => {
    assert.equal(sharedRenderer.rows.length, 1);
    assert.equal(sourceCalls, 2);
    assert.equal(sharedRenderer.rows[0].badges.children.length, 0);
    assert.ok(sharedRenderer.rows[0].body.textContent.includes('ALIAS'));
});
const sourcePending = sourceAssets.sourceChannels.get('200').pending;
releaseSource();
await sourcePending;
test('Shared Chat asset arrival updates existing badges and 7TV emotes', () => {
    const row = sharedRenderer.rows[0];
    assert.equal(row.badges.children[0].title, 'Sub de origen, 6 meses');
    assert.equal(row.body.querySelectorAll('.emote-stack').length, 2);
    assert.equal(sourceAssets.channelId, '100');
});
sharedRenderer.add({
    ...sharedMessage,
    tags: {
        ...sharedMessage.tags,
        id: 'another-copy'
    }
});
test('Late Shared Chat assets preserve source-id deduplication', () =>
    assert.equal(sharedRenderer.rows.length, 1));
sourceAssets.stop();
test('Shared Chat origin icon is the first badge, optional and independent of badges', () => {
    const renderer = Object.create(A.Renderer.prototype);
    const requested = [];
    renderer.assets = {
        channelAvatar: (id) => {
            requested.push(id);
            return {
                src: 'https://static-cdn.jtvnw.net/jtv_user_pictures/' + id + '.png',
                name: 'Chan' + id
            };
        },
        badge: () => ({ title: 'Mod', image_url_1x: 'https://static-cdn.jtvnw.net/badges/v1/m/1' })
    };
    const tags = { 'room-id': '100', 'source-room-id': '200', badges: 'moderator/1' };
    const render = (config, messageTags = tags) => {
        renderer.config = config;
        const node = new Node();
        renderer.badges(node, messageTags);
        return node.children;
    };
    const shown = render({ showBadges: true });
    assert.equal(shown.length, 2);
    assert.equal(shown[0].className, 'badge shared-chat-icon');
    assert.equal(shown[0].title, 'Chan200');
    assert.equal(shown[1].title, 'Mod');
    assert.equal(render({ showBadges: false })[0].className, 'badge shared-chat-icon');
    assert.equal(render({ showBadges: true, showSharedChatIcon: false }).length, 1);
    assert.equal(render({ showBadges: true }, { badges: 'moderator/1' }).length, 1);
    assert.deepEqual(requested, ['200', '200']);
});
test('Provider icons use DuckDuckGo and handle visibility and unknown providers', () => {
    const renderer = Object.create(r);
    renderer.config = {
        showProviderIcon: true
    };
    const icon = renderer.providerIcon('twitch');
    assert.equal(icon.src, 'https://icons.duckduckgo.com/ip3/twitch.tv.ico');
    assert.equal(icon.referrerPolicy, 'no-referrer');
    assert.equal(icon.alt, 'Twitch');
    assert.equal(icon.title, 'Twitch (twitch.tv)');
    assert.equal(renderer.providerIcon('https://evil.org/favicon.ico'), null);
    assert.equal(renderer.providerIcon('__proto__'), null);
    renderer.config.showProviderIcon = false;
    assert.equal(renderer.providerIcon('twitch'), null);
});
const providerRenderer = Object.create(A.Renderer.prototype);
Object.assign(providerRenderer, {
    config: {
        maxMessages: 35,
        showProviderIcon: true,
        showBadges: false
    },
    assets: {
        channelId: '100'
    },
    root: new Node(),
    rows: [],
    seen: new Map(),
    tombstones: new Map(),
    userClears: new Map(),
    userColors: new Map(),
    userPaints: new Map(),
    roomClear: 0
});
providerRenderer.add({
    provider: 'twitch',
    tags: {
        id: 'provider-test',
        'display-name': 'Alice'
    },
    prefix: 'alice!x',
    params: ['#canal', 'Hola']
});
test('Provider icons precede badges and names independently of showBadges', () => {
    const row = providerRenderer.rows[0];
    assert.equal(row.provider, 'twitch');
    const content = row.row.children[0];
    assert.equal(content.className, 'message-content');
    assert.equal(content.children[0].className, 'provider-icon');
    assert.equal(content.children[1], row.badges);
    assert.equal(content.children[2], row.name);
});
test('Provider icon refreshes and image failures preserve the message', () => {
    const row = providerRenderer.rows[0];
    const icon = row.row.children[0].children[0];
    providerRenderer.refresh();
    assert.equal(row.row.children[0].children[0], icon);
    icon.onerror();
    assert.equal(row.row.querySelectorAll('.provider-icon').length, 0);
    assert.equal(row.name.textContent, 'Alice');
    assert.equal(row.body.textContent, 'Hola');
});
const multi = Object.create(A.Renderer.prototype);
Object.assign(multi, {
    config: {
        maxMessages: 35,
        showBadges: true,
        showSevenTVBadges: false,
        showSevenTVEmotes: true
    },
    assets: {
        channelId: 'default'
    },
    root: new Node(),
    rows: [],
    seen: new Map(),
    tombstones: new Map(),
    userClears: new Map(),
    roomClears: new Map(),
    userColors: new Map(),
    userPaints: new Map(),
    roomClear: 0,
    sourceAssets: new Map()
});
for (const [key, room] of [
    ['twitch:alpha', '1'],
    ['twitch:beta', '2'],
    ['twitch:gamma', '11'],
    ['twitch:delta', '12']
]) {
    multi.sourceAssets.set(key, {
        channelId: room,
        badge: () => ({
            title: key,
            image_url_4x: 'https://static-cdn.jtvnw.net/badges/v1/' + room + '/3'
        }),
        emote: (token) =>
            token === 'ALIAS'
                ? {
                      src: 'https://cdn.7tv.app/emote/' + room + '/2x.webp',
                      ratio: 1
                  }
                : null
    });
}
const multiAdd = (sourceId, id, user = '42', extra = {}) =>
    multi.add({
        provider: sourceId.split(':')[0],
        sourceId,
        tags: {
            id,
            'user-id': user,
            'display-name': 'Alice',
            badges: 'subscriber/6',
            ...extra
        },
        prefix: 'alice!x',
        params: ['#channel', 'ALIAS']
    });
for (const sourceId of multi.sourceAssets.keys()) {
    multiAdd(sourceId, 'same');
}
test('Multiple sources keep channel emotes and badges separate', () => {
    assert.equal(multi.rows.length, 4);
    for (const row of multi.rows) {
        assert.equal(row.badges.children[0].title, row.sourceId);
        assert.ok(
            row.body
                .querySelectorAll('.emote')[0]
                .src.includes('/' + multi.sourceAssets.get(row.sourceId).channelId + '/')
        );
    }
});
multi.moderate({
    provider: 'twitch',
    sourceId: 'twitch:alpha',
    command: 'CLEARMSG',
    tags: {
        'target-msg-id': 'same'
    },
    params: []
});
test('Deleting an ID affects only the source that received the command', () => {
    assert.equal(multi.rows.length, 3);
    assert.ok(multi.rows.some((r) => r.sourceId === 'twitch:beta'));
});
multi.moderate({
    provider: 'twitch',
    sourceId: 'twitch:gamma',
    command: 'CLEARCHAT',
    tags: {
        'target-user-id': '42'
    },
    params: ['#c', 'alice']
});
test('Banning a user in one source preserves their messages in other sources', () => {
    assert.equal(multi.rows.length, 2);
    assert.ok(multi.rows.some((r) => r.sourceId === 'twitch:delta'));
});
multi.moderate({
    provider: 'twitch',
    sourceId: 'twitch:beta',
    command: 'CLEARCHAT',
    tags: {},
    params: ['#c']
});
test('Clearing one source preserves all other sources', () => {
    assert.equal(multi.rows.length, 1);
    assert.equal(multi.rows[0].sourceId, 'twitch:delta');
});
const beforeShared = multi.rows.length;
multiAdd('twitch:alpha', 'shared-copy-a', '77', {
    'source-id': 'shared-origin',
    'source-room-id': '5',
    'tmi-sent-ts': String(Date.now() + 1000)
});
multiAdd('twitch:beta', 'shared-copy-b', '77', {
    'source-id': 'shared-origin',
    'source-room-id': '5',
    'tmi-sent-ts': String(Date.now() + 1000)
});
test('Shared Chat messages remain deduplicated across multiple sources', () =>
    assert.equal(multi.rows.length, beforeShared + 1));
test('Character art is discarded before nodes, catalogs, colors or cosmetic lookups', () => {
    const renderer = Object.create(A.Renderer.prototype);
    renderer.config = {
        characterArtFilter: {
            enabled: true
        }
    };
    renderer.rows = [];
    renderer.rememberColor = () => {
        throw Error('Color updates must not run');
    };
    renderer.assetsFor = () => {
        throw Error('Catalog lookups must not run');
    };
    renderer.paints = {
        getCosmetics: () => {
            throw Error('7TV lookups must not run');
        }
    };
    const createElement = document.createElement;
    let nodes = 0;
    document.createElement = () => {
        nodes++;
        throw Error('DOM creation must not run');
    };
    const pastedArt = readFileSync(
        new URL('../fixtures/character-art-flattened.txt', import.meta.url),
        'utf8'
    ).trimEnd();
    try {
        for (const provider of ['twitch']) {
            for (const text of ['⣿'.repeat(300), pastedArt]) {
                renderer.add({
                    provider,
                    tags: {
                        id: 'art-test',
                        'user-id': '42'
                    },
                    prefix: 'viewer!x',
                    params: ['#channel', text]
                });
            }
        }
        assert.equal(nodes, 0);
        assert.equal(renderer.rows.length, 0);
    } finally {
        document.createElement = createElement;
    }
});
function firstMessageRenderer(config = {}) {
    const renderer = Object.create(A.Renderer.prototype);
    Object.assign(renderer, {
        config: {
            maxMessages: 35,
            ...config
        },
        assets: {},
        root: new Node(),
        rows: [],
        seen: new Map(),
        tombstones: new Map(),
        userClears: new Map(),
        userColors: new Map(),
        userPaints: new Map(),
        roomClear: 0
    });
    return renderer;
}
const firstMessage = (id, tags = {}, provider = 'twitch') => ({
    provider,
    tags: {
        id,
        'display-name': 'Alice',
        ...tags
    },
    prefix: 'alice!x',
    params: ['#canal', 'Hola @bob']
});
test('Twitch first-msg adds a label before content and preserves author and text', () => {
    const renderer = firstMessageRenderer();
    renderer.add(
        firstMessage('first', {
            'first-msg': '1',
            color: '#abcdef'
        })
    );
    const record = renderer.rows[0];
    assert.ok(record.row.classList.contains('first-message'));
    assert.equal(record.row.children[0].className, 'first-message-label');
    assert.equal(record.row.children[0].textContent, 'FIRST-TIME CHATTER');
    assert.equal(record.name.style.color, '#abcdef');
    assert.equal(record.body.textContent, 'Hola @bob');
});
test('New session users and unrelated tags do not imply first-msg', () => {
    const renderer = firstMessageRenderer();
    for (const [id, tags] of [
        ['normal', {}],
        [
            'zero',
            {
                'first-msg': '0'
            }
        ],
        [
            'invalid',
            {
                'first-msg': 'true'
            }
        ],
        [
            'returning',
            {
                'returning-chatter': '1'
            }
        ]
    ]) {
        renderer.add(firstMessage(id, tags));
    }
    renderer.add(
        firstMessage(
            'other',
            {
                'first-msg': '1'
            },
            'unsupported'
        )
    );
    for (const record of renderer.rows) {
        assert.equal(record.row.classList.contains('first-message'), false);
        assert.equal(record.row.querySelectorAll('.first-message-label').length, 0);
    }
});
test('First-message highlighting can be disabled and respects message filters', () => {
    let renderer = firstMessageRenderer({
        highlightFirstMessages: false
    });
    renderer.add(
        firstMessage('disabled', {
            'first-msg': '1'
        })
    );
    assert.equal(renderer.rows[0].row.classList.contains('first-message'), false);
    renderer = firstMessageRenderer({
        hideCommands: true
    });
    const message = firstMessage('filtered', {
        'first-msg': '1'
    });
    message.params[1] = '!comando';
    renderer.add(message);
    assert.equal(renderer.rows.length, 0);
});
test('First-message highlighting supports replies, refreshes and complete moderation removal', () => {
    const renderer = firstMessageRenderer();
    renderer.add(
        firstMessage('reply', {
            'first-msg': '1',
            'reply-parent-msg-id': 'parent',
            'reply-parent-user-login': 'bob'
        })
    );
    const record = renderer.rows[0];
    assert.ok(record.reply);
    assert.equal(record.row.children[1], record.reply.node);
    renderer.refresh();
    assert.equal(record.row.querySelectorAll('.first-message-label').length, 1);
    assert.equal(record.body.textContent, 'Hola @bob');
    renderer.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'reply'
        },
        params: []
    });
    assert.equal(renderer.rows.length, 0);
    assert.equal(renderer.root.children.length, 0);
});
test('First-message backgrounds can be disabled without removing the label or border', () => {
    const renderer = firstMessageRenderer({
        firstMessageBackground: false
    });
    renderer.add(
        firstMessage('no-background', {
            'first-msg': '1'
        })
    );
    assert.ok(renderer.rows[0].row.classList.contains('first-message'));
    assert.equal(renderer.rows[0].row.classList.contains('first-message-background'), false);
    assert.equal(renderer.rows[0].row.querySelectorAll('.first-message-label').length, 1);
    const enabled = firstMessageRenderer();
    enabled.add(
        firstMessage('background', {
            'first-msg': '1'
        })
    );
    assert.ok(enabled.rows[0].row.classList.contains('first-message-background'));
});
test('Detected redemptions show a notice and preserve text, colors and emotes', () => {
    const renderer = firstMessageRenderer({
        showTwitchEmotes: true
    });
    const message = firstMessage('reward', {
        'custom-reward-id': 'reward-id',
        color: '#abcdef',
        emotes: '25:0-4'
    });
    message.params[1] = 'Kappa hola';
    renderer.add(message);
    const record = renderer.rows[0];
    assert.ok(record.row.classList.contains('channel-points-redemption'));
    assert.equal(
        record.row.querySelectorAll('.redemption-context')[0].textContent,
        '◈ Redeemed a Channel Points reward'
    );
    assert.equal(record.name.style.color, '#abcdef');
    assert.equal(record.body.querySelectorAll('.emote')[0].alt, 'Kappa');
    renderer.refresh();
    assert.equal(record.row.querySelectorAll('.redemption-context').length, 1);
    renderer.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'reward'
        },
        params: []
    });
    assert.equal(renderer.root.children.length, 0);
});
test('Highlighted messages have distinct notices without invented reward titles or costs', () => {
    const renderer = firstMessageRenderer();
    renderer.add(
        firstMessage('highlight', {
            'msg-id': 'highlighted-message'
        })
    );
    assert.equal(
        renderer.rows[0].row.querySelectorAll('.redemption-context')[0].textContent,
        '◈ Highlighted a message with Channel Points'
    );
});
test('Disabled redemption notices preserve chat and ordinary messages remain unchanged', () => {
    const renderer = firstMessageRenderer({
        showChannelPointRedemptions: false
    });
    renderer.add(
        firstMessage('disabled', {
            'custom-reward-id': 'reward'
        })
    );
    assert.equal(renderer.rows[0].row.querySelectorAll('.redemption-context').length, 0);
    assert.equal(renderer.rows[0].body.textContent, 'Hola @bob');
    const normal = firstMessageRenderer();
    normal.add(firstMessage('normal'));
    normal.add(
        firstMessage('empty', {
            'custom-reward-id': ' '
        })
    );
    normal.add(
        firstMessage(
            'other',
            {
                'custom-reward-id': 'reward'
            },
            'unsupported'
        )
    );
    assert.ok(
        normal.rows.every((record) => !record.row.classList.contains('channel-points-redemption'))
    );
});
test('Link labels use domains, hostname-only favicons and independent settings', () => {
    const renderer = Object.assign(Object.create(A.Renderer.prototype), {
        config: { showLinkLabels: true, showLinkFavicons: true, colorMentions: true },
        userColors: new Map([['alice', '#abcdef']]),
        userPaints: new Map(),
        fit: () => {}
    });
    const text = 'Mira (https://www.youtube.com/watch?v=secreto&email=@alice), @alice';
    const node = new Node();
    renderer.appendText(node, text);
    assert.equal(node.textContent, 'Mira (YOUTUBE.COM), @alice');
    assert.equal(node.querySelectorAll('.mention').length, 1);
    const label = node.querySelectorAll('.link-label')[0];
    assert.equal(label.title, 'https://www.youtube.com/watch?v=secreto&email=@alice');
    const icon = label.querySelectorAll('.link-favicon')[0];
    assert.equal(icon.src, 'https://icons.duckduckgo.com/ip3/www.youtube.com.ico');
    assert.equal(icon.referrerPolicy, 'no-referrer');
    icon.onerror();
    assert.equal(label.textContent, 'YOUTUBE.COM');
    assert.equal(label.querySelectorAll('.link-favicon').length, 0);
    renderer.config.showLinkFavicons = false;
    const noIcons = new Node();
    renderer.appendText(noIcons, text);
    assert.equal(noIcons.querySelectorAll('.link-label').length, 1);
    assert.equal(noIcons.querySelectorAll('.link-favicon').length, 0);
    renderer.config.showLinkLabels = false;
    const plain = new Node();
    renderer.appendText(plain, text);
    assert.equal(plain.textContent, text);
    assert.equal(plain.querySelectorAll('.link-label').length, 0);
    renderer.config.showLinkLabels = true;
    const action = new Node();
    action.className = 'body action-body';
    renderer.appendText(action, 'https://youtube.com @alice');
    assert.equal(action.querySelectorAll('.link-label').length, 1);
    assert.equal(action.querySelectorAll('.mention').length, 0);
});
test('Twitch link labels respect the destination channel, language and asset refreshes', () => {
    const renderer = Object.assign(Object.create(A.Renderer.prototype), {
        config: { language: 'es', showLinkFavicons: false },
        userColors: new Map(),
        userPaints: new Map(),
        fit: () => {}
    });
    const node = new Node();
    node._chatChannel = 'alice';
    const text =
        'twitch.tv/alice twitch.tv/alice/clip/Example twitch.tv/bob/clip/Example clips.twitch.tv/Example twitch.tv/videos/123';
    renderer.body(node, text, '');
    assert.equal(
        node
            .querySelectorAll('.link-label')
            .map((label) => label.textContent)
            .join('|'),
        '@alice|CLIP|CLIP|CLIP|VÍDEO DE TWITCH'
    );
    node._chatChannel = 'bob';
    renderer.config.language = 'en';
    renderer.body(node, text, '');
    assert.equal(
        node
            .querySelectorAll('.link-label')
            .map((label) => label.textContent)
            .join('|'),
        '@alice|CLIP|CLIP|CLIP|TWITCH VIDEO'
    );
    renderer.config.showLinkFavicons = true;
    const icons = new Node();
    renderer.appendText(icons, 'clips.twitch.tv/Example');
    assert.equal(
        icons.querySelectorAll('.link-favicon')[0].src,
        'https://icons.duckduckgo.com/ip3/twitch.tv.ico'
    );
});
test('Disabled GIF images use a label even when link labels are disabled', () => {
    const renderer = Object.create(A.Renderer.prototype);
    renderer.config = { showTwitchGifs: false, showLinkLabels: false };
    renderer.assets = { emote: () => null };
    renderer.image = () => {
        throw Error('Disabled GIF must not create or load an image');
    };
    const node = new Node();
    const gifs = '0-4|demo|https://media4.giphy.com/media/demo/giphy.gif';
    renderer.body(node, '[GIF]', '', '', '', 'twitch', '', gifs);
    assert.equal(node.textContent, 'GIF');
    assert.equal(node.querySelectorAll('.gif-label').length, 1);
    assert.equal(node.querySelectorAll('.chat-gif').length, 0);
    renderer.body(node, '[GIF]', '', '', '', 'twitch', '', '0-4|demo|https://evil.org/demo.gif');
    assert.equal(node.textContent, '[GIF]');
    assert.equal(node.querySelectorAll('.gif-label').length, 0);
});
test('Subscription notices use the subscriber identity and preserve emotes and headings on refresh', () => {
    const renderer = firstMessageRenderer({ showTwitchEmotes: true });
    const notice = firstMessage('subscription', {
        login: 'alice',
        'display-name': 'Alice',
        'msg-id': 'resub',
        'msg-param-cumulative-months': '12',
        'msg-param-sub-plan': 'Prime',
        emotes: '25:0-4'
    });
    notice.command = 'USERNOTICE';
    notice.prefix = 'tmi.twitch.tv';
    notice.params = ['#test', 'Kappa hola'];
    renderer.add(notice);
    const record = renderer.rows[0];
    assert.equal(record.login, 'alice');
    assert.equal(record.row.classList.contains('subscription-no-message'), false);
    assert.ok(record.row.classList.contains('highlighted-message'));
    assert.equal(
        record.row.querySelectorAll('.subscription-context')[0].textContent,
        '12-month subscription with Prime!'
    );
    assert.equal(record.body.querySelectorAll('.emote')[0].alt, 'Kappa');
    renderer.refresh();
    assert.equal(record.row.querySelectorAll('.subscription-context').length, 1);
    assert.equal(record.body.querySelectorAll('.emote')[0].alt, 'Kappa');
});

test('Subscriptions without messages show a heading without rendering the channel as text', () => {
    const renderer = firstMessageRenderer();
    const notice = firstMessage('subscription-empty', {
        login: 'alice',
        'msg-id': 'sub',
        'msg-param-sub-plan': '1000'
    });
    notice.command = 'USERNOTICE';
    notice.prefix = 'tmi.twitch.tv';
    notice.params = ['#test'];
    renderer.add(notice);
    assert.equal(renderer.rows[0].body.textContent, '');
    assert.ok(renderer.rows[0].row.classList.contains('subscription-no-message'));
    assert.equal(
        renderer.rows[0].row.querySelectorAll('.subscription-context')[0].textContent,
        'New subscription with Tier 1!'
    );
    renderer.add({ ...notice, tags: { ...notice.tags, id: 'raid', 'msg-id': 'raid' } });
    assert.equal(renderer.rows.length, 1);
});
test('Subscription icons use Prime or the exact channel badge, refresh late assets and reject unsafe URLs', () => {
    for (const plan of ['Prime', '1000', '2000', '3000']) {
        const renderer = firstMessageRenderer({ showBadges: false });
        let loaded = false;
        const lookups = [];
        renderer.assets.badge = (set, version, room) => {
            lookups.push([set, version, room]);
            return loaded
                ? {
                      image_url_4x: 'https://static-cdn.jtvnw.net/badges/v1/example/3',
                      title: 'Subscriber'
                  }
                : null;
        };
        const notice = firstMessage('icon-' + plan, {
            login: 'alice',
            'msg-id': 'resub',
            'msg-param-sub-plan': plan,
            'msg-param-cumulative-months': '12',
            badges: 'subscriber/2012',
            'room-id': '42'
        });
        notice.command = 'USERNOTICE';
        renderer.add(notice);
        const label = renderer.rows[0].row._subscriptionLabel;
        assert.equal(label.querySelectorAll('.subscription-icon').length, 0);
        loaded = true;
        renderer.refresh();
        assert.equal(label.querySelectorAll('.subscription-icon').length, 1);
        assert.equal(lookups.at(-1)[0], plan === 'Prime' ? 'premium' : 'subscriber');
        assert.equal(lookups.at(-1)[1], plan === 'Prime' ? '1' : '2012');
        if (plan !== 'Prime') assert.equal(lookups.at(-1)[2], '42');
        renderer.refresh();
        assert.equal(label.querySelectorAll('.subscription-icon').length, 1);
        renderer.assets.badge = () => ({ image_url_4x: 'https://evil.org/icon.png' });
        renderer.refresh();
        assert.equal(label.querySelectorAll('.subscription-icon').length, 0);
        assert.ok(label.textContent.includes(plan === 'Prime' ? 'Prime' : 'Tier'));
    }
});
const giftMessage = (id, kind, tags = {}) => ({
    ...firstMessage(id, {
        login: 'alice',
        'user-id': '10',
        'room-id': '42',
        'msg-id': kind,
        'msg-param-sub-plan': '1000',
        ...tags
    }),
    command: 'USERNOTICE',
    prefix: 'tmi.twitch.tv',
    params: ['#test']
});
test('Gift batches show one summary and suppress all individual recipient notices', () => {
    const renderer = firstMessageRenderer();
    const batch = giftMessage('batch', 'submysterygift', {
        'msg-param-mass-gift-count': '20',
        'msg-param-community-gift-id': 'batch-id'
    });
    renderer.add(batch);
    renderer.add(batch);
    for (let i = 0; i < 20; i++)
        renderer.add(
            giftMessage('recipient-' + i, 'subgift', {
                'msg-param-community-gift-id': 'batch-id',
                'msg-param-recipient-display-name': 'Recipient' + i
            })
        );
    assert.equal(renderer.rows.length, 1);
    const record = renderer.rows[0];
    assert.equal(record.row._subscriptionLabel.textContent, 'Alice has gifted 20 subscriptions!');
    assert.ok(record.row.classList.contains('highlighted-message'));
    assert.ok(record.row.classList.contains('subscription-no-message'));
    renderer.refresh();
    assert.equal(record.row._subscriptionLabel.textContent, 'Alice has gifted 20 subscriptions!');
    assert.equal(record.body.textContent, '');
    renderer.add(giftMessage('independent', 'subgift', { 'msg-param-community-gift-id': '0' }));
    assert.equal(renderer.rows.length, 2);
    assert.equal(
        renderer.rows[1].row._subscriptionLabel.textContent,
        'Alice has gifted 1 subscription!'
    );
});
test('Gift suppression handles recipients before their summary and missing batch identifiers', () => {
    const renderer = firstMessageRenderer();
    renderer.add(giftMessage('early', 'subgift', { 'msg-param-community-gift-id': 'early-batch' }));
    assert.equal(renderer.rows.length, 0);
    renderer.add(giftMessage('summary', 'submysterygift', { 'msg-param-mass-gift-count': '2' }));
    renderer.add(
        giftMessage('single-during-batch', 'subgift', { 'msg-param-community-gift-id': '0' })
    );
    renderer.add(giftMessage('recipient-1', 'subgift'));
    renderer.add(giftMessage('recipient-2', 'subgift'));
    assert.equal(renderer.rows.length, 2);
    renderer.add(giftMessage('single-after-batch', 'subgift'));
    assert.equal(renderer.rows.length, 3);
});
test('Gift suppression keeps donors and channels separate and supports anonymous summaries', () => {
    const renderer = firstMessageRenderer();
    renderer.add(giftMessage('batch', 'submysterygift', { 'msg-param-mass-gift-count': '20' }));
    renderer.add(giftMessage('other-donor', 'subgift', { login: 'bob', 'user-id': '11' }));
    renderer.add(giftMessage('other-room', 'subgift', { 'room-id': '43' }));
    renderer.add({ ...giftMessage('other-source', 'subgift'), sourceId: 'second' });
    renderer.add(
        giftMessage('anonymous', 'anonsubmysterygift', { 'msg-param-mass-gift-count': '3' })
    );
    for (let i = 0; i < 3; i++) renderer.add(giftMessage('anon-recipient-' + i, 'anonsubgift'));
    assert.equal(renderer.rows.length, 5);
    assert.equal(
        renderer.rows.at(-1).row._subscriptionLabel.textContent,
        'Anonymous has gifted 3 subscriptions!'
    );
    renderer.add(giftMessage('invalid', 'submysterygift', { 'msg-param-mass-gift-count': '-1' }));
    assert.equal(renderer.rows.length, 5);
});
test('Classic subscriptions without a message render one localized sentence without a duplicate nick', () => {
    for (const [language, expected] of [
        ['es', '¡Alice se ha suscrito durante 21 meses con Tier 1!'],
        ['en', 'Alice has subscribed for 21 months with Tier 1!']
    ]) {
        const renderer = firstMessageRenderer({ template: 'classic', language });
        const notice = firstMessage('classic-summary', {
            login: 'alice',
            color: '#abcdef',
            'msg-id': 'resub',
            'msg-param-cumulative-months': '21',
            'msg-param-sub-plan': '1000'
        });
        notice.command = 'USERNOTICE';
        notice.params = ['#test'];
        renderer.add(notice);
        const record = renderer.rows[0];
        assert.ok(record.row.classList.contains('subscription-summary'));
        assert.equal(record.row.textContent, expected);
        assert.equal(record.row.querySelectorAll('.message-content').length, 0);
        assert.equal(record.row.querySelectorAll('.name')[0], record.name);
        assert.equal(record.name.style.color, '#abcdef');
        const paint = { backgroundImage: 'linear-gradient(red, blue)', filter: '' };
        renderer.applyPaint(record.name, paint);
        renderer.refresh();
        assert.equal(record.row.textContent, expected);
        assert.equal(record.row.querySelectorAll('.name')[0], record.name);
        assert.equal(record.name.style.backgroundImage, paint.backgroundImage);
        assert.equal(record.name._chatPaint, paint);
    }
});
test('Classic subscriptions with a viewer message keep the existing heading and nick separator', () => {
    const renderer = firstMessageRenderer({ template: 'classic' });
    const notice = firstMessage('classic-message', {
        login: 'alice',
        'msg-id': 'resub',
        'msg-param-cumulative-months': '21',
        'msg-param-sub-plan': '1000'
    });
    notice.command = 'USERNOTICE';
    renderer.add(notice);
    const record = renderer.rows[0];
    assert.equal(record.row.classList.contains('subscription-summary'), false);
    assert.equal(record.row._subscriptionLabel.textContent, '21-month subscription with Tier 1!');
    assert.equal(record.row.querySelectorAll('.message-content').length, 1);
    assert.ok(record.content.textContent.includes(': Hola @bob'));
});
test('Dev history follows new messages at the bottom and preserves the position while reading older messages', () => {
    const renderer = firstMessageRenderer({ devPreserveOffscreenMessages: true, maxMessages: 1 });
    Object.assign(renderer.root, { scrollHeight: 500, clientHeight: 100, scrollTop: 400 });
    const append = renderer.root.append.bind(renderer.root);
    renderer.root.append = (...nodes) => {
        append(...nodes);
        renderer.root.scrollHeight += 40;
    };
    renderer.add(firstMessage('follow-bottom'));
    assert.equal(renderer.root.scrollTop, renderer.root.scrollHeight);
    renderer.root.scrollTop = 100;
    renderer.add(firstMessage('read-history'));
    assert.equal(renderer.root.scrollTop, 100);
    assert.equal(renderer.rows.length, 2);
    renderer.config.devPreserveOffscreenMessages = false;
    renderer.root.scrollTop = renderer.root.scrollHeight - renderer.root.clientHeight;
    const position = renderer.root.scrollTop;
    renderer.add(firstMessage('normal-mode'));
    assert.equal(renderer.root.scrollTop, position);
    assert.equal(renderer.rows.length, 1);
});
test('Dev history remains pinned through delayed layout changes until the user scrolls up', () => {
    const listeners = new Map();
    let resize;
    let disconnected = false;
    context.setInterval = () => 0;
    context.ResizeObserver = class {
        constructor(callback) {
            resize = callback;
        }
        observe() {}
        disconnect() {
            disconnected = true;
        }
    };
    const root = {
        scrollHeight: 500,
        clientHeight: 100,
        scrollTop: 400,
        addEventListener: (event, callback) => listeners.set(event, callback),
        removeEventListener: (event) => listeners.delete(event)
    };
    const renderer = new A.Renderer(
        root,
        { devPreserveOffscreenMessages: true },
        { listeners: new Set() },
        {}
    );
    root.scrollHeight = 600;
    resize();
    assert.equal(root.scrollTop, 600);
    root.scrollTop = 100;
    listeners.get('scroll')();
    root.scrollHeight = 700;
    resize();
    assert.equal(root.scrollTop, 100);
    root.scrollTop = 600;
    listeners.get('scroll')();
    root.scrollHeight = 800;
    resize();
    assert.equal(root.scrollTop, 800);
    renderer.stop();
    assert.ok(disconnected);
    assert.equal(listeners.size, 0);
    delete context.ResizeObserver;
    delete context.setInterval;
});
test('Gift summary donor names retain Twitch colors and receive late 7TV paints', () => {
    for (const template of ['classic']) {
        const renderer = firstMessageRenderer({ template, showSevenTVPaints: true });
        let cosmeticsReady;
        renderer.paints = {
            getCosmetics: () => ({
                then: (callback) => {
                    cosmeticsReady = callback;
                }
            })
        };
        renderer.add(
            giftMessage('styled-gift-' + template, 'subgift', {
                color: '#abcdef',
                'msg-param-community-gift-id': '0'
            })
        );
        const record = renderer.rows[0];
        const label = record.row._subscriptionLabel;
        const donor = label.querySelectorAll('.subscription-gifter')[0];
        assert.equal(donor.textContent, 'Alice');
        assert.equal(donor.style.color, '#abcdef');
        assert.ok(donor.classList.contains('mention'));
        record.row.isConnected = true;
        const paint = { backgroundImage: 'linear-gradient(red, blue)', filter: '' };
        cosmeticsReady({ paint });
        assert.equal(donor.style.backgroundImage, paint.backgroundImage);
        renderer.refresh();
        assert.equal(label.querySelectorAll('.subscription-gifter')[0], donor);
        assert.equal(donor.style.backgroundImage, paint.backgroundImage);
        assert.equal(label.textContent, 'Alice has gifted 1 subscription!');
    }
});
test('7TV overlays combine with emoji bases in messages and reply previews, including compound emoji', () => {
    const renderer = firstMessageRenderer({ showSevenTVEmotes: true });
    renderer.assets.emote = (token) =>
        ['aga0', 'overlay2'].includes(token)
            ? { src: 'https://cdn.7tv.app/emote/overlay/1x.webp', ratio: 1, zeroWidth: true }
            : null;
    for (const preview of [false, true]) {
        for (const [emoji, code] of [
            ['🐹', '1f439'],
            ['❤️', '2764'],
            ['🇪🇸', '1f1ea-1f1f8'],
            ['👩🏽‍💻', '1f469-1f3fd-200d-1f4bb'],
            ['1️⃣', '31-20e3']
        ]) {
            const node = new Node();
            if (preview) renderer.previewText(node, emoji + ' aga0 overlay2 fin', node);
            else renderer.body(node, emoji + ' aga0 overlay2 fin', '');
            const stacks = node.querySelectorAll('.emote-stack');
            assert.equal(stacks.length, 1);
            assert.equal(stacks[0].querySelectorAll('.overlay').length, 2);
            const base = stacks[0].querySelectorAll('.emoji-base')[0];
            assert.equal(base.alt, emoji);
            assert.ok(base.src.endsWith('/' + code + '.svg'));
            assert.equal(node.textContent, ' fin');
        }
    }
});
test('Emoji overlays preserve adjacent text, skip links and show ordinary emoji as Twemoji', () => {
    const renderer = firstMessageRenderer({ showSevenTVEmotes: true });
    renderer.assets.emote = (token) =>
        token === 'aga0'
            ? { src: 'https://cdn.7tv.app/emote/overlay/1x.webp', ratio: 1, zeroWidth: true }
            : null;
    const node = new Node();
    renderer.body(node, 'hola🐹 aga0 final', '');
    assert.equal(node.querySelectorAll('.emoji-emote-stack').length, 1);
    assert.equal(node.textContent, 'hola final');
    renderer.body(node, '🐹 texto aga0', '');
    assert.equal(node.querySelectorAll('.emoji-base').length, 0);
    assert.ok(node.textContent.includes(' texto'));
    assert.equal(node.querySelectorAll('.twemoji')[0].alt, '🐹');
    renderer.body(node, 'https://example.com/🐹 aga0', '');
    assert.equal(node.querySelectorAll('.emoji-base').length, 0);
    renderer.config.showSevenTVEmotes = false;
    renderer.body(node, '🐹 aga0', '');
    assert.equal(node.textContent, ' aga0');
    assert.equal(node.querySelectorAll('.twemoji')[0].alt, '🐹');
    assert.equal(node.querySelectorAll('.emote-stack').length, 0);
});
test('Ordinary emoji always use Twemoji, including unsupported system glyphs and compound sequences', () => {
    const renderer = firstMessageRenderer({
        showSevenTVEmotes: false,
        showTwitchEmotes: false,
        colorMentions: false
    });
    for (const preview of [false, true]) {
        for (const [emoji, code] of [
            ['🫪', '1faea'],
            ['🐹', '1f439'],
            ['❤️', '2764'],
            ['🇪🇸', '1f1ea-1f1f8'],
            ['👩🏽‍💻', '1f469-1f3fd-200d-1f4bb'],
            ['1️⃣', '31-20e3']
        ]) {
            const node = new Node();
            if (preview) renderer.previewText(node, 'Hola ' + emoji + '!', node);
            else renderer.body(node, 'Hola ' + emoji + '!', '');
            const image = node.querySelectorAll('.twemoji')[0];
            assert.equal(image.alt, emoji);
            assert.ok(image.src.endsWith('/' + code + '.svg'));
            assert.equal(node.textContent, 'Hola !');
            assert.equal(node.querySelectorAll('.emote-stack').length, 0);
        }
    }
});
test('Twemoji survives refresh and restores the original emoji if its image fails', () => {
    const renderer = firstMessageRenderer();
    const message = firstMessage('twemoji-refresh');
    message.params[1] = 'Twitter 🫪';
    renderer.add(message);
    const record = renderer.rows[0];
    assert.equal(record.body.querySelectorAll('.twemoji')[0].alt, '🫪');
    renderer.refresh();
    const image = record.body.querySelectorAll('.twemoji')[0];
    assert.equal(image.alt, '🫪');
    image.onerror();
    assert.equal(record.body.textContent, 'Twitter 🫪');
    const action = new Node();
    action.className = 'action-body';
    renderer.body(action, 'saluda 🫪', '');
    assert.equal(action.querySelectorAll('.twemoji')[0].alt, '🫪');
});
console.log(`${count} tests PASS`);
