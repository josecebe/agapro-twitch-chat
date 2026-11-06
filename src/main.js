(function (ChatWidget) {
    'use strict';

    ChatWidget.start = function (input = {}, options = {}) {
        window.CHAT_WIDGET_RUNTIME?.stop?.();
        const query = new URLSearchParams(location.search);
        const normalized = ChatWidget.normalizeSources(input.sources);
        const template = ChatWidget.templates.get(input.template).id;
        const config = {
            ...input,
            template,
            language: ChatWidget.i18n.normalizeLanguage(input.language),
            sources: normalized.sources,
            maxMessages: Math.round(ChatWidget.clamp(input.maxMessages, 1, 200, 35)),
            messageLifetimeSeconds: ChatWidget.clamp(input.messageLifetimeSeconds, 0, 86400),
            botLogins: (input.botLogins || []).map((botLogin) => String(botLogin).toLowerCase())
        };
        const t = (key, values) => ChatWidget.i18n.translate(config.language, key, values);
        document.documentElement.lang = config.language;
        document.title = t('pageTitle');
        const debug = config.debug || query.get('debug') === '1';
        const demo = config.demo || query.get('demo') === '1';
        const panel = document.getElementById('diagnostics');
        const status = new Map();
        const report = (key, value) => {
            status.set(key, value);
            panel.textContent = [
                t(demo ? 'demoHeader' : 'liveHeader'),
                ...Array.from(status, ([statusKey, statusValue]) =>
                    ChatWidget.diagnostics.formatStatus(config.language, statusKey, statusValue)
                )
            ].join('\n');
            if (debug) {
                console?.debug?.('[chat]', key, value);
            }
            options.onStatus?.(status, panel, debug || demo);
        };
        panel.hidden = !(debug || demo);
        report(
            'character art filter',
            config.characterArtFilter?.enabled === true
                ? 'enabled · rows separated by line breaks or spaces'
                : 'disabled'
        );
        report(
            'Channel Points',
            config.showChannelPointRedemptions === false ? t('pointsHidden') : t('pointsLimited')
        );
        const root = document.getElementById('chat');
        root.setAttribute?.('data-template', template);
        root.setAttribute?.('aria-label', t('liveChat'));
        root.replaceChildren?.();
        root.classList.toggle('top', config.layout === 'stack-top');
        document.body.classList.toggle('animated', !!config.enableAnimations);
        document.documentElement.style.setProperty(
            '--username-weight',
            config.usernameBold === true ? '700' : '400'
        );
        document.body.classList.toggle('shadow', !!config.textShadow);
        const background = ChatWidget.resolveColor(
            config.messageBackgroundColor,
            config.messageBackgroundOpacity === undefined ? 'rgba(0,0,0,0.3)' : '#000000',
            config.messageBackgroundOpacity === undefined
                ? 1
                : ChatWidget.clamp(config.messageBackgroundOpacity, 0, 1, 0.3)
        );
        document.documentElement.style.setProperty('--message-background', background.css);
        document.body.classList.toggle(
            'message-background',
            config.messageBackground === true && background.alpha > 0
        );
        document.documentElement.style.setProperty(
            '--first-message-background',
            ChatWidget.resolveColor(config.firstMessageBackgroundColor, 'rgba(151,71,255,0.55)').css
        );
        const fonts = {
            general: config.fontFamily || 'Arial, sans-serif',
            username: config.usernameFontFamily || config.fontFamily || 'Arial, sans-serif',
            text: config.textFontFamily || config.fontFamily || 'Arial, sans-serif'
        };
        const googleFamilies = new Set();
        for (const [role, field] of [
            ['general', 'googleFont'],
            ['username', 'usernameGoogleFont'],
            ['text', 'textGoogleFont']
        ]) {
            const family = typeof config[field] === 'string' ? config[field].trim() : '';
            if (family) {
                fonts[role] = JSON.stringify(family) + ', sans-serif';
                googleFamilies.add(family);
            }
        }
        if (!config.usernameGoogleFont?.trim() && !config.usernameFontFamily) {
            fonts.username = fonts.general;
        }
        if (!config.textGoogleFont?.trim() && !config.textFontFamily) {
            fonts.text = fonts.general;
        }
        // Separate stylesheets keep an unavailable family from rejecting the others.
        if (document.head) {
            const current = [...document.querySelectorAll('link[data-chat-google-font]')];
            for (const link of current) {
                if (!googleFamilies.has(link.dataset.chatGoogleFont)) {
                    link.remove();
                }
            }
            for (const family of googleFamilies) {
                if (current.some((link) => link.dataset.chatGoogleFont === family)) {
                    continue;
                }
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.dataset.chatGoogleFont = family;
                link.href =
                    'https://fonts.googleapis.com/css2?family=' +
                    encodeURIComponent(family) +
                    '&display=swap';
                link.onerror = () => report('Google Fonts · ' + family, t('fontUnavailable'));
                document.head.appendChild(link);
            }
        }
        document.documentElement.style.setProperty('--username-font-family', fonts.username);
        document.documentElement.style.setProperty('--text-font-family', fonts.text);
        const lineHeightScale = ChatWidget.clamp(config.messageLineHeight, 1, 3, 1);
        // 1 = the visible letter height of the message font (tallest ascender to lowest
        // descender), so consecutive lines practically touch; 2 = twice that.
        const fontSize = ChatWidget.clamp(config.fontSizePx, 12, 100, 25);
        const applyLineHeight = () => {
            let ascent = 0;
            let descent = 0;
            try {
                const context = (applyLineHeight.canvas ||=
                    document.createElement('canvas')).getContext('2d');
                context.font = `${fontSize}px ${fonts.text}`;
                const ink = context.measureText('Hbdfklgjpqy');
                ascent = ink.actualBoundingBoxAscent || 0;
                descent = ink.actualBoundingBoxDescent || 0;
            } catch {}
            const ink = ascent + descent > 0 ? ascent + descent : fontSize;
            document.documentElement.style.setProperty(
                '--message-line-height',
                Math.round(ink * lineHeightScale * 100) / 100 + 'px'
            );
        };
        document.documentElement.style.setProperty(
            '--message-gap',
            ChatWidget.clamp(config.messageGapPx, 0, 100, 8) + 'px'
        );
        document.documentElement.style.setProperty(
            '--reply-gap',
            ChatWidget.clamp(config.replyGapPx, -100, 100, 4) + 'px'
        );
        document.documentElement.style.setProperty(
            '--provider-icon-size',
            ChatWidget.clamp(config.providerIconSizePx, 12, 64, 20) + 'px'
        );
        document.documentElement.style.setProperty(
            '--font-size',
            ChatWidget.clamp(config.fontSizePx, 12, 100, 25) + 'px'
        );
        document.documentElement.style.setProperty(
            '--emote-size',
            ChatWidget.clamp(config.emoteSizePx, 16, 160, 34) + 'px'
        );
        document.documentElement.style.setProperty(
            '--gif-max-height',
            ChatWidget.clamp(config.gifMaxHeightPx, 16, 1000, 150) + 'px'
        );
        document.documentElement.style.setProperty(
            '--badge-size',
            ChatWidget.clamp(config.badgeSizePx, 12, 80, 20) + 'px'
        );
        document.body.style.fontFamily = fonts.general;
        document.body.style.color = ChatWidget.resolveColor(config.textColor, '#ffffff').css;
        applyLineHeight();
        const fetchAssets = ChatWidget.sharedAssetFetcher();
        const sources = config.sources.map((source) => ({
            ...source,
            assets: new ChatWidget.Assets(
                (key, value) => report(source.id + ' · ' + key, value),
                fetchAssets
            )
        }));
        const assets = sources[0]?.assets || new ChatWidget.Assets(report, fetchAssets);
        const paints = new ChatWidget.Paints(report);
        const renderer = new ChatWidget.Renderer(root, config, assets, paints);
        const connections = [];
        for (const source of sources) {
            renderer.registerSource(source.id, source.assets);
        }
        const runtime = {
            status,
            sources,
            assets,
            paints,
            renderer,
            connections,
            config: config
        };
        window.CHAT_WIDGET_RUNTIME = runtime;
        const resize = () => renderer.fit();
        const fontsLoaded = () => {
            applyLineHeight();
            renderer.fit();
        };
        window.addEventListener('resize', resize);
        document.fonts?.addEventListener('loadingdone', fontsLoaded);
        let demoController;
        if (demo) {
            report('mode', t('demoNotice'));
            demoController = ChatWidget.startDemo(runtime);
        } else {
            if (normalized.errors.length) {
                panel.hidden = false;
                report('configuration', normalized.errors.join('\n'));
            }
            if (!sources.length) {
                panel.hidden = false;
                report(
                    'configuration',
                    normalized.errors
                        .concat(options.emptySourcesMessage || t('sourceRequired'))
                        .join('\n')
                );
            }
            for (const source of sources) {
                const scopedReport = (key, value) => report(source.id + ' · ' + key, value);
                const onState = (state, detail) =>
                    scopedReport('connection', state + (detail ? ' · ' + detail : ''));
                const onMessage = (incomingMessage) => {
                    const message = {
                        ...incomingMessage,
                        provider: source.provider,
                        sourceId: source.id
                    };
                    if (message.command === 'PRIVMSG') {
                        scopedReport('last message', 'Received');
                        renderer.add(message);
                    } else {
                        renderer.moderate(message);
                    }
                };
                try {
                    source.assets.start(config);
                    if (source.channelId) {
                        source.assets.setChannel(source.channelId);
                    }
                    source.connection = new ChatWidget.TwitchChat(
                        source.channel,
                        (message) => {
                            const id = message.tags['room-id'];
                            if (id) {
                                source.assets.setChannel(id);
                            }
                            onMessage(message);
                        },
                        onState
                    );
                    if (!window.CHAT_WIDGET_RUNTIME.chat) {
                        window.CHAT_WIDGET_RUNTIME.chat = source.connection;
                    }
                    connections.push(source.connection);
                    source.connection.connect();
                } catch (error) {
                    onState('error', error.message);
                }
            }
        }
        const reconnect = () => {
            for (const connection of connections) {
                connection.connect();
            }
        };
        if (!demo) {
            window.addEventListener('online', reconnect);
        }
        let stopped = false;
        runtime.stop = () => {
            if (stopped) {
                return;
            }
            stopped = true;
            runtime.stopped = true;
            demoController?.stop();
            window.removeEventListener?.('resize', resize);
            document.fonts?.removeEventListener('loadingdone', fontsLoaded);
            window.removeEventListener?.('online', reconnect);
            window.removeEventListener?.('pagehide', runtime.stop);
            for (const connection of connections) {
                connection.stop();
            }
            for (const catalog of new Set([assets, ...sources.map((source) => source.assets)])) {
                catalog.stop();
            }
            renderer.stop();
        };
        window.addEventListener('pagehide', runtime.stop, { once: true });
        return runtime;
    };
})(window.ChatWidget);
