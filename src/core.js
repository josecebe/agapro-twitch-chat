(function (globalObject) {
    'use strict';

    const ChatWidget = (globalObject.ChatWidget = {});
    ChatWidget.resolveColor = function (value, fallback = '#000000', opacity = 1) {
        const parse = (input) => {
            const text = String(input || '').trim();
            if (text.toLowerCase() === 'transparent') return [0, 0, 0, 0];
            const hex = text.match(/^#([a-f\d]{3,4}|[a-f\d]{6}|[a-f\d]{8})$/i)?.[1];
            if (hex) {
                const expanded =
                    hex.length <= 4 ? [...hex].map((char) => char + char).join('') : hex;
                return [0, 2, 4]
                    .map((offset) => parseInt(expanded.slice(offset, offset + 2), 16))
                    .concat(expanded.length === 8 ? parseInt(expanded.slice(6), 16) / 255 : 1);
            }
            const rgb = text.match(/^rgba?\(([^)]+)\)$/i)?.[1];
            if (!rgb) return null;
            const parts = rgb.replace(/[,/]/g, ' ').trim().split(/\s+/);
            if (
                ![3, 4].includes(parts.length) ||
                parts.some((part) => !/^[+-]?(?:\d+\.?\d*|\.\d+)%?$/.test(part))
            )
                return null;
            const numbers = parts.map((part, index) => {
                const maximum = index === 3 ? 1 : 255;
                const number = part.endsWith('%')
                    ? (parseFloat(part) / 100) * maximum
                    : parseFloat(part);
                return Math.max(0, Math.min(maximum, number));
            });
            return numbers.length === 3 ? [...numbers, 1] : numbers;
        };
        const [red, green, blue, alpha] = parse(value) || parse(fallback) || [0, 0, 0, 1];
        const effectiveAlpha =
            alpha *
            Math.max(0, Math.min(1, Number.isFinite(Number(opacity)) ? Number(opacity) : 1));
        return { css: `rgba(${red},${green},${blue},${effectiveAlpha})`, alpha: effectiveAlpha };
    };
    ChatWidget.messageProviders = {
        twitch: {
            name: 'Twitch',
            domain: 'twitch.tv',
            favicon: 'https://icons.duckduckgo.com/ip3/twitch.tv.ico'
        }
    };
    ChatWidget.formatDisplayName = function (login, displayName, showLocalizedUsername = true) {
        const username = String(login || '').toLowerCase();
        const name = String(displayName || username);
        const localized =
            /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Arabic}]/u.test(
                name
            );
        return showLocalizedUsername &&
            /^[a-z0-9_]{1,25}$/.test(username) &&
            localized &&
            name.toLowerCase() !== username
            ? `${name} (${username})`
            : name;
    };
    ChatWidget.providerKey = (_provider, value) => value;
    ChatWidget.scopeKey = (provider, sourceId, value) =>
        sourceId ? sourceId + '|' + value : ChatWidget.providerKey(provider, value);
    ChatWidget.normalizeSources = function (input) {
        const sources = [];
        const errors = [];
        const seen = new Set();
        if (!Array.isArray(input)) {
            return {
                sources,
                errors: ['sources must be an array']
            };
        }
        for (let index = 0; index < input.length; index++) {
            const item = input[index];
            if (item?.enabled === false) {
                continue;
            }
            if (!item || typeof item !== 'object') {
                errors.push('sources[' + index + ']: invalid entry');
                continue;
            }
            const provider = String(item.provider || 'twitch')
                .trim()
                .toLowerCase();
            const channel = String(item.channel || '')
                .trim()
                .replace(/^[@#]/, '')
                .toLowerCase();
            if (provider !== 'twitch') {
                errors.push('sources[' + index + ']: provider must be twitch');
                continue;
            }
            if (!/^[a-z0-9_]{1,25}$/.test(channel) || channel === 'your_channel') {
                errors.push('sources[' + index + ']: invalid channel');
                continue;
            }
            const id = provider + ':' + channel;
            if (seen.has(id)) {
                errors.push('sources[' + index + ']: duplicate source ' + id);
                continue;
            }
            const ids = {};
            let valid = true;
            for (const field of ['channelId']) {
                ids[field] = String(item[field] ?? '').trim();
                if (ids[field] && !/^\d+$/.test(ids[field])) {
                    errors.push('sources[' + index + ']: ' + field + ' must be numeric');
                    valid = false;
                }
            }
            if (!valid) {
                continue;
            }
            seen.add(id);
            sources.push({
                id,
                provider,
                channel,
                ...ids
            });
        }
        return {
            sources,
            errors
        };
    };
    ChatWidget.sourceRoom = function (tags, fallback = '') {
        return (
            [tags['source-room-id'], tags['room-id'], fallback].find(
                (id) => typeof id === 'string' && /^\d+$/.test(id)
            ) || ''
        );
    };
    ChatWidget.isLargeCharacterArt = function (text, options = {}) {
        if (options?.enabled !== true) {
            return false;
        }
        const minChars = Math.round(ChatWidget.clamp(options.minChars, 40, 10000, 200));
        if (text.length < minChars) {
            return false;
        }
        const ratio = ChatWidget.clamp(options.minDrawingRatio, 0.5, 1, 0.8);
        const minRun = Math.round(ChatWidget.clamp(options.minRun, 8, 10000, 80));
        const minLines = Math.round(ChatWidget.clamp(options.minSimilarLines, 3, 100, 4));
        let count = 0;
        let drawings = 0;
        let run = 0;
        let longest = 0;
        let lineWidth = 0;
        let lineCount = 0;
        let lineDrawings = 0;
        let referenceWidth = 0;
        let similarLines = 0;
        let grid = false;
        let previousCR = false;
        const finishLine = () => {
            if (lineWidth >= 16 && lineCount > 0 && lineDrawings > lineCount * ratio) {
                if (
                    similarLines &&
                    Math.abs(lineWidth - referenceWidth) <= Math.max(2, referenceWidth * 0.2)
                ) {
                    similarLines++;
                } else {
                    referenceWidth = lineWidth;
                    similarLines = 1;
                }
                if (similarLines >= minLines) {
                    grid = true;
                }
            } else {
                similarLines = 0;
            }
            lineWidth = lineCount = lineDrawings = 0;
        };
        // Scan code points once; U+2800 is a drawing character despite looking blank.
        for (const char of text) {
            const code = char.codePointAt(0);
            if (code === 10 || code === 13 || code === 0x2028 || code === 0x2029) {
                if (code !== 10 || !previousCR) {
                    finishLine();
                }
                previousCR = code === 13;
                run = 0;
                continue;
            }
            previousCR = false;
            const whitespace =
                code <= 0x20 ||
                code === 0xa0 ||
                code === 0x1680 ||
                (code >= 0x2000 && code <= 0x200a) ||
                code === 0x202f ||
                code === 0x205f ||
                code === 0x3000 ||
                code === 0xfeff;
            const drawing =
                (code >= 0x2500 && code <= 0x259f) || (code >= 0x2800 && code <= 0x28ff);
            // Twitch can flatten pasted drawing rows into space-separated blocks.
            if (whitespace && run >= 16) {
                finishLine();
                run = 0;
                continue;
            }
            lineWidth++;
            if (!whitespace) {
                count++;
                lineCount++;
            }
            if (drawing) {
                drawings++;
                lineDrawings++;
                run++;
                if (run > longest) {
                    longest = run;
                }
            } else {
                run = 0;
            }
        }
        finishLine();
        return count >= minChars && drawings > count * ratio && (longest >= minRun || grid);
    };
    ChatWidget.hideMessage = function (config, login, text) {
        if (config.hideBotMessages && (config.botLogins || []).includes(login.toLowerCase())) {
            return true;
        }
        const content =
            text.startsWith('\x01ACTION ') && text.endsWith('\x01') ? text.slice(8, -1) : text;
        if (config.hideCommands) {
            const trimmed = content.trimStart();
            const prefixes = String(config.commandPrefixes ?? '!').split(',');
            if (prefixes.some((prefix) => prefix.trim() && trimmed.startsWith(prefix.trim()))) {
                return true;
            }
        }
        return ChatWidget.isLargeCharacterArt(content, config.characterArtFilter);
    };
    const cheerTiers = [
        {
            min: 10000,
            color: '#f43021'
        },
        {
            min: 5000,
            color: '#0099fe'
        },
        {
            min: 1000,
            color: '#1db2a5'
        },
        {
            min: 100,
            color: '#9c3ee8'
        },
        {
            min: 1,
            color: '#979797'
        }
    ];
    ChatWidget.cheerToken = function (token, remainingBits) {
        const match = /^cheer([1-9]\d*)$/i.exec(token);
        if (!match) {
            return null;
        }
        const amount = Number(match[1]);
        if (
            !Number.isSafeInteger(amount) ||
            !Number.isSafeInteger(remainingBits) ||
            amount > remainingBits
        ) {
            return null;
        }
        const tier = cheerTiers.find((candidateTier) => amount >= candidateTier.min);
        return {
            amount,
            color: tier.color,
            src: `https://d3aqoihi2n8ty8.cloudfront.net/actions/cheer/dark/animated/${tier.min}/2.gif`
        };
    };
    ChatWidget.clamp = (value, minimum, maximum, fallback = minimum) =>
        Number.isFinite(Number(value))
            ? Math.min(maximum, Math.max(minimum, Number(value)))
            : fallback;
    ChatWidget.unescapeTag = (value) =>
        value.replace(
            /\\(.)/g,
            (match, escapedCharacter) =>
                ({
                    s: ' ',
                    ':': ';',
                    '\\': '\\',
                    r: '\r',
                    n: '\n'
                })[escapedCharacter] ?? escapedCharacter
        );
    ChatWidget.parseIRC = function (line) {
        let rest = line;
        let tags = {};
        let prefix = '';
        if (rest[0] === '@') {
            const end = rest.indexOf(' ');
            if (end < 0) {
                return null;
            }
            for (const tag of rest.slice(1, end).split(';')) {
                const tagSeparatorIndex = tag.indexOf('=');
                tags[tagSeparatorIndex < 0 ? tag : tag.slice(0, tagSeparatorIndex)] =
                    tagSeparatorIndex < 0
                        ? ''
                        : ChatWidget.unescapeTag(tag.slice(tagSeparatorIndex + 1));
            }
            rest = rest.slice(end + 1);
        }
        if (rest[0] === ':') {
            const end = rest.indexOf(' ');
            if (end < 0) {
                return null;
            }
            prefix = rest.slice(1, end);
            rest = rest.slice(end + 1);
        }
        const separatorIndex = rest.indexOf(' :');
        const head = separatorIndex < 0 ? rest : rest.slice(0, separatorIndex);
        const params = head.trim().split(/ +/);
        const command = params.shift();
        if (separatorIndex >= 0) {
            params.push(rest.slice(separatorIndex + 2));
        }
        return command
            ? {
                  tags,
                  prefix,
                  command,
                  params
              }
            : null;
    };
    ChatWidget.IRCStream = class {
        constructor(onLine) {
            this.buffer = '';
            this.onLine = onLine;
        }
        push(data) {
            this.buffer += data;
            if (this.buffer.length > 1048576) {
                throw Error('IRC frame is too large');
            }
            let lineEndIndex;
            while ((lineEndIndex = this.buffer.indexOf('\r\n')) >= 0) {
                const line = this.buffer.slice(0, lineEndIndex);
                this.buffer = this.buffer.slice(lineEndIndex + 2);
                const message = ChatWidget.parseIRC(line);
                if (message) {
                    this.onLine(message);
                }
            }
        }
    };
    // Twitch emote ranges are inclusive code-point offsets, not UTF-16 offsets.
    ChatWidget.nativeParts = function (text, tag, gifs = '') {
        const chars = Array.from(text);
        const ranges = [];
        // Preserve Twitch's complete media URL, including its query parameters.
        for (const entry of gifs.split(',')) {
            const match = entry.match(/^(\d+)-(\d+)\|([a-zA-Z0-9_-]+)\|(https:\/\/.+)$/i);
            if (!match) continue;
            const [, start, end, , src] = match;
            if (
                Number(start) > Number(end) ||
                Number(end) >= chars.length ||
                !ChatWidget.safeURL(src, [
                    'media.giphy.com',
                    'media0.giphy.com',
                    'media1.giphy.com',
                    'media2.giphy.com',
                    'media3.giphy.com',
                    'media4.giphy.com',
                    'i.giphy.com'
                ])
            )
                continue;
            ranges.push({ start: Number(start), end: Number(end), gif: src });
        }
        for (const entry of (tag || '').split('/')) {
            const [id, positions] = entry.split(':');
            if (!/^[a-zA-Z0-9_-]+$/.test(id) || !positions) {
                continue;
            }
            for (const rangeText of positions.split(',')) {
                if (!/^\d+-\d+$/.test(rangeText)) {
                    continue;
                }
                const [startIndex, endIndex] = rangeText.split('-').map(Number);
                if (startIndex <= endIndex && endIndex < chars.length) {
                    ranges.push({
                        start: startIndex,
                        end: endIndex,
                        id
                    });
                }
            }
        }
        ranges.sort((firstRange, secondRange) => firstRange.start - secondRange.start);
        const parts = [];
        let cursor = 0;
        for (const range of ranges) {
            if (range.start < cursor) {
                continue;
            }
            if (range.start > cursor) {
                parts.push({
                    text: chars.slice(cursor, range.start).join('')
                });
            }
            parts.push({
                text: chars.slice(range.start, range.end + 1).join(''),
                ...(range.gif ? { gif: range.gif } : { id: range.id })
            });
            cursor = range.end + 1;
        }
        if (cursor < chars.length) {
            parts.push({
                text: chars.slice(cursor).join('')
            });
        }
        return parts;
    };
    ChatWidget.twitchLink = function (value, currentChannel = '') {
        try {
            const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
            if (
                !['http:', 'https:'].includes(url.protocol) ||
                url.username ||
                url.password ||
                url.port
            )
                return null;
            const host = url.hostname.toLowerCase();
            const path = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
            const channelName = (value) =>
                /^[a-z0-9_]{1,25}$/i.test(value || '') ? value.toLowerCase() : '';
            const channel = (name) => ({ type: 'channel', channel: channelName(name) });
            const clip = (name = '') => ({
                type: 'clip',
                channel: channelName(name),
                current: !!channelName(name) && channelName(name) === currentChannel.toLowerCase()
            });
            if (host === 'clips.twitch.tv') {
                return path.length === 1 && /^[a-z0-9_-]+$/i.test(path[0])
                    ? clip()
                    : path[0] === 'embed' && url.searchParams.get('clip')
                      ? clip()
                      : null;
            }
            if (host === 'player.twitch.tv') {
                if (/^v?\d+$/.test(url.searchParams.get('video') || '')) return { type: 'video' };
                const name = channelName(url.searchParams.get('channel'));
                return name ? channel(name) : null;
            }
            if (!['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'].includes(host)) return null;
            if (!path.length) return { type: 'home' };
            if (path[0] === 'videos' && path.length === 2 && /^\d+$/.test(path[1]))
                return { type: 'video' };
            if (path[0] === 'directory') return { type: 'directory' };
            const reserved = [
                'videos',
                'downloads',
                'settings',
                'subscriptions',
                'inventory',
                'wallet',
                'search',
                'friends',
                'messages',
                'login',
                'signup',
                'jobs',
                'turbo',
                'products',
                'payments',
                'activate',
                'drops',
                'store',
                'p',
                'popout',
                'embed',
                'moderator'
            ];
            const name = channelName(path[0]);
            if (!name || reserved.includes(name)) return { type: 'home' };
            if (path.length === 3 && path[1] === 'clip' && /^[a-z0-9_-]+$/i.test(path[2]))
                return clip(name);
            if (path.length === 2 && path[1] === 'clips') return { type: 'clips', channel: name };
            if (
                path.length === 1 ||
                (path.length === 2 && ['videos', 'about', 'schedule'].includes(path[1]))
            )
                return channel(name);
            return { type: 'home' };
        } catch {
            return null;
        }
    };
    ChatWidget.linkParts = function (text) {
        const parts = [];
        const pattern =
            /(^|[\s([{])((?:https?:\/\/|www\.)[^\s<>"']+|(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+[\p{L}\p{N}-]{2,63}(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}_-])(?::\d{1,5})?(?![\p{L}\p{N}_@-]|:\S)(?:[/?#][^\s<>"']*)?)/giu;
        let cursor = 0;
        for (const match of text.matchAll(pattern)) {
            const start = match.index + match[1].length;
            let value = match[2].replace(/[.,!?;:]+$/, '');
            for (const [open, close] of [
                ['(', ')'],
                ['[', ']'],
                ['{', '}']
            ]) {
                while (
                    value.endsWith(close) &&
                    value.split(close).length > value.split(open).length
                ) {
                    value = value.slice(0, -1);
                }
            }
            try {
                const url = new URL(/^https?:\/\//i.test(value) ? value : 'https://' + value);
                const host = url.hostname.toLowerCase();
                const labels = host.split('.');
                if (
                    !['http:', 'https:'].includes(url.protocol) ||
                    url.username ||
                    url.password ||
                    host.length > 253 ||
                    labels.length < 2 ||
                    labels.some(
                        (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)
                    ) ||
                    !ChatWidget.domainTlds.has(labels[labels.length - 1]) ||
                    /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test|onion)$/.test(host)
                )
                    continue;
                if (start > cursor) parts.push({ text: text.slice(cursor, start) });
                parts.push({ text: value, domain: host.replace(/^www\./, ''), hostname: host });
                cursor = start + value.length;
            } catch {
                // Invalid URLs remain ordinary text.
            }
        }
        if (cursor < text.length) parts.push({ text: text.slice(cursor) });
        return parts;
    };
    ChatWidget.safeURL = function (value, hosts) {
        try {
            const url = new URL(value.startsWith('//') ? 'https:' + value : value);
            return url.protocol === 'https:' &&
                !url.username &&
                !url.password &&
                hosts.includes(url.hostname)
                ? url.href
                : null;
        } catch {
            return null;
        }
    };
    ChatWidget.TwitchChat = class {
        constructor(channel, onMessage, onState) {
            Object.assign(this, {
                channel,
                onMessage,
                onState,
                attempt: 0,
                stopped: false
            });
        }
        connect() {
            if (this.stopped) {
                return;
            }
            clearTimeout(this.retry);
            this.dispose();
            this.onState(this.attempt ? 'reconnecting' : 'connecting');
            const socket = (this.ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443'));
            let joined = false;
            const send = (command) => {
                if (socket.readyState === 1) {
                    socket.send(command + '\r\n');
                }
            };
            const stream = new ChatWidget.IRCStream((message) => {
                this.lastActivity = Date.now();
                if (message.command === 'PING') {
                    return send('PONG :' + message.params[message.params.length - 1]);
                }
                if (message.command === 'RECONNECT') {
                    return socket.close();
                }
                if (message.command === '001' && !joined) {
                    joined = true;
                    send('JOIN #' + this.channel);
                }
                if (message.command === 'ROOMSTATE' || message.command === '366') {
                    clearTimeout(this.handshake);
                    this.attempt = 0;
                    this.onState('connected');
                }
                if (message.command === 'NOTICE') {
                    this.onState('error', message.params[message.params.length - 1]);
                }
                this.onMessage(message);
            });
            socket.onopen = () => {
                this.lastActivity = Date.now();
                send('CAP REQ :twitch.tv/tags twitch.tv/commands');
                send('PASS SCHMOOPIIE');
                send('NICK justinfan' + Math.floor(10000 + Math.random() * 9999999));
            };
            socket.onmessage = (event) => {
                try {
                    stream.push(String(event.data));
                } catch {
                    socket.close();
                }
            };
            socket.onerror = () =>
                this.onState('error', 'WebSocket failed; check the connection and anonymous IRC');
            socket.onclose = () => {
                this.dispose();
                if (this.stopped) {
                    return;
                }
                this.onState('disconnected');
                const delay =
                    Math.min(30000, 1000 * 2 ** Math.min(this.attempt++, 5)) *
                    (0.8 + Math.random() * 0.4);
                this.retry = setTimeout(() => this.connect(), delay);
            };
            this.handshake = setTimeout(() => {
                this.onState('error', 'JOIN was not confirmed within 20 seconds');
                socket.close();
            }, 20000);
            this.watchdog = setInterval(() => {
                if (Date.now() - this.lastActivity > 240000) {
                    socket.close();
                }
            }, 30000);
        }
        dispose() {
            clearTimeout(this.handshake);
            clearInterval(this.watchdog);
            if (this.ws) {
                const old = this.ws;
                old.onopen = old.onmessage = old.onerror = old.onclose = null;
                if (old.readyState < 2) {
                    old.close();
                }
                this.ws = null;
            }
        }
        stop() {
            this.stopped = true;
            clearTimeout(this.retry);
            this.dispose();
        }
    };
})(window);
