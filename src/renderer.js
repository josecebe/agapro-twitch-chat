(function (ChatWidget) {
    'use strict';

    ChatWidget.Renderer = class {
        constructor(root, config, assets, paints) {
            Object.assign(this, {
                root,
                config,
                assets,
                paints
            });
            this.rows = [];
            this.seen = new Map();
            this.tombstones = new Map();
            this.userClears = new Map();
            this.roomClears = new Map();
            this.userColors = new Map();
            this.userPaints = new Map();
            this.replyMedia = new Map();
            this.roomClear = 0;
            this.tick = setInterval(() => this.expire(), 500);
            this.repaint = () => this.refresh();
            this.assetBindings = new Set([assets]);
            assets.listeners.add(this.repaint);
        }
        t(key, values) {
            return ChatWidget.i18n.translate(this.config.language, key, values);
        }
        renderUsername(node, login, displayName) {
            const formatted = ChatWidget.formatDisplayName(
                login,
                displayName,
                this.config.showLocalizedUsername !== false
            );
            const name = String(displayName || login);
            if (formatted === name) {
                node.textContent = formatted;
                return;
            }
            const suffix = document.createElement('span');
            suffix.className = 'name-login';
            suffix.dir = 'ltr';
            suffix.textContent = formatted.slice(name.length);
            node.replaceChildren();
            node.append(document.createTextNode(name), suffix);
        }
        applyPaint(node, css) {
            if (node._chatPaint === css) {
                return;
            }
            node._chatPaint = css;
            node.classList.remove('painted');
            node.style.backgroundImage = '';
            node.style.filter = '';
            const replyHeading = node.classList.contains('reply-user')
                ? node.closest?.('.reply-heading')
                : null;
            replyHeading?.style.removeProperty('--reply-paint-bleed');
            if (!css || !CSS.supports('background-clip', 'text')) {
                return;
            }
            const probe = document.createElement('span');
            probe.style.backgroundImage = css.backgroundImage;
            if (!probe.style.backgroundImage) {
                return;
            }
            Object.assign(node.style, css, {
                backgroundSize: 'cover',
                backgroundPosition: 'center'
            });
            node.classList.add('painted');
            if (replyHeading && css.filter) {
                // Chained paint shadows can extend beyond the normal text shadow.
                // Reserve their combined bounds inside the heading's overflow clip.
                const bleed = [
                    ...css.filter.matchAll(/drop-shadow\((-?[\d.]+)px (-?[\d.]+)px ([\d.]+)px/g)
                ].reduce(
                    (total, match) =>
                        total +
                        Math.max(Math.abs(Number(match[1])), Math.abs(Number(match[2]))) +
                        3 * Number(match[3]),
                    0
                );
                if (bleed)
                    replyHeading.style.setProperty('--reply-paint-bleed', Math.ceil(bleed) + 'px');
            }
            for (const match of css.backgroundImage.matchAll(/url\("([^"]+)"\)/g)) {
                const img = new Image();
                img.onerror = () => {
                    if (node._chatPaint === css) {
                        this.applyPaint(node, null);
                    }
                };
                img.src = match[1];
            }
        }
        assetsFor(provider = 'twitch', sourceId = '') {
            if (sourceId && this.sourceAssets) {
                return this.sourceAssets.get(sourceId);
            }
            return this.assets;
        }
        registerSource(sourceId, assets) {
            if (!this.sourceAssets) {
                this.sourceAssets = new Map();
            }
            this.sourceAssets.set(sourceId, assets);
            if (!this.assetBindings.has(assets)) {
                this.assetBindings.add(assets);
                assets.listeners.add(this.repaint);
            }
        }
        rememberPaint(login, displayName, css, provider = 'twitch') {
            const aliases = new Set([login, String(displayName || '').toLowerCase()]);
            for (const alias of aliases) {
                if (/^[a-z0-9_]{1,25}$/.test(alias)) {
                    const key = ChatWidget.providerKey(provider, alias);
                    if (css) {
                        this.userPaints.set(key, css);
                    } else {
                        this.userPaints.delete(key);
                    }
                }
            }
            while (this.userPaints.size > 3000) {
                this.userPaints.delete(this.userPaints.keys().next().value);
            }
            for (const mention of this.root.querySelectorAll('.mention')) {
                if (
                    (mention.dataset.provider || 'twitch') === provider &&
                    aliases.has(mention.dataset.login) &&
                    !mention.dataset.preview
                ) {
                    this.applyPaint(mention, css);
                }
            }
        }
        rememberColor(login, displayName, color, provider = 'twitch') {
            if (!/^#[0-9a-f]{6}$/i.test(color || '')) {
                return;
            }
            const aliases = new Set([login, String(displayName || '').toLowerCase()]);
            let changed = false;
            for (const alias of aliases) {
                if (/^[a-z0-9_]{1,25}$/.test(alias)) {
                    const key = ChatWidget.providerKey(provider, alias);
                    if (this.userColors.get(key) !== color) {
                        this.userColors.delete(key);
                        this.userColors.set(key, color);
                        changed = true;
                    }
                }
            }
            while (this.userColors.size > 3000) {
                const alias = this.userColors.keys().next().value;
                this.userColors.delete(alias);
                this.userPaints.delete(alias);
            }
            if (changed) {
                for (const mention of this.root.querySelectorAll('.mention')) {
                    if (
                        (mention.dataset.provider || 'twitch') === provider &&
                        aliases.has(mention.dataset.login) &&
                        !mention.dataset.preview
                    ) {
                        mention.style.color = color;
                    }
                }
            }
        }
        appendText(node, text, provider = 'twitch') {
            if (this.config.showLinkLabels === false) {
                this.appendMentions(node, text, provider);
                return;
            }
            for (const part of ChatWidget.linkParts(text)) {
                if (!part.domain) {
                    this.appendMentions(node, part.text, provider);
                    continue;
                }
                node.append(this.linkLabel(part, node._chatChannel || ''));
            }
        }
        linkLabel(part, chatChannel = '', compact = false) {
            const label = document.createElement('span');
            label.className = 'link-label';
            label.title = part.text;
            const twitch = ChatWidget.twitchLink(part.text, chatChannel);
            if (this.config.showLinkFavicons !== false) {
                const icon = this.image(
                    'https://icons.duckduckgo.com/ip3/' +
                        encodeURIComponent(twitch ? 'twitch.tv' : part.hostname) +
                        '.ico',
                    '',
                    'link-favicon'
                );
                icon.loading = 'lazy';
                icon.onload = () => this.fit();
                icon.onerror = () => {
                    icon.remove();
                    this.fit();
                };
                label.append(icon);
            }
            const domain = document.createElement('span');
            domain.className = 'link-domain';
            let title = compact ? 'LINK' : part.domain.toUpperCase();
            if (twitch && !compact) {
                const key = {
                    home: 'linkTwitch',
                    channel: 'linkTwitchChannel',
                    clip: 'linkTwitchClip',
                    video: 'linkTwitchVideo',
                    directory: 'linkTwitchDirectory',
                    clips: 'linkTwitchClips'
                }[twitch.type];
                title = this.t(key, {
                    channel:
                        twitch.type === 'channel'
                            ? twitch.channel
                            : twitch.channel?.toUpperCase() || ''
                });
            }
            domain.textContent = title;
            label.append(domain);
            return label;
        }
        appendMentions(node, text, provider = 'twitch', preview = false) {
            if (this.config.colorMentions === false || node.classList.contains('action-body')) {
                node.append(document.createTextNode(text));
                return;
            }
            let cursor = 0;
            // The leading boundary avoids matching email addresses.
            const pattern = /(^|[^\p{L}\p{N}_@])(@[a-zA-Z0-9_]{1,25})(?![a-zA-Z0-9_])/gu;
            for (const match of text.matchAll(pattern)) {
                const start = match.index + match[1].length;
                if (start > cursor) {
                    node.append(document.createTextNode(text.slice(cursor, start)));
                }
                const span = document.createElement('span');
                span.className = 'mention';
                span.textContent = match[2];
                span.dataset.login = match[2].slice(1).toLowerCase();
                span.dataset.provider = provider;
                if (preview) span.dataset.preview = 'true';
                const key = ChatWidget.providerKey(provider, span.dataset.login);
                const color = this.userColors.get(key);
                if (color && !preview) {
                    span.style.color = color;
                }
                if (this.config.showSevenTVPaints && !preview) {
                    this.applyPaint(span, this.userPaints.get(key) || null);
                }
                node.append(span);
                cursor = start + match[2].length;
            }
            if (cursor < text.length) {
                node.append(document.createTextNode(text.slice(cursor)));
            }
        }
        replyTarget(tags, provider) {
            if (provider !== 'twitch' || !tags['reply-parent-msg-id']) {
                return null;
            }
            const login = String(tags['reply-parent-user-login'] || '').toLowerCase();
            if (!/^[a-z0-9_]{1,25}$/.test(login)) {
                return null;
            }
            const displayName = String(tags['reply-parent-display-name'] || login);
            return {
                login,
                displayName,
                parentId: String(tags['reply-parent-msg-id']),
                userId: String(tags['reply-parent-user-id'] || '')
            };
        }
        redemptionContext(tags, provider) {
            if (provider !== 'twitch' || this.config.showChannelPointRedemptions === false) {
                return null;
            }
            const custom =
                typeof tags['custom-reward-id'] === 'string' &&
                tags['custom-reward-id'].trim() !== '';
            const highlighted = tags['msg-id'] === 'highlighted-message';
            if (!custom && !highlighted) {
                return null;
            }
            const node = document.createElement('div');
            node.className = 'redemption-context';
            node.textContent = '◈ ' + this.t(custom ? 'rewardRedeemed' : 'highlightedMessage');
            return node;
        }
        replyContext(tags, provider, sourceId = '', chatChannel = '') {
            if (this.config.showReplies === false) {
                return null;
            }
            const target = this.replyTarget(tags, provider);
            if (!target) {
                return null;
            }
            const { login, displayName, parentId } = target;
            const node = document.createElement('div');
            const heading = document.createElement('span');
            const mention = document.createElement('span');
            node.className = 'reply-context';
            heading.className = 'reply-heading';
            mention.className = 'mention reply-user';
            mention.dir = 'auto';
            mention.textContent = '@' + displayName;
            mention.dataset.login = login;
            mention.dataset.provider = 'twitch';
            mention.style.color = this.userColors.get(login) || '#b8b2ff';
            if (this.config.showSevenTVPaints) {
                this.applyPaint(mention, this.userPaints.get(login) || null);
            }
            heading.append(document.createTextNode('↪ ' + this.t('replyTo') + ' '), mention);
            node.append(heading);
            const deleted =
                this.tombstones.has(ChatWidget.scopeKey(provider, sourceId, parentId)) ||
                this.tombstones.has(ChatWidget.providerKey(provider, parentId));
            const preview = String(tags['reply-parent-msg-body'] || '')
                .replace(/\s+/gu, ' ')
                .trim();
            let quote = null;
            if (this.config.showReplyPreview !== false && !deleted && preview) {
                quote = document.createElement('span');
                quote.className = 'reply-quote';
                quote.dir = 'auto';
                quote._previewParentId = ChatWidget.scopeKey(provider, sourceId, parentId);
                quote._previewMedia = this.replyMedia?.get(quote._previewParentId);
                quote._previewSourceId = sourceId;
                quote._previewRoom =
                    quote._previewMedia?.roomId ||
                    ChatWidget.sourceRoom(tags, this.assetsFor(provider, sourceId)?.channelId);
                this.replyPreview(quote, preview, chatChannel);
                node.append(quote);
            }
            return {
                ...target,
                node,
                heading,
                mention,
                preview,
                quote
            };
        }
        replyPreview(quote, text, chatChannel = '') {
            quote._previewMedia =
                this.replyMedia?.get(quote._previewParentId) || quote._previewMedia;
            quote._previewRoom = quote._previewMedia?.roomId || quote._previewRoom;
            quote.replaceChildren();
            quote._previewParts = [];
            quote._previewEllipsis = null;
            quote.title = text;
            const parts =
                this.config.showLinkLabels !== false ? ChatWidget.linkParts(text) : [{ text }];
            quote.append(document.createTextNode('— '));
            for (const part of parts) {
                const node = part.domain
                    ? this.linkLabel(part, chatChannel, true)
                    : document.createElement('span');
                if (!part.domain) this.previewText(node, part.text, quote);
                for (const child of part.domain ? [node] : Array.from(node.childNodes)) {
                    let fragment = child;
                    if (child.nodeType === 3) {
                        fragment = document.createElement('span');
                        fragment.append(child);
                    }
                    fragment.classList.add('reply-preview-part');
                    quote._previewParts.push(fragment);
                    quote.append(fragment);
                }
            }
            if (
                !quote._previewParts.some(
                    (part) =>
                        part.classList.contains('link-label') ||
                        part.classList.contains('emote-stack')
                )
            )
                return;
            const ellipsis = document.createElement('span');
            ellipsis.className = 'reply-preview-ellipsis';
            ellipsis.textContent = '…';
            ellipsis.hidden = true;
            quote._previewEllipsis = ellipsis;
            quote.append(ellipsis);
        }
        previewText(node, text, quote) {
            const media = quote._previewMedia?.parts || [];
            const names = media
                .map((part) => part.text.replace(/\s+/gu, ' ').trim())
                .filter(Boolean);
            const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const pattern = new RegExp(
                '(' +
                    [
                        ...escaped.map((name) => '(?<![a-zA-Z0-9_])' + name + '(?![a-zA-Z0-9_])'),
                        '\\[GIF\\]',
                        '\\s+'
                    ].join('|') +
                    ')',
                'gu'
            );
            const assets = this.assetsFor('twitch', quote._previewSourceId || '');
            let base = null;
            let spaces = '';
            const flush = () => {
                if (spaces) node.append(document.createTextNode(spaces));
                spaces = '';
            };
            for (const token of text.split(pattern)) {
                if (!token) continue;
                if (/^\s+$/u.test(token)) {
                    spaces += token;
                    continue;
                }
                const native = media.find(
                    (part) => part.text.replace(/\s+/gu, ' ').trim() === token
                );
                if (native?.gif || token === '[GIF]') {
                    flush();
                    const label = document.createElement('span');
                    label.className = 'link-label gif-label';
                    label.textContent = 'GIF';
                    node.append(label);
                    base = null;
                    continue;
                }
                const info =
                    native?.id && this.config.showTwitchEmotes
                        ? {
                              src:
                                  'https://static-cdn.jtvnw.net/emoticons/v2/' +
                                  encodeURIComponent(native.id) +
                                  '/default/dark/2.0'
                          }
                        : this.config.showSevenTVEmotes
                          ? assets?.emote(token, quote._previewRoom)
                          : null;
                if (info) {
                    if (info.zeroWidth && base) {
                        spaces = '';
                        base.append(this.image(info.src, token, 'emote overlay', info.ratio));
                    } else {
                        flush();
                        base = document.createElement('span');
                        base.className = 'emote-stack';
                        base.append(this.image(info.src, token, 'emote', info.ratio));
                        node.append(base);
                    }
                } else {
                    flush();
                    this.appendMentions(node, token, 'twitch', true);
                    base = null;
                }
            }
            flush();
        }
        fitReplyPreviews() {
            const previews = this.rows
                .map((record) => record.reply?.quote)
                .filter((quote) => quote?._previewEllipsis && quote.getBoundingClientRect);
            for (const quote of previews) {
                for (const part of quote._previewParts) part.hidden = false;
                quote._previewEllipsis.hidden = true;
            }
            const cuts = previews.flatMap((quote) => {
                const bounds = quote.getBoundingClientRect();
                const index = quote._previewParts.findIndex((part) => {
                    if (
                        !part.classList.contains('link-label') &&
                        !part.classList.contains('emote-stack')
                    )
                        return false;
                    const rect = part.getBoundingClientRect();
                    return rect.left < bounds.left - 0.5 || rect.right > bounds.right + 0.5;
                });
                return index < 0 ? [] : [{ quote, index }];
            });
            for (const { quote, index } of cuts) {
                for (const part of quote._previewParts.slice(index)) part.hidden = true;
                quote._previewEllipsis.hidden = false;
            }
        }
        resolveReply(record) {
            const reply = record.reply;
            if (
                !reply ||
                !this.config.showSevenTVPaints ||
                !/^\d+$/.test(reply.userId) ||
                !record.row.isConnected
            ) {
                return;
            }
            this.paints
                .getCosmetics(reply.userId, () => record.row.isConnected, 'TWITCH')
                .then((cosmetics) => {
                    if (!record.row.isConnected) {
                        return;
                    }
                    this.rememberPaint(
                        reply.login,
                        reply.displayName,
                        cosmetics?.paint || null,
                        'twitch'
                    );
                });
        }
        shiftEmotes(emotes, offset) {
            return emotes
                .split('/')
                .flatMap((group) => {
                    const [id, ranges] = group.split(':');
                    if (!/^\d+$/.test(id) || !ranges) {
                        return [];
                    }
                    const shifted = ranges.split(',').flatMap((range) => {
                        const match = range.match(/^(\d+)-(\d+)$/);
                        if (!match) {
                            return [];
                        }
                        const start = Number(match[1]);
                        const end = Number(match[2]);
                        return start + offset >= 0 && end >= start
                            ? [`${start + offset}-${end + offset}`]
                            : [];
                    });
                    return shifted.length ? [id + ':' + shifted.join(',')] : [];
                })
                .join('/');
        }
        shiftGifs(gifs, offset) {
            return gifs
                .split(',')
                .flatMap((entry) => {
                    const match = entry.match(/^(\d+)-(\d+)(\|.+)$/);
                    if (!match) return [];
                    const start = Number(match[1]) + offset;
                    const end = Number(match[2]) + offset;
                    return start >= 0 && end >= start ? [`${start}-${end}${match[3]}`] : [];
                })
                .join(',');
        }
        replyBody(text, emotes, reply, tags, provider) {
            const target =
                reply ||
                (this.config.showReplies === false ? this.replyTarget(tags, provider) : null);
            if (!target) {
                return {
                    text,
                    emotes
                };
            }
            const prefix = text.match(/^\s*@([a-z0-9_]{1,25})[,:]?(?:\s+|$)/i);
            const matches =
                prefix &&
                [target.login, target.displayName.toLowerCase()].includes(prefix[1].toLowerCase());
            if (!reply) {
                if (matches) {
                    return {
                        text,
                        emotes
                    };
                }
                const mention = '@' + target.login + ' ';
                return {
                    text: mention + text,
                    emotes: this.shiftEmotes(emotes, Array.from(mention).length)
                };
            }
            if (!matches || prefix[0].length === text.length) {
                return {
                    text,
                    emotes
                };
            }
            return {
                text: text.slice(prefix[0].length),
                emotes: this.shiftEmotes(emotes, -Array.from(prefix[0]).length)
            };
        }
        image(src, alt, className, ratio) {
            const img = document.createElement('img');
            img.className = className;
            img.alt = alt;
            img.title = alt;
            img.src = src;
            img.referrerPolicy = 'no-referrer';
            img.decoding = 'async';
            if (ratio) {
                img.style.width = `calc(var(--emote-size) * ${ratio})`;
            } else if (className === 'emote') {
                img.style.width = 'var(--emote-size)';
                img.onload = () => {
                    if (img.naturalHeight) {
                        img.style.width = `calc(var(--emote-size) * ${ChatWidget.clamp(img.naturalWidth / img.naturalHeight, 0.1, 12, 1)})`;
                    }
                    this.fit();
                };
            }
            img.onerror = () => {
                if (className === 'badge' || className === 'provider-icon') {
                    img.remove();
                } else {
                    const fallbackText = document.createTextNode(alt);
                    img.replaceWith(fallbackText);
                }
                this.fit();
            };
            return img;
        }
        providerIcon(provider) {
            if (
                this.config.showProviderIcon !== true ||
                !Object.hasOwn(ChatWidget.messageProviders, provider)
            ) {
                return null;
            }
            const info = ChatWidget.messageProviders[provider];
            const icon = this.image(info.favicon, info.name, 'provider-icon');
            icon.title = info.name + ' (' + info.domain + ')';
            return icon;
        }
        badges(node, tags, sevenTVBadge = null, provider = 'twitch', sourceId = '') {
            node.replaceChildren();
            if (!this.config.showBadges) {
                return;
            }
            const assets = this.assetsFor(provider, sourceId);
            const hasSourceBadges =
                /^\d+$/.test(tags['source-room-id'] || '') &&
                typeof tags['source-badges'] === 'string';
            const badgeTags = hasSourceBadges ? tags['source-badges'] : tags.badges || '';
            const roomId = hasSourceBadges
                ? tags['source-room-id']
                : tags['room-id'] || assets?.channelId;
            for (const token of badgeTags.split(',')) {
                const [set, version] = token.split('/');
                const badge = assets?.badge(set, version, roomId);
                if (!badge) {
                    continue;
                }
                const src = ChatWidget.safeURL(
                    badge.image_url_4x || badge.image_url_2x || badge.image_url_1x,
                    ['static-cdn.jtvnw.net']
                );
                if (src) {
                    node.append(this.image(src, badge.title || set, 'badge'));
                }
            }
            if (this.config.showSevenTVBadges !== false && sevenTVBadge) {
                const src = ChatWidget.safeURL(sevenTVBadge.src, ['cdn.7tv.app', 'cdn.7tv.io']);
                if (src) {
                    node.append(this.image(src, '7TV · ' + sevenTVBadge.title, 'badge'));
                }
            }
        }
        body(
            node,
            text,
            tag,
            bits = '',
            roomId = '',
            provider = 'twitch',
            sourceId = '',
            gifs = ''
        ) {
            node.replaceChildren();
            let base = null;
            let spaces = '';
            const assets = this.assetsFor(provider, sourceId);
            if (!roomId) {
                roomId = assets?.channelId;
            }
            let remainingBits =
                /^[1-9]\d*$/.test(String(bits)) && Number.isSafeInteger(Number(bits))
                    ? Number(bits)
                    : 0;
            const flush = () => {
                if (spaces) {
                    node.append(document.createTextNode(spaces));
                    spaces = '';
                }
            };
            const emote = (info, alt) => {
                if (info.zeroWidth && base) {
                    spaces = '';
                    base.append(this.image(info.src, alt, 'emote overlay', info.ratio));
                    return;
                }
                flush();
                const stack = document.createElement('span');
                stack.className = 'emote-stack';
                stack.append(this.image(info.src, alt, 'emote', info.ratio));
                node.append(stack);
                base = stack;
            };
            const parts = ChatWidget.nativeParts(
                text,
                provider === 'twitch' && this.config.showTwitchEmotes ? tag : '',
                provider === 'twitch' ? gifs : ''
            );
            for (const part of parts) {
                if (part.gif) {
                    flush();
                    base = null;
                    if (this.config.showTwitchGifs === false) {
                        const label = document.createElement('span');
                        label.className = 'link-label gif-label';
                        label.textContent = 'GIF';
                        node.append(label);
                        continue;
                    }
                    const img = this.image(part.gif, part.text, 'chat-gif');
                    img.onload = () => this.fit();
                    node.append(img);
                    continue;
                }
                if (part.id) {
                    emote(
                        {
                            src:
                                'https://static-cdn.jtvnw.net/emoticons/v2/' +
                                encodeURIComponent(part.id) +
                                '/default/dark/2.0'
                        },
                        part.name || part.text
                    );
                    continue;
                }
                for (const token of part.text.split(/(\s+)/u)) {
                    if (!token) {
                        continue;
                    }
                    if (/^\s+$/u.test(token)) {
                        spaces += token;
                        continue;
                    }
                    const cheer =
                        provider === 'twitch' && this.config.showCheers !== false
                            ? ChatWidget.cheerToken(token, remainingBits)
                            : null;
                    if (cheer) {
                        flush();
                        base = null;
                        remainingBits -= cheer.amount;
                        const span = document.createElement('span');
                        span.className = 'cheer';
                        span.style.color = cheer.color;
                        span.title = cheer.amount + ' Bits';
                        const icon = this.image(cheer.src, token, 'cheer-icon');
                        icon.onerror = () => span.replaceWith(document.createTextNode(token));
                        const amount = document.createElement('span');
                        amount.className = 'cheer-amount';
                        amount.textContent = String(cheer.amount);
                        span.append(icon, amount);
                        node.append(span);
                        continue;
                    }
                    const info = this.config.showSevenTVEmotes
                        ? assets?.emote(token, roomId)
                        : null;
                    if (info) {
                        emote(info, token);
                    } else {
                        flush();
                        this.appendText(node, token, provider);
                        base = null;
                    }
                }
            }
            flush();
        }
        add(message) {
            if (message.provider && message.provider !== 'twitch') {
                return;
            }
            const provider = message.provider || 'twitch';
            const sourceId = message.sourceId || '';
            const tags = message.tags;
            const login = message.prefix.split('!')[0].toLowerCase();
            const id = tags.id ? ChatWidget.scopeKey(provider, sourceId, tags.id) : '';
            const source = tags['source-id']
                ? ChatWidget.providerKey(provider, tags['source-id'])
                : id;
            const now = Date.now();
            const rawText = message.params[message.params.length - 1] || '';
            if (ChatWidget.hideMessage(this.config, login, rawText)) {
                return;
            }
            const userColor = /^#[0-9a-f]{6}$/i.test(tags.color || '') ? tags.color : '#b8b2ff';
            this.rememberColor(login, tags['display-name'], userColor, provider);
            const stamp = Number(tags['tmi-sent-ts']) || now;
            const roomClear = sourceId ? this.roomClears?.get(sourceId) || 0 : this.roomClear;
            if (
                stamp <= roomClear ||
                stamp <=
                    (this.userClears.get(
                        ChatWidget.scopeKey(provider, sourceId, tags['user-id'] || login)
                    ) || 0) ||
                this.tombstones.has(id) ||
                this.tombstones.has(source) ||
                (tags['source-id'] &&
                    this.tombstones.has(ChatWidget.scopeKey(provider, sourceId, tags['source-id'])))
            ) {
                return;
            }
            if (source && this.seen.has(source)) {
                return;
            }
            if (source) {
                this.seen.set(source, now);
            }
            while (this.seen.size > 3000) {
                this.seen.delete(this.seen.keys().next().value);
            }
            const assets = this.assetsFor(provider, sourceId);
            const sourceRoom = ChatWidget.sourceRoom(tags, assets?.channelId);
            if (id) {
                this.replyMedia ||= new Map();
                this.replyMedia.set(id, {
                    roomId: sourceRoom,
                    parts: ChatWidget.nativeParts(
                        rawText,
                        tags.emotes || '',
                        tags.gifs || ''
                    ).filter((part) => part.id || part.gif)
                });
                while (this.replyMedia.size > 200)
                    this.replyMedia.delete(this.replyMedia.keys().next().value);
            }
            if (provider === 'twitch' && sourceRoom && sourceRoom !== assets?.channelId) {
                assets?.ensureSource?.(sourceRoom);
            }
            const row = document.createElement('div');
            row.className = 'message';
            const badges = document.createElement('span');
            const name = document.createElement('span');
            const body = document.createElement('span');
            name.className = 'name';
            body.className = 'body';
            body._chatChannel = String(message.params[0] || '')
                .replace(/^#/, '')
                .toLowerCase();
            this.renderUsername(name, login, tags['display-name']);
            name.style.color = userColor;
            name.dir = 'auto';
            body.dir = 'auto';
            let text = message.params[message.params.length - 1] || '';
            let emotes = tags.emotes || '';
            let gifs = tags.gifs || '';
            if (text.startsWith('\x01ACTION ') && text.endsWith('\x01')) {
                text = text.slice(8, -1);
                row.classList.add('action');
                body.classList.add('action-body');
                body.style.color = userColor;
                gifs = this.shiftGifs(gifs, -8);
                emotes = emotes.replace(
                    /(\d+)-(\d+)/g,
                    (match, startIndex, endIndex) =>
                        `${Number(startIndex) - 8}-${Number(endIndex) - 8}`
                );
            }
            if (
                provider === 'twitch' &&
                this.config.highlightFirstMessages !== false &&
                tags['first-msg'] === '1'
            ) {
                row.classList.add('first-message');
                if (this.config.firstMessageBackground !== false) {
                    row.classList.add('first-message-background');
                }
                const label = document.createElement('div');
                label.className = 'first-message-label';
                label.textContent = this.t('firstMessage');
                row.append(label);
            }
            const redemption = this.redemptionContext(tags, provider);
            if (redemption) {
                row.classList.add('channel-points-redemption');
                row.append(redemption);
            }
            const reply = this.replyContext(tags, provider, sourceId, body._chatChannel);
            if (reply) {
                row.append(reply.node);
            }
            const originalLength = Array.from(text).length;
            ({ text, emotes } = this.replyBody(text, emotes, reply, tags, provider));
            gifs = this.shiftGifs(gifs, Array.from(text).length - originalLength);
            const providerIcon = this.providerIcon(provider);
            const content = document.createElement('div');
            content.className = 'message-content';
            if (providerIcon) {
                content.append(providerIcon);
            }
            content.append(
                badges,
                name,
                document.createTextNode(row.classList.contains('action') ? ' ' : ': '),
                body
            );
            row.append(content);
            const record = {
                row,
                content,
                badges,
                name,
                body,
                reply,
                t: tags,
                text,
                emotes,
                gifs,
                id,
                source,
                sourceRoom,
                provider,
                sourceId,
                user: ChatWidget.providerKey(provider, tags['user-id'] || login),
                login,
                time: now
            };
            this.badges(badges, tags, null, provider, sourceId);
            this.body(body, text, emotes, tags.bits, sourceRoom, provider, sourceId, gifs);
            if (this.config.layout === 'stack-top') {
                this.root.prepend(row);
            } else {
                this.root.append(row);
            }
            this.rows.push(record);
            while (this.rows.length > this.config.maxMessages) {
                this.remove(this.rows[0]);
            }
            this.fit();
            this.resolveReply(record);
            if (
                this.config.showSevenTVPaints ||
                (this.config.showBadges && this.config.showSevenTVBadges !== false)
            ) {
                this.paints
                    .getCosmetics(tags['user-id'] || '', () => row.isConnected, 'TWITCH')
                    .then((cosmetics) => {
                        if (!row.isConnected) {
                            return;
                        }
                        record.sevenTVBadge = cosmetics?.badge || null;
                        this.badges(badges, tags, record.sevenTVBadge, provider, sourceId);
                        if (this.config.showSevenTVPaints) {
                            const css = cosmetics?.paint || null;
                            this.applyPaint(name, css);
                            if (row.classList.contains('action')) {
                                this.applyPaint(body, css);
                            }
                            this.rememberPaint(login, tags['display-name'], css, provider);
                        }
                    });
            }
        }
        fit() {
            this.fitReplyPreviews();
            // DOM text ranges include unused font ascent/descent. Measure the glyphs
            // so text, emoji and media all use the same visible outer spacing.
            this.textMeasure ||= document.createElement('canvas').getContext?.('2d');
            const fonts = new Map();
            const metrics = new Map();
            const inkRects = (range, node) => {
                const rects = Array.from(range.getClientRects());
                if (!this.textMeasure) return rects;
                if (!node.textContent.trim()) return [];
                const parent = node.parentElement;
                if (!fonts.has(parent)) fonts.set(parent, getComputedStyle(parent).font);
                const font = fonts.get(parent);
                const key = font + '\n' + node.textContent;
                if (!metrics.has(key)) {
                    this.textMeasure.font = font;
                    metrics.set(key, this.textMeasure.measureText(node.textContent));
                }
                const measured = metrics.get(key);
                if (!Number.isFinite(measured.fontBoundingBoxAscent)) return rects;
                return rects.map((rect) => {
                    const baseline = rect.top + measured.fontBoundingBoxAscent;
                    const top = baseline - measured.actualBoundingBoxAscent;
                    const bottom = baseline + measured.actualBoundingBoxDescent;
                    return { top, bottom, height: bottom - top };
                });
            };
            // Read all rows before applying layout changes. Media and label
            // backgrounds retain their full bounds, including in reply previews.
            const spacing = this.rows.flatMap((record) =>
                [record.reply?.node, record.content].flatMap((content) => {
                    if (!content?.getBoundingClientRect) return [];
                    const bounds = content.getBoundingClientRect();
                    const reply = content === record.reply?.node;
                    const clips = reply
                        ? [record.reply.heading, record.reply.quote]
                              .filter(
                                  (node) => node && getComputedStyle(node).overflowY !== 'visible'
                              )
                              .map((node) => ({ node, bounds: node.getBoundingClientRect() }))
                        : [];
                    const visibleRect = (rect, node) => {
                        const clip = clips.find((clip) => clip.node.contains(node));
                        if (!clip) return rect;
                        const top = Math.max(rect.top, clip.bounds.top);
                        const bottom = Math.min(rect.bottom, clip.bounds.bottom);
                        return { top, bottom, height: Math.max(0, bottom - top) };
                    };
                    const range = document.createRange();
                    const walker = document.createTreeWalker(content, 4);
                    const rects = [];
                    while (walker.nextNode()) {
                        range.selectNodeContents(walker.currentNode);
                        rects.push(
                            ...inkRects(range, walker.currentNode).map((rect) =>
                                visibleRect(rect, walker.currentNode)
                            )
                        );
                    }
                    for (const img of content.querySelectorAll('img')) {
                        rects.push(visibleRect(img.getBoundingClientRect(), img));
                    }
                    for (const label of content.querySelectorAll('.link-label')) {
                        rects.push(visibleRect(label.getBoundingClientRect(), label));
                    }
                    const visible = rects.filter((rect) => rect.height > 0);
                    if (!visible.length) return [];
                    return [
                        {
                            content,
                            reply,
                            start: bounds.top - Math.min(...visible.map((rect) => rect.top)),
                            end: Math.max(...visible.map((rect) => rect.bottom)) - bounds.bottom
                        }
                    ];
                })
            );
            for (const { content, reply, start, end } of spacing) {
                content.style.marginBlockStart = start + 'px';
                content.style.marginBlockEnd = reply
                    ? `calc(var(--reply-gap, 4px) + ${end}px)`
                    : end + 'px';
            }
            const frame = this.root.getBoundingClientRect?.();
            const outsideFrame = () => {
                if (!frame) return false;
                const oldest = this.rows[0].row.getBoundingClientRect();
                return this.config.layout === 'stack-top'
                    ? oldest.top >= frame.bottom
                    : oldest.bottom <= frame.top;
            };
            // Keep partially visible messages until their entire row leaves the frame.
            while (this.rows.length > 1 && outsideFrame()) {
                this.remove(this.rows[0]);
            }
        }
        refresh() {
            for (const record of this.rows) {
                if (record.name) {
                    this.renderUsername(record.name, record.login, record.t['display-name']);
                }
                if (record.reply?.quote) {
                    this.replyPreview(
                        record.reply.quote,
                        record.reply.preview,
                        record.body._chatChannel
                    );
                }
                this.badges(
                    record.badges,
                    record.t,
                    record.sevenTVBadge,
                    record.provider,
                    record.sourceId
                );
                this.body(
                    record.body,
                    record.text,
                    record.emotes,
                    record.t.bits,
                    record.sourceRoom,
                    record.provider,
                    record.sourceId,
                    record.gifs
                );
            }
            this.fit();
        }
        clearExit(record) {
            clearTimeout(record.exitTimer);
            if (record.onExit) {
                record.row.removeEventListener('animationend', record.onExit);
                record.row.removeEventListener('animationcancel', record.onExit);
                record.onExit = null;
            }
        }
        remove(record) {
            this.clearExit(record);
            record.row.remove();
            const index = this.rows.indexOf(record);
            if (index >= 0) {
                this.rows.splice(index, 1);
            }
        }
        removeModerated(records) {
            const rows = Array.isArray(records) ? records : [records];
            if (
                rows.length &&
                this.config.enableAnimations &&
                this.config.moderationAnimation !== 'none' &&
                typeof ChatWidget.DustEffects === 'function'
            ) {
                try {
                    if (!this.dust) {
                        this.dust = new ChatWidget.DustEffects();
                    }
                    for (const record of rows) {
                        this.dust.burst(record.row);
                    }
                } catch {
                    this.dust?.stop();
                }
            }
            for (const record of rows) {
                this.remove(record);
            }
        }
        expireRow(record) {
            if (record.exiting) {
                return;
            }
            if (
                !this.config.enableAnimations ||
                (typeof window.matchMedia === 'function' &&
                    window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            ) {
                this.remove(record);
                return;
            }
            record.exiting = true;
            record.onExit = (event) => {
                if (event.target === record.row && event.animationName === 'disappear') {
                    this.remove(record);
                }
            };
            record.row.addEventListener('animationend', record.onExit);
            record.row.addEventListener('animationcancel', record.onExit);
            record.row.classList.add('leaving');
            record.exitTimer = setTimeout(() => this.remove(record), 350);
        }
        clearReplyPreviews(message) {
            if (
                (message.provider || 'twitch') !== 'twitch' ||
                !['CLEARMSG', 'CLEARCHAT'].includes(message.command)
            ) {
                return;
            }
            const tags = message.tags;
            const target = tags['target-msg-id'];
            const user = tags['target-user-id'];
            const login = message.params[1]?.toLowerCase();
            for (const record of this.rows) {
                const reply = record.reply;
                if (
                    !reply?.quote ||
                    record.provider !== 'twitch' ||
                    (message.sourceId && record.sourceId !== message.sourceId)
                ) {
                    continue;
                }
                const matches =
                    message.command === 'CLEARMSG'
                        ? !!target && reply.parentId === target
                        : user
                          ? reply.userId === user
                          : login
                            ? reply.login === login
                            : true;
                if (matches) {
                    reply.quote.remove();
                    reply.quote = null;
                }
            }
        }
        moderate(message) {
            if (message.provider && message.provider !== 'twitch') {
                return;
            }
            this.clearReplyPreviews(message);
            const provider = message.provider || 'twitch';
            const sourceId = message.sourceId || '';
            const tags = message.tags;
            const sameSource = (record) =>
                (record.provider || 'twitch') === provider &&
                (!sourceId || record.sourceId === sourceId);
            if (message.command === 'CLEARMSG') {
                const target = tags['target-msg-id'];
                const id = target ? ChatWidget.scopeKey(provider, sourceId, target) : '';
                const original = target ? ChatWidget.providerKey(provider, target) : '';
                if (id) {
                    this.tombstones.set(id, Date.now());
                }
                this.removeModerated(
                    this.rows.filter(
                        (record) =>
                            sameSource(record) && (record.id === id || record.source === original)
                    )
                );
            }
            if (message.command === 'CLEARCHAT') {
                const rawUser = tags['target-user-id'];
                const user = rawUser ? ChatWidget.providerKey(provider, rawUser) : '';
                const login = message.params[1]?.toLowerCase();
                const stamp = Number(tags['tmi-sent-ts']) || Date.now();
                if (!user && !login) {
                    if (sourceId) {
                        if (!this.roomClears) {
                            this.roomClears = new Map();
                        }
                        this.roomClears.set(sourceId, stamp);
                    } else {
                        this.roomClear = stamp;
                    }
                } else {
                    this.userClears.set(
                        ChatWidget.scopeKey(provider, sourceId, rawUser || login),
                        stamp
                    );
                }
                this.removeModerated(
                    this.rows.filter(
                        (record) =>
                            sameSource(record) &&
                            ((!user && !login) ||
                                (user ? record.user === user : record.login === login))
                    )
                );
            }
            while (this.tombstones.size > 3000) {
                this.tombstones.delete(this.tombstones.keys().next().value);
            }
            while (this.userClears.size > 3000) {
                this.userClears.delete(this.userClears.keys().next().value);
            }
        }
        expire() {
            const ttl = this.config.messageLifetimeSeconds * 1000;
            if (ttl) {
                for (const record of [...this.rows]) {
                    if (Date.now() - record.time >= ttl) {
                        this.expireRow(record);
                    }
                }
            }
        }
        stop() {
            clearInterval(this.tick);
            for (const record of this.rows) {
                this.clearExit(record);
            }
            this.dust?.stop();
            for (const assets of this.assetBindings || [this.assets]) {
                assets.listeners.delete(this.repaint);
            }
        }
    };
})(window.ChatWidget);
