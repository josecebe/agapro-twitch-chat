import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
class Node {
    constructor(tag = '', text = null) {
        this.tag = tag;
        this.text = text;
        this.children = [];
        this.style = {};
        this.dataset = {};
        this.classes = new Set();
    }
    set className(value) {
        this.classes = new Set(value.split(' ').filter(Boolean));
    }
    get classList() {
        return {
            add: (name) => this.classes.add(name),
            remove: (name) => this.classes.delete(name),
            contains: (name) => this.classes.has(name)
        };
    }
    get isConnected() {
        return this.connected === true || !!this.parent?.isConnected;
    }
    get childNodes() {
        return this.children;
    }
    get nodeType() {
        return this.tag ? 1 : 3;
    }
    append(...nodes) {
        for (const node of nodes) {
            node.parent = this;
            this.children.push(node);
        }
    }
    prepend(node) {
        node.parent = this;
        this.children.unshift(node);
    }
    remove() {
        if (this.parent) {
            this.parent.children.splice(this.parent.children.indexOf(this), 1);
            this.parent = null;
        }
    }
    replaceChildren() {
        for (const node of this.children) {
            node.parent = null;
        }
        this.children = [];
        this.text = null;
    }
    set textContent(text) {
        this.replaceChildren();
        this.text = text;
    }
    get textContent() {
        return this.text ?? this.children.map((node) => node.textContent).join('');
    }
    querySelectorAll(selector) {
        return this.children.flatMap((node) => [
            ...(node.classes.has(selector.slice(1)) ? [node] : []),
            ...node.querySelectorAll(selector)
        ]);
    }
}
const document = {
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => new Node('', text)
};
const context = vm.createContext({
    window: {},
    document,
    CSS: {
        supports: () => true
    },
    Image: class {},
    URL,
    setInterval: () => 1,
    clearInterval,
    clearTimeout
});
vm.runInContext(readWidgetScripts(['providers', 'renderer']), context);
const A = context.window.ChatWidget;
const paint = {
    backgroundImage: 'linear-gradient(90deg,red,blue)',
    filter: ''
};
const targetTags = {
    'reply-parent-msg-id': 'parent-message',
    'reply-parent-user-id': '42',
    'reply-parent-user-login': 'alice',
    'reply-parent-display-name': 'Alice',
    'reply-parent-msg-body': 'Texto original de Alice'
};
const message = (id, tags = {}, text = 'Respuesta') => ({
    provider: 'twitch',
    tags: {
        id,
        'display-name': 'Bob',
        ...tags
    },
    prefix: 'bob!x',
    params: ['#canal', text]
});
function fixture(
    config = {},
    paints = {
        getCosmetics: async () => null
    }
) {
    const root = new Node('main');
    root.connected = true;
    const assets = {
        listeners: new Set(),
        emote: () => null
    };
    const renderer = new A.Renderer(
        root,
        {
            maxMessages: 35,
            showBadges: false,
            showSevenTVPaints: false,
            ...config
        },
        assets,
        paints
    );
    return renderer;
}
let count = 0;
async function test(name, fn) {
    await fn();
    console.log('PASS', name);
    count++;
}
await test('Localized names preserve formatting, paints, ACTION and identity after refresh', async () => {
    const r = fixture({ showSevenTVPaints: true }, { getCosmetics: async () => ({ paint }) });
    r.add({
        ...message(
            'localized',
            { 'display-name': 'タネセンパイ', color: '#123456', 'user-id': '123' },
            '\x01ACTION saluda\x01'
        ),
        prefix: 'tanesenpaii!x'
    });
    await Promise.resolve();
    const record = r.rows[0];
    assert.equal(record.name.textContent, 'タネセンパイ (tanesenpaii)');
    assert.equal(record.login, 'tanesenpaii');
    assert.equal(record.name.style.color, '#123456');
    assert.ok(record.name.classList.contains('painted'));
    assert.equal(record.row.textContent, 'タネセンパイ (tanesenpaii) saluda');
    r.refresh();
    assert.equal(record.name.textContent, 'タネセンパイ (tanesenpaii)');
    assert.ok(record.name.classList.contains('painted'));
    r.config.showLocalizedUsername = false;
    r.refresh();
    assert.equal(record.name.textContent, 'タネセンパイ');
    assert.equal(record.login, 'tanesenpaii');
    assert.ok(record.name.classList.contains('painted'));
    r.config.showLocalizedUsername = true;
    r.refresh();
    assert.equal(record.name.textContent, 'タネセンパイ (tanesenpaii)');
});
await test('Quoted mentions render alongside links and survive refreshes', () => {
    const r = fixture();
    r.rememberColor('orbitfox7', 'orbitfox7', '#ff0000');
    for (const showLinkLabels of [true, false]) {
        r.config.showLinkLabels = showLinkLabels;
        for (const preview of [
            '@orbitfox7 hola',
            '@orbitfox7 hola https://youtube.com/watch?v=test'
        ]) {
            const quote = document.createElement('span');
            r.replyPreview(quote, preview);
            r.replyPreview(quote, preview);
            const mentions = quote.querySelectorAll('.mention');
            assert.equal(mentions.length, 1);
            assert.equal(mentions[0].textContent, '@orbitfox7');
            assert.equal(mentions[0].dataset.login, 'orbitfox7');
            assert.equal(mentions[0].style.color, undefined);
            assert.equal(mentions[0].dataset.preview, 'true');
            assert.equal(quote.title, preview);
        }
    }
});
await test('Quotes combine Twitch and 7TV emotes, GIF labels and neutral mentions', () => {
    const r = fixture({ showTwitchEmotes: true, showSevenTVEmotes: true, showSevenTVPaints: true });
    r.assets.emote = (token) =>
        token === 'Wave' ? { src: 'https://cdn.7tv.app/emote/test/2x.webp', ratio: 2 } : null;
    const text = 'Kappa Wave [GIF] 😀 @alice';
    r.add(
        message(
            'parent-media',
            {
                emotes: '25:0-4',
                gifs: '11-15|test|https://media.giphy.com/media/test/giphy.gif'
            },
            text
        )
    );
    r.remove(r.rows[0]);
    r.add(
        message('reply-media', {
            ...targetTags,
            'reply-parent-msg-id': 'parent-media',
            'reply-parent-msg-body': text
        })
    );
    const quote = r.rows[0].reply.quote;
    const check = () => {
        const emotes = quote.querySelectorAll('.emote');
        assert.equal(emotes.length, 2);
        assert.ok(emotes[0].src.includes('/25/default/dark/2.0'));
        assert.equal(emotes[1].alt, 'Wave');
        assert.equal(quote.querySelectorAll('.gif-label')[0].textContent, 'GIF');
        assert.equal(quote.querySelectorAll('.chat-gif').length, 0);
        assert.equal(quote.querySelectorAll('.mention')[0].style.color, undefined);
        assert.equal(quote.querySelectorAll('.mention')[0].classList.contains('painted'), false);
        assert.ok(quote.textContent.includes('😀'));
    };
    check();
    r.rememberColor('alice', 'Alice', '#ff0000');
    r.rememberPaint('alice', 'Alice', paint);
    check();
    r.refresh();
    check();
    r.config.showTwitchEmotes = false;
    r.config.showSevenTVEmotes = false;
    r.refresh();
    assert.equal(quote.querySelectorAll('.emote').length, 0);
    assert.ok(quote.textContent.includes('Kappa Wave'));
});
await test('Native replies show the direct recipient before the author and quote the original', () => {
    const r = fixture();
    r.rememberColor('alice', 'Alice', '#12ab34');
    r.add(
        message('reply', {
            ...targetTags,
            'reply-thread-parent-user-login': 'someoneelse'
        })
    );
    const record = r.rows[0];
    assert.equal(record.row.children[0], record.reply.node);
    assert.equal(record.reply.heading.textContent, '↪ replying to @Alice');
    assert.equal(record.reply.mention.style.color, '#12ab34');
    assert.equal(record.body.textContent, 'Respuesta');
    assert.equal(record.reply.quote.textContent, '— ' + targetTags['reply-parent-msg-body']);
});
await test('Ordinary messages, incomplete reply tags and other providers keep their formatting', () => {
    const r = fixture();
    r.add(message('normal', {}, 'Hola @alice'));
    r.add(
        message('no-login', {
            'reply-parent-msg-id': 'parent'
        })
    );
    r.add(
        message('invalid', {
            ...targetTags,
            'reply-parent-user-login': '<script>'
        })
    );
    r.add({
        ...message('other', targetTags),
        provider: 'unsupported'
    });
    assert.ok(r.rows.every((record) => record.reply === null));
    assert.equal(r.rows[0].body.textContent, 'Hola @alice');
});
await test('Reply recipient names are inserted as text rather than HTML', () => {
    const r = fixture();
    r.add(
        message('literal', {
            ...targetTags,
            'reply-parent-display-name': '<img src=x onerror=alert(1)>'
        })
    );
    const mention = r.rows[0].reply.mention;
    assert.equal(mention.textContent, '@<img src=x onerror=alert(1)>');
    assert.equal(mention.children.length, 0);
});
await test('Paint resolution does not block messages and updates mentions', async () => {
    let resolve;
    const pending = new Promise((done) => (resolve = done));
    const calls = [];
    const r = fixture(
        {
            showSevenTVPaints: true,
            colorMentions: true
        },
        {
            getCosmetics: (id, visible, platform) => {
                calls.push({
                    id,
                    visible,
                    platform
                });
                return id === '42' ? pending : Promise.resolve(null);
            }
        }
    );
    r.add(message('async', targetTags, 'Hola @alice'));
    const record = r.rows[0];
    assert.ok(record.row.isConnected);
    assert.equal(record.reply.mention.classList.contains('painted'), false);
    assert.ok(
        calls.some((call) => call.id === '42' && call.platform === 'TWITCH' && call.visible())
    );
    resolve({
        paint
    });
    await pending;
    await Promise.resolve();
    assert.ok(record.reply.mention.classList.contains('painted'));
    assert.equal(record.reply.mention.style.backgroundImage, paint.backgroundImage);
    assert.ok(record.body.querySelectorAll('.mention')[0].classList.contains('painted'));
});
await test('Recipients without paints use learned Twitch colors and update when they speak', async () => {
    const r = fixture({
        showSevenTVPaints: true
    });
    r.add(message('before', targetTags));
    await Promise.resolve();
    const mention = r.rows[0].reply.mention;
    assert.equal(mention.style.color, '#b8b2ff');
    r.add({
        ...message('alice', {
            'display-name': 'ALICE',
            color: '#aabbcc'
        }),
        prefix: 'alice!x'
    });
    assert.equal(mention.style.color, '#aabbcc');
    assert.equal(mention.classList.contains('painted'), false);
});
await test('Disabled replies omit the header and recipient cosmetic lookup', async () => {
    const calls = [];
    const r = fixture(
        {
            showReplies: false,
            showSevenTVPaints: true
        },
        {
            getCosmetics: async (id) => {
                calls.push(id);
                return null;
            }
        }
    );
    r.add(message('hidden', targetTags));
    await Promise.resolve();
    assert.equal(r.rows[0].reply, null);
    assert.ok(!calls.includes('42'));
});
await test('Disabled paints preserve Twitch-colored replies without querying 7TV', () => {
    const r = fixture(
        {
            colorMentions: false
        },
        {
            getCosmetics: () => {
                throw Error('Lookups must not run');
            }
        }
    );
    r.rememberColor('alice', 'Alice', '#abcdef');
    r.add(message('no-paint', targetTags));
    assert.equal(r.rows[0].reply.mention.style.color, '#abcdef');
});
await test('Moderation removes the entire reply and late paint results cannot restore it', async () => {
    let resolve;
    const pending = new Promise((done) => (resolve = done));
    const r = fixture(
        {
            showSevenTVPaints: true
        },
        {
            getCosmetics: (id) => (id === '42' ? pending : Promise.resolve(null))
        }
    );
    r.add(message('deleted', targetTags));
    const record = r.rows[0];
    r.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'deleted'
        },
        params: []
    });
    resolve({
        paint
    });
    await pending;
    await Promise.resolve();
    assert.equal(r.rows.length, 0);
    assert.equal(record.row.isConnected, false);
    assert.equal(record.reply.mention.classList.contains('painted'), false);
    assert.equal(r.userPaints.has('alice'), false);
});
await test('Authors and recipients share cosmetic caches across replies', async () => {
    let calls = 0;
    const paints = new A.Paints(
        () => {},
        async () => {
            calls++;
            return {
                data: {
                    users: {
                        userByConnection: {
                            style: {
                                activePaint: null,
                                activeBadge: null
                            }
                        }
                    }
                }
            };
        }
    );
    const r = fixture(
        {
            showSevenTVPaints: true
        },
        paints
    );
    r.add({
        ...message('author', {
            'user-id': '42',
            'display-name': 'Alice'
        }),
        prefix: 'alice!x'
    });
    r.add(
        message('reply-one', {
            ...targetTags,
            'user-id': '99'
        })
    );
    r.add(
        message('reply-two', {
            ...targetTags,
            'user-id': '99'
        })
    );
    await Promise.all([...paints.pending.values()]);
    await Promise.resolve();
    assert.equal(calls, 2);
    assert.equal(paints.cache.size, 2);
});
await test('Emotes, ranges and asset refreshes preserve reply text and headers', () => {
    const r = fixture({
        showTwitchEmotes: true
    });
    r.add(
        message(
            'emotes',
            {
                ...targetTags,
                emotes: '25:0-4'
            },
            'Kappa hola'
        )
    );
    const record = r.rows[0];
    const reply = record.reply.node;
    assert.equal(record.body.querySelectorAll('.emote')[0].alt, 'Kappa');
    assert.equal(record.body.children.at(-1).textContent, 'hola');
    r.refresh();
    assert.equal(record.reply.node, reply);
    assert.equal(record.body.querySelectorAll('.emote').length, 1);
    assert.equal(record.reply.heading.textContent, '↪ replying to @Alice');
});
await test('Reply tags parse from complete IRC PRIVMSG lines', () => {
    const r = fixture();
    r.add(
        A.parseIRC(
            '@id=irc;reply-parent-msg-id=parent;reply-parent-user-id=42;reply-parent-user-login=alice;reply-parent-display-name=Alice;reply-parent-msg-body=texto\\soriginal :bob!bob@host PRIVMSG #canal :Respuesta IRC'
        )
    );
    assert.equal(r.rows[0].reply.heading.textContent, '↪ replying to @Alice');
    assert.equal(r.rows[0].body.textContent, 'Respuesta IRC');
    assert.equal(r.rows[0].reply.quote.textContent, '— texto original');
});
await test('Headers replace only the leading recipient mention, case-insensitively', () => {
    for (const prefix of ['@alice ', '@ALICE: ', '  @Alice, ']) {
        const r = fixture();
        r.add(message('deduplicated', targetTags, prefix + 'tal cual @alice y @carol'));
        assert.equal(r.rows[0].body.textContent, 'tal cual @alice y @carol');
        r.refresh();
        assert.equal(r.rows[0].body.textContent, 'tal cual @alice y @carol');
        assert.equal(r.rows[0].reply.heading.textContent, '↪ replying to @Alice');
    }
});
await test('Other mentions, longer names, headerless messages and lone mentions remain visible', () => {
    for (const text of ['@carol hola', '@alice_extra hola', 'Hola @alice', '@alice']) {
        const r = fixture();
        r.add(message('preserved', targetTags, text));
        assert.equal(r.rows[0].body.textContent, text);
    }
    for (const [config, tags] of [
        [
            {
                showReplies: false
            },
            targetTags
        ],
        [{}, {}]
    ]) {
        const r = fixture(config);
        r.add(message('no-header', tags, '@alice hola'));
        assert.equal(r.rows[0].body.textContent, '@alice hola');
    }
});
await test('Removing the leading mention shifts emote ranges correctly around emoji', () => {
    const r = fixture({
        showTwitchEmotes: true
    });
    r.add(
        message(
            'emote-offset',
            {
                ...targetTags,
                emotes: '25:9-13,15-19'
            },
            '@alice 😀 Kappa Kappa'
        )
    );
    const record = r.rows[0];
    assert.equal(record.text, '😀 Kappa Kappa');
    assert.equal(record.emotes, '25:2-6,8-12');
    assert.equal(record.body.querySelectorAll('.emote').length, 2);
    assert.ok(record.body.querySelectorAll('.emote').every((img) => img.alt === 'Kappa'));
    r.refresh();
    assert.equal(record.body.querySelectorAll('.emote').length, 2);
});
await test('ACTION formatting and media ranges survive removal of the redundant mention', () => {
    const r = fixture({
        showTwitchEmotes: true
    });
    r.add(
        message(
            'action-offset',
            {
                ...targetTags,
                emotes: '25:15-19'
            },
            '\x01ACTION @alice Kappa\x01'
        )
    );
    const record = r.rows[0];
    assert.ok(record.row.classList.contains('action'));
    assert.equal(record.text, 'Kappa');
    assert.equal(record.emotes, '25:0-4');
    assert.equal(record.body.querySelectorAll('.emote')[0].alt, 'Kappa');
});
await test('GIFs survive replies, ACTION and refreshes and can be replaced with labels', () => {
    const src = 'https://media4.giphy.com/media/test/giphy.gif?cid=original&rid=giphy.gif';
    for (const action of [false, true]) {
        const r = fixture({ showTwitchEmotes: true });
        const prefix = action ? '\x01ACTION ' : '';
        const start = Array.from(prefix + '@alice 😀 ').length;
        r.add(
            message(
                'gif-reply',
                {
                    ...targetTags,
                    gifs: `${start}-${start + 4}|test|${src}`,
                    emotes: `25:${start + 6}-${start + 10}`
                },
                prefix + '@alice 😀 [GIF] Kappa' + (action ? '\x01' : '')
            )
        );
        const record = r.rows[0];
        assert.equal(record.body.querySelectorAll('.chat-gif')[0].src, src);
        assert.equal(record.body.querySelectorAll('.chat-gif')[0].alt, '[GIF]');
        assert.equal(record.body.querySelectorAll('.emote')[0].alt, 'Kappa');
        r.refresh();
        assert.equal(record.body.querySelectorAll('.chat-gif').length, 1);
        r.config.showTwitchGifs = false;
        r.refresh();
        assert.equal(record.body.querySelectorAll('.chat-gif').length, 0);
        assert.equal(record.body.querySelectorAll('.gif-label')[0].textContent, 'GIF');
        assert.equal(record.body.textContent.includes('[GIF]'), false);
        r.config.showTwitchGifs = true;
        r.refresh();
        assert.equal(record.body.querySelectorAll('.chat-gif').length, 1);
        assert.equal(record.body.querySelectorAll('.gif-label').length, 0);
    }
    const r = fixture({ showReplies: false });
    r.add(message('gif-mention', { ...targetTags, gifs: `0-4|test|${src}` }, '[GIF]'));
    assert.equal(r.rows[0].body.querySelectorAll('.chat-gif')[0].src, src);
    assert.equal(r.rows[0].body.textContent, '@alice ');
});
await test('ACTION uses the authors color and paint without a colon or colored mentions', async () => {
    const r = fixture(
        { showSevenTVPaints: true, colorMentions: true },
        { getCosmetics: async () => ({ paint }) }
    );
    r.rememberColor('alice', 'Alice', '#abcdef');
    r.add(message('action-style', { color: '#123456' }, '\x01ACTION saluda a @alice\x01'));
    await Promise.resolve();
    const record = r.rows[0];
    assert.equal(record.row.textContent, record.name.textContent + ' saluda a @alice');
    assert.equal(record.body.style.color, record.name.style.color);
    assert.equal(record.body.style.backgroundImage, record.name.style.backgroundImage);
    assert.ok(record.body.classList.contains('painted'));
    assert.equal(record.body.querySelectorAll('.mention').length, 0);
    r.refresh();
    assert.equal(record.body.querySelectorAll('.mention').length, 0);
    assert.ok(record.body.classList.contains('painted'));
    r.add(message('regular-style', {}, 'hola'));
    const regular = r.rows[1];
    assert.equal(regular.row.textContent, regular.name.textContent + ': hola');
});
await test('Headerless replies add missing mentions without duplication or broken emotes', () => {
    const r = fixture({
        showReplies: false,
        showTwitchEmotes: true,
        colorMentions: true
    });
    r.rememberColor('alice', 'Alice', '#abcdef');
    r.add(
        message(
            'plain',
            {
                ...targetTags,
                emotes: '25:2-6'
            },
            '😀 Kappa'
        )
    );
    const record = r.rows[0];
    assert.equal(record.reply, null);
    assert.equal(record.text, '@alice 😀 Kappa');
    assert.equal(record.emotes, '25:9-13');
    assert.equal(record.body.querySelectorAll('.emote')[0].alt, 'Kappa');
    assert.equal(record.body.querySelectorAll('.mention')[0].style.color, '#abcdef');
    r.refresh();
    assert.equal(record.body.querySelectorAll('.mention').length, 1);
    r.add(message('already', targetTags, '@ALICE: hola'));
    assert.equal(r.rows.at(-1).text, '@ALICE: hola');
    r.add(message('ordinary', {}, 'Hola'));
    assert.equal(r.rows.at(-1).text, 'Hola');
});
await test('Reply previews use link labels, respect settings and stay removed after moderation', () => {
    const text = 'Mira https://store.steampowered.com/app/3976340/Cucina_Stellata/';
    const r = fixture({ showLinkFavicons: false });
    r.add(message('reply-link', { ...targetTags, 'reply-parent-msg-body': text }));
    const record = r.rows[0];
    assert.equal(record.reply.quote.querySelectorAll('.link-label')[0].textContent, 'LINK');
    assert.equal(record.reply.quote.querySelectorAll('.link-favicon').length, 0);
    assert.equal(record.reply.quote.title, text);
    r.config.showLinkLabels = false;
    r.refresh();
    assert.equal(record.reply.quote.textContent, '— ' + text);
    r.config.showLinkLabels = true;
    r.refresh();
    assert.equal(record.reply.quote.querySelectorAll('.link-label').length, 1);
    r.moderate({
        provider: 'twitch',
        command: 'CLEARMSG',
        tags: { 'target-msg-id': targetTags['reply-parent-msg-id'] },
        params: ['#canal']
    });
    r.refresh();
    assert.equal(record.reply.quote, null);
    assert.equal(record.row.querySelectorAll('.reply-quote').length, 0);
});
await test('Reply previews are literal single-line text and can be disabled', () => {
    const r = fixture();
    r.add(
        message('preview', {
            ...targetTags,
            'reply-parent-msg-body': '  <script>hola</script>\n  segunda línea  '
        })
    );
    const quote = r.rows[0].reply.quote;
    assert.equal(quote.textContent, '— <script>hola</script> segunda línea');
    assert.equal(quote.querySelectorAll('script').length, 0);
    const off = fixture({
        showReplyPreview: false
    });
    off.add(message('off', targetTags));
    assert.equal(off.rows[0].reply.quote, null);
    assert.equal(off.rows[0].reply.heading.textContent, '↪ replying to @Alice');
    const empty = fixture();
    empty.add(
        message('empty', {
            ...targetTags,
            'reply-parent-msg-body': '   '
        })
    );
    assert.equal(empty.rows[0].reply.quote, null);
});
await test('Deleting originals removes previews without removing replies or restoring previews on refresh', () => {
    const r = fixture();
    r.add(message('quoted', targetTags));
    r.add(
        message('other', {
            ...targetTags,
            'reply-parent-msg-id': 'different'
        })
    );
    const record = r.rows[0];
    r.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'parent-message'
        },
        params: []
    });
    assert.equal(r.rows.length, 2);
    assert.equal(record.reply.quote, null);
    assert.equal(record.reply.node.textContent, '↪ replying to @Alice');
    assert.ok(r.rows[1].reply.quote);
    r.refresh();
    assert.equal(record.row.querySelectorAll('.reply-quote').length, 0);
    r.add(message('late', targetTags));
    assert.equal(r.rows.at(-1).reply.quote, null);
});
await test('Recipient moderation removes matching previews by user ID or login within the source', () => {
    for (const event of [
        {
            tags: {
                'target-user-id': '42'
            },
            params: ['#canal']
        },
        {
            tags: {},
            params: ['#canal', 'alice']
        }
    ]) {
        const r = fixture();
        r.add({
            ...message('a', targetTags),
            sourceId: 'twitch:a'
        });
        r.add({
            ...message('b', targetTags),
            sourceId: 'twitch:b'
        });
        r.moderate({
            ...event,
            command: 'CLEARCHAT',
            provider: 'twitch',
            sourceId: 'twitch:a'
        });
        assert.equal(r.rows[0].reply.quote, null);
        assert.ok(r.rows[1].reply.quote);
    }
});
await test('Languages translate replies and notices without changing messages or recipients', () => {
    for (const [language, reply, first, reward, highlighted] of [
        [
            'es',
            'respuesta a',
            'PRIMER MENSAJE',
            'Recompensa canjeada con puntos del canal',
            'Mensaje destacado con puntos del canal'
        ],
        [
            'en',
            'replying to',
            'FIRST-TIME CHATTER',
            'Redeemed a Channel Points reward',
            'Highlighted a message with Channel Points'
        ],
        [
            'en-US',
            'replying to',
            'FIRST-TIME CHATTER',
            'Redeemed a Channel Points reward',
            'Highlighted a message with Channel Points'
        ],
        [
            'fr',
            'replying to',
            'FIRST-TIME CHATTER',
            'Redeemed a Channel Points reward',
            'Highlighted a message with Channel Points'
        ]
    ]) {
        const renderer = fixture({ language });
        renderer.add(
            message(
                'translated',
                { ...targetTags, 'first-msg': '1', 'custom-reward-id': 'reward' },
                'Hola @alice'
            )
        );
        const record = renderer.rows[0];
        assert.equal(record.reply.heading.textContent, '↪ ' + reply + ' @Alice');
        assert.equal(record.row.querySelectorAll('.first-message-label')[0].textContent, first);
        assert.equal(
            record.row.querySelectorAll('.redemption-context')[0].textContent,
            '◈ ' + reward
        );
        assert.equal(record.body.textContent, 'Hola @alice');
        assert.equal(
            renderer.redemptionContext({ 'msg-id': 'highlighted-message' }, 'twitch').textContent,
            '◈ ' + highlighted
        );
        renderer.refresh();
        assert.equal(record.reply.heading.textContent, '↪ ' + reply + ' @Alice');
    }
});
console.log(`${count} tests PASS`);
