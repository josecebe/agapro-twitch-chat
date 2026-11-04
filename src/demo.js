(function (ChatWidget) {
    'use strict';

    const users = {
        Alice: ['999000001', '#9d8aff'],
        PixelFox: ['999000002', '#61e7ca'],
        Nova: ['999000003', '#f5bf65'],
        ModMia: ['999000004', '#ec8fc9'],
        LunaByte: ['999000005', '#ff79c6'],
        NeonPanda: ['999000006', '#38bdf8'],
        MentaCosmica: ['999000007', '#34d399'],
        ZorroSolar: ['999000008', '#fb923c'],
        KiwiNebula: ['999000009', '#a3e635'],
        NubeVioleta: ['999000010', '#a78bfa'],
        MochiLunar: ['999000011', '#f9a8d4'],
        RayoTurquesa: ['999000012', '#2dd4bf'],
        SakuraBits: ['999000013', '#fb7185'],
        AstroMapache: ['999000014', '#fbbf24'],
        CoralDream: ['999000015', '#f97373'],
        GlitchAurora: ['999000016', '#818cf8'],
        CerezaPixel: ['999000017', '#e879f9'],
        CometaAzul: ['999000018', '#60a5fa'],
        DrakoMint: ['999000019', '#6ee7b7'],
        TofuGalactico: ['999000020', '#c4b5fd'],
        BambuElectrico: ['999000021', '#bef264'],
        PrismaNocturno: ['999000022', '#c084fc'],
        ChispaMelocoton: ['999000023', '#fdba74'],
        OrbitOtter: ['999000024', '#67e8f9']
    };

    // Stained Glass: public 7TV paint 01M66TYCCW1KJHERVT03TXTXDN, captured 2026-11-04.
    // Keep in sync with tests/fixtures/stained-glass-paint.json.
    const stainedGlassPaint = {
        backgroundImage:
            'repeating-linear-gradient(135deg,rgba(255,255,255,1) 0%,rgba(254,42,187,1) 12%,rgba(0,255,191,1) 12%,rgba(163,26,255,1) 23%,rgba(217,255,0,1) 23%,rgba(254,41,22,1) 33%)',
        filter: 'drop-shadow(0px 0px 0.1px rgba(194,58,251,1)) drop-shadow(0px 0px 4px rgba(87,87,87,1))'
    };

    // Epiphany provider snapshot; see tests/fixtures/epiphany-paint.json.
    const epiphanyPaint = {
        backgroundImage:
            'linear-gradient(0deg,rgba(255,200,82,1) 0%,rgba(254,239,144,1) 15%,rgba(254,213,124,1) 30%,rgba(255,255,255,1) 60%)',
        filter: 'drop-shadow(0px 0px 4px rgba(255,162,0,1))'
    };

    const shuffle = (values, random) => {
        const result = [...values];
        for (let i = result.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [result[i], result[j]] = [result[j], result[i]];
        }
        return result;
    };

    const paintStyles = [
        'linear-gradient(90deg,#c084fc,#2dd4bf)',
        'linear-gradient(90deg,#ff0080,#ff8c00,#ffe600)',
        'linear-gradient(120deg,#38bdf8,#818cf8,#e879f9)',
        'linear-gradient(90deg,#34d399,#d9f99d)',
        'linear-gradient(90deg,#f43f5e,#fda4af,#fff1f2)',
        'linear-gradient(135deg,#fbbf24,#fff7ad,#fb923c)',
        'linear-gradient(90deg,#22d3ee,#e0f2fe,#60a5fa)',
        'linear-gradient(120deg,#a855f7,#f0abfc,#6366f1)',
        'repeating-linear-gradient(110deg,#f472b6 0px,#f472b6 8px,#c084fc 8px,#c084fc 16px)',
        'radial-gradient(circle,#fef08a,#fb7185,#a78bfa)',
        'linear-gradient(90deg,#86efac,#5eead4,#93c5fd)',
        'linear-gradient(90deg,#ffffff,#94a3b8,#e2e8f0)',
        'linear-gradient(45deg,#f97316,#ec4899,#8b5cf6)',
        'linear-gradient(90deg,#06b6d4,#10b981,#84cc16)',
        'linear-gradient(135deg,#fde68a,#fca5a5,#f0abfc)',
        'linear-gradient(90deg,#93c5fd,#a5b4fc,#ddd6fe)',
        'repeating-linear-gradient(90deg,#fef08a 0px,#fef08a 6px,#fb923c 6px,#fb923c 12px)',
        'radial-gradient(ellipse,#ffffff,#22d3ee,#6366f1)',
        'linear-gradient(90deg,#e879f9,#fdf4ff,#fb7185)',
        'linear-gradient(120deg,#bef264,#34d399,#0891b2)',
        'linear-gradient(90deg,#ff80b5,#ff80b5)',
        'linear-gradient(90deg,#67e8f9,#67e8f9)',
        'linear-gradient(90deg,#d9f99d,#d9f99d)',
        'linear-gradient(90deg,#e9d5ff,#e9d5ff)'
    ];

    ChatWidget.createDemoEvents = function (
        language,
        cycle = 0,
        { random = Math.random, ordered = false } = {}
    ) {
        const roster = shuffle(Object.keys(users).slice(4), random);
        let authorIndex = 0;
        const t = (key, values) => ChatWidget.i18n.translate(language, key, values);
        const id = (key) => 'demo-' + cycle + '-' + key;
        const message = (key, name, text, tags = {}) => {
            // Keep a few familiar users, while most messages rotate through the roster.
            if (
                ![
                    'welcome',
                    'original',
                    'reply',
                    'moderated',
                    'ban-parent',
                    'timeout-parent',
                    'stained-glass',
                    'epiphany'
                ].includes(key)
            ) {
                name = roster[authorIndex++ % roster.length];
            }
            return {
                provider: 'twitch',
                command: 'PRIVMSG',
                tags: {
                    id: id(key),
                    'user-id': users[name][0],
                    'display-name': name,
                    color: users[name][1],
                    ...tags
                },
                prefix: name.toLowerCase() + '!demo@demo',
                params: ['#demo', text]
            };
        };
        const emotes = t('demoEmotes');
        const gif = t('demoGif');
        const lastEmote = Array.from(emotes).length - 5;
        // Ranges always refer to the final IRC body, including reply mentions and /me.
        const content = ({ gif = false, emoji = false, emote = false } = {}, prefix = '') => {
            if (gif)
                return {
                    text: t('demoGif'),
                    tags: {
                        gifs: `0-${Array.from(t('demoGif')).length - 1}|joSNxeswxuc74Juo8X|https://media4.giphy.com/media/joSNxeswxuc74Juo8X/giphy.gif`
                    }
                };
            let text =
                prefix +
                (emoji ? '😀 💜 ' : '') +
                t(
                    ['demoCombination', 'demoConversation', 'demoReply', 'demoWrapping'][
                        Math.floor(random() * 4)
                    ]
                );
            const tags = {};
            if (emote) {
                const start = Array.from(text + ' ').length;
                tags.emotes = `25:${start}-${start + 4}`;
                text += ' Kappa';
            }
            return { text, tags };
        };
        const reply = (key, parent, body, tags = {}) => {
            const prefix = body.text.match(/^@[a-z0-9_]+/i)?.[0];
            const mention = '@' + parent.prefix.split('!')[0];
            const delta = prefix ? mention.length - prefix.length : 0;
            const shifted = { ...body.tags };
            if (shifted.emotes && delta)
                shifted.emotes = shifted.emotes.replace(
                    /(\d+)-(\d+)/g,
                    (_, start, end) => `${Number(start) + delta}-${Number(end) + delta}`
                );
            return message(
                key,
                'Alice',
                prefix ? mention + body.text.slice(prefix.length) : body.text,
                {
                    ...shifted,
                    'reply-parent-msg-id': parent.tags.id,
                    'reply-parent-user-id': parent.tags['user-id'],
                    'reply-parent-user-login': parent.prefix.split('!')[0],
                    'reply-parent-display-name': parent.tags['display-name'],
                    'reply-parent-msg-body': parent.params[1],
                    ...tags
                }
            );
        };
        const events = [
            { message: message('welcome', 'Alice', t('demoWelcome'), { badges: 'broadcaster/1' }) },
            {
                message: message('original', 'PixelFox', t('demoConversation'), { badges: 'vip/1' })
            },
            { message: message('first', 'Nova', t('demoFirst'), { 'first-msg': '1' }) },
            {
                message: message('gif', 'PixelFox', gif, {
                    gifs: `0-${Array.from(gif).length - 1}|joSNxeswxuc74Juo8X|https://media4.giphy.com/media/joSNxeswxuc74Juo8X/giphy.gif`
                })
            },
            {
                message: message('links', 'ModMia', t('demoLinks'))
            },
            { message: message('twitch-links', 'Alice', t('demoTwitchLinks')) },
            {
                message: message('reply', 'Alice', '@PixelFox ' + t('demoReply'), {
                    'reply-parent-msg-id': id('original'),
                    'reply-parent-user-id': users.PixelFox[0],
                    'reply-parent-user-login': 'pixelfox',
                    'reply-parent-display-name': 'PixelFox',
                    'reply-parent-msg-body': t('demoConversation')
                })
            },
            { message: message('mention', 'ModMia', t('demoMention'), { badges: 'moderator/1' }) },
            {
                message: message('emotes', 'Alice', emotes, {
                    emotes: `25:2-6,${lastEmote}-${lastEmote + 4}`
                })
            },
            { message: message('seven-tv', 'PixelFox', ''), sevenTV: true },
            {
                message: message('reward', 'Nova', t('demoReward'), {
                    'custom-reward-id': 'demo-reward'
                })
            },
            {
                message: message('highlight', 'Alice', t('demoHighlight'), {
                    'msg-id': 'highlighted-message'
                })
            },
            { message: message('cheer', 'PixelFox', t('demoCheer'), { bits: '50' }) },
            { message: message('action', 'Nova', '\u0001ACTION ' + t('demoAction') + '\u0001') },
            { message: message('long', 'Alice', t('demoWrapping')) },
            { message: message('moderated', 'Nova', t('demoModerated')) },
            { message: message('unicode', 'ModMia', t('demoUnicode'), { badges: 'moderator/1' }) },
            {
                moderation: {
                    command: 'CLEARMSG',
                    provider: 'twitch',
                    tags: { 'target-msg-id': id('moderated') },
                    params: ['#demo']
                }
            }
        ];

        // Keep each original immediately before its valid replies, so its media
        // metadata is still cached even with a small visible message limit.
        const variants = [0, 2, 4, 6, 1];
        for (const parentMask of ordered ? variants : shuffle(variants, random)) {
            const flags = (mask) => ({
                gif: !!(mask & 1),
                emoji: !!(mask & 2),
                emote: !!(mask & 4)
            });
            const originalBody = content(flags(parentMask));
            const parent = message(
                'matrix-' + parentMask,
                'PixelFox',
                originalBody.text,
                originalBody.tags
            );
            events.push({ message: parent });
            for (const bodyMask of ordered ? variants : shuffle(variants, random)) {
                events.push({
                    message: reply(
                        `matrix-${parentMask}-reply-${bodyMask}`,
                        parent,
                        content(flags(bodyMask), '@PixelFox ')
                    )
                });
            }
        }

        const pair = (key, text, tags = {}, body = { text: '@PixelFox ' + t('demoReply') }) => {
            const parent = message(key, 'PixelFox', text, tags);
            events.push({ message: parent }, { message: reply(key + '-reply', parent, body) });
            return parent;
        };
        pair('gif-only', gif, {
            gifs: `0-${Array.from(gif).length - 1}|joSNxeswxuc74Juo8X|https://media4.giphy.com/media/joSNxeswxuc74Juo8X/giphy.gif`
        });
        pair('emoji-only', '😀 👩🏽‍💻 🏳️‍🌈 💜');
        pair('emote-only', 'Kappa Kappa', { emotes: '25:0-4,6-10' });
        pair('links-quote', t('demoLinks'), {}, { text: '@PixelFox ' + t('demoLinks') });
        pair('twitch-links-quote', t('demoTwitchLinks'));
        pair('long-quote', Array(6).fill(t('demoWrapping')).join(' '));
        pair('unicode-quote', t('demoUnicode'));
        pair('mentions-quote', t('demoMention'));
        const thread = pair('thread', t('demoConversation'));
        const nested = reply('thread-middle', thread, { text: '@PixelFox ' + t('demoReply') });
        events.push(
            { message: nested },
            { message: reply('thread-last', nested, { text: '@Alice 💜 ' + t('demoReply') }) }
        );
        events.push({
            message: reply(
                'uncached-parent',
                message('not-received', 'PixelFox', t('demoEmotes')),
                { text: '@PixelFox ' + t('demoReply') }
            )
        });
        events.push({ message: reply('mention-only', thread, { text: '@PixelFox' }) });

        const special = content({ emoji: true, emote: true });
        for (const [key, tags] of [
            ['first-media', { 'first-msg': '1' }],
            ['reward-media', { 'custom-reward-id': 'demo-reward' }],
            ['highlight-media', { 'msg-id': 'highlighted-message' }],
            ['badges', { badges: 'moderator/1,subscriber/12,premium/1' }]
        ])
            pair(key, special.text, { ...special.tags, ...tags });
        const action = content({ emoji: true, emote: true }, '\u0001ACTION ');
        pair('action-media', action.text + '\u0001', action.tags);
        events.push({
            message: message(
                'cheer-tiers',
                'Nova',
                'Cheer1 Cheer100 Cheer1000 Cheer5000 Cheer10000',
                { bits: '16101' }
            )
        });
        events.push({ message: message('cheer-text', 'Nova', 'Cheer50') });
        events.push({
            message: message('fallback-color', 'Nova', t('demoConversation'), { color: '' })
        });
        events.push({
            message: message('localized-name', 'Nova', t('demoUnicode'), {
                'display-name': '星のノヴァ'
            })
        });

        const glass = message('stained-glass', 'PrismaNocturno', t('demoConversation'));
        events.push(
            { message: glass },
            {
                message: reply('stained-glass-reply', glass, {
                    text: '@PrismaNocturno ' + t('demoReply')
                })
            }
        );

        const epiphany = message('epiphany', 'ZorroSolar', t('demoConversation'));
        events.push(
            { message: epiphany },
            {
                message: reply('epiphany-reply', epiphany, {
                    text: '@ZorroSolar ' + t('demoReply')
                })
            }
        );

        const shared = pair('shared-chat', special.text, {
            ...special.tags,
            'source-room-id': '999000099',
            'source-id': id('shared-original'),
            'source-badges': 'vip/1'
        });
        shared.sourceId = 'demo-shared';
        events[events.length - 1].message.sourceId = 'demo-shared';
        const bot = message('filtered-bot', 'Nova', t('demoFiltered'));
        events.push({ message: bot, bot: true });
        events.push({
            message: message('filtered-command', 'Nova', '!demo ' + t('demoFiltered')),
            command: true
        });
        events.push({ message: message('filtered-art', 'Nova', '⣿'.repeat(240)) });
        events.push({ message: message('short-art', 'Nova', '⣿⣿⣿ 💜') });

        // Dynamic 7TV tokens are resolved once per pair, preserving the quoted body.
        const sevenParent = pair('seven-tv-quote', '', {}, { text: '' });
        events[events.length - 2].sevenTV = true;
        events[events.length - 1].sevenTVReply = sevenParent;
        for (const mode of ['only', 'overlay', 'isolated-overlay', 'unknown']) {
            const parent = pair('seven-tv-' + mode, '', {}, { text: '' });
            events[events.length - 2].sevenTV = mode;
            events[events.length - 1].sevenTVReply = parent;
        }

        const removed = pair('deleted-parent', special.text, special.tags);
        events.push({
            moderation: {
                provider: 'twitch',
                command: 'CLEARMSG',
                tags: { 'target-msg-id': removed.tags.id },
                params: ['#demo']
            }
        });
        events.push({
            message: reply('deleted-parent-after', removed, { text: '@PixelFox ' + t('demoReply') })
        });
        pair('timeout-parent', t('demoModerated'));
        events.push({
            moderation: {
                provider: 'twitch',
                command: 'CLEARCHAT',
                tags: { 'target-user-id': users.PixelFox[0], 'ban-duration': '60' },
                params: ['#demo', 'pixelfox']
            }
        });
        events.push({ message: message('ban-parent', 'Nova', t('demoModerated')) });
        events.push({
            moderation: {
                provider: 'twitch',
                command: 'CLEARCHAT',
                tags: { 'target-user-id': users.Nova[0] },
                params: ['#demo', 'nova']
            }
        });
        events.push({ message: message('clear-room', 'ModMia', t('demoModerated')) });
        events.push({
            moderation: { provider: 'twitch', command: 'CLEARCHAT', tags: {}, params: ['#demo'] }
        });
        if (ordered) return events;
        // Shuffle independent conversations; replies and deletions stay after their parent.
        // Room-wide/user clears run last, so they cannot hide unrelated sample cases.
        const tailIndex = events.findIndex(
            (event) => event.message?.tags.id === id('timeout-parent')
        );
        const groups = [];
        const parents = new Map();
        for (const event of events.slice(0, tailIndex)) {
            const parentId =
                event.message?.tags['reply-parent-msg-id'] ||
                event.moderation?.tags['target-msg-id'];
            let group = parents.get(parentId);
            if (!group) groups.push((group = []));
            group.push(event);
            if (event.message) parents.set(event.message.tags.id, group);
        }
        return [
            ...groups[0],
            ...shuffle(groups.slice(1), random).flat(),
            ...events.slice(tailIndex)
        ];
    };

    ChatWidget.startDemo = function (runtime, { intervalMs = 1200, random = Math.random } = {}) {
        const { assets, paints, renderer, config } = runtime;
        assets.start(config);
        // A synthetic source exercises source scoping without looking up a fake channel.
        renderer.registerSource?.('demo-shared', {
            channelId: '999000099',
            listeners: assets.listeners || new Set(),
            emote: (name) => assets.emote?.(name),
            badge: (set, version) => assets.badge?.(set, version)
        });
        const styles = shuffle(paintStyles, random);
        const cosmetics = new Map(
            Object.entries(users).map(([name, [userId]], index) => [
                userId,
                // A few plain names make it easy to compare Twitch colors with 7TV paints.
                index === 0 || index === 2 || index === 3
                    ? null
                    : {
                          paint: { backgroundImage: styles[index % styles.length], filter: '' },
                          badge: null
                      }
            ])
        );
        cosmetics.set(users.PrismaNocturno[0], { paint: stainedGlassPaint, badge: null });
        cosmetics.set(users.ZorroSolar[0], { paint: epiphanyPaint, badge: null });
        paints.getCosmetics = async (userId) => cosmetics.get(userId) || null;
        let stopped = false;
        let timer;
        let cycle = 0;
        let index = 0;
        let events = ChatWidget.createDemoEvents(config.language, cycle, { random });
        const next = () => {
            if (stopped) return;
            if (index === events.length) {
                events = ChatWidget.createDemoEvents(config.language, ++cycle, { random });
                index = 0;
            }
            const event = events[index++];
            if (event.bot) {
                const login = config.botLogins?.[0] || 'nightbot';
                event.message.prefix = login + '!demo@demo';
                event.message.tags['display-name'] = login;
            }
            if (event.command) {
                const prefix =
                    String(config.commandPrefixes ?? '!')
                        .split(',')
                        .map((value) => value.trim())
                        .find(Boolean) || '!';
                event.message.params[1] =
                    '  ' +
                    prefix +
                    'demo ' +
                    ChatWidget.i18n.translate(config.language, 'demoFiltered');
            }
            if (event.sevenTV) {
                const entries = [...assets.globalEmotes];
                const base = entries.find(([, info]) => !info.zeroWidth)?.[0] || 'RainTime';
                const overlay =
                    entries.find(([, info]) => info.zeroWidth)?.[0] || 'DemoMissingOverlay';
                const tokens = {
                    only: base,
                    overlay: base + ' ' + overlay,
                    'isolated-overlay': overlay,
                    unknown: 'DemoUnknownEmote'
                }[event.sevenTV];
                event.message.params[1] =
                    tokens ||
                    ChatWidget.i18n.translate(config.language, 'demoSevenTV', {
                        emotes:
                            entries
                                .slice(0, 2)
                                .map(([name]) => name)
                                .join(' ') || 'RainTime PETPET'
                    });
            }
            if (event.sevenTVReply) {
                event.message.tags['reply-parent-msg-body'] = event.sevenTVReply.params[1];
                event.message.params[1] =
                    '@' +
                    event.sevenTVReply.prefix.split('!')[0] +
                    ' ' +
                    event.sevenTVReply.params[1];
            }
            if (event.message) renderer.add(event.message);
            else renderer.moderate(event.moderation);
            timer = setTimeout(next, Math.round(intervalMs * (0.65 + random() * 0.7)));
        };
        next();
        return {
            stop() {
                stopped = true;
                clearTimeout(timer);
            }
        };
    };
})(window.ChatWidget);
