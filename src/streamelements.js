(function (ChatWidget) {
    'use strict';

    function fieldValue(value, fallback) {
        if (value === undefined || value === null) {
            return fallback;
        }
        if (typeof fallback === 'boolean') {
            if (value === true || value === 'true' || value === 1) {
                return true;
            }
            if (value === false || value === 'false' || value === 0) {
                return false;
            }
            return fallback;
        }
        if (typeof fallback === 'number') {
            const number = Number(value);
            return Number.isFinite(number) ? number : fallback;
        }
        if (Array.isArray(fallback)) {
            const entries = Array.isArray(value) ? value : String(value).split(/[,;\s]+/);
            return entries.map((entry) => String(entry).trim()).filter(Boolean);
        }
        return String(value);
    }

    function readFields(defaults, fields, prefix = '') {
        const config = {};
        for (const [key, fallback] of Object.entries(defaults)) {
            if (key === 'sources') {
                continue;
            }
            const field = prefix ? prefix + key[0].toUpperCase() + key.slice(1) : key;
            if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
                config[key] = readFields(fallback, fields, field);
            } else {
                config[key] = fieldValue(fields[field], fallback);
            }
        }
        return config;
    }

    ChatWidget.streamElementsConfig = function (defaults, detail = {}) {
        const fields = detail.fieldData || {};
        const config = readFields(defaults, fields);
        if (fields.channelMode === 'custom') {
            const channels = String(fields.customChannels || '').split(/[,;\s]+/);
            config.sources = channels
                .filter(Boolean)
                .map((channel) => ({ provider: 'twitch', channel }));
        } else {
            // Only copy public channel identifiers; never retain the overlay API token.
            const channel = detail.channel || {};
            const login = [channel.username, channel.login, channel.name].find(
                (name) => typeof name === 'string' && /^[a-z0-9_]{1,25}$/i.test(name)
            );
            const id = [channel.providerId, channel.twitchId, channel.userId, channel.id]
                .map((value) => String(value || ''))
                .find((value) => /^\d+$/.test(value));
            config.sources = login
                ? [{ provider: 'twitch', channel: login, channelId: id || '' }]
                : [];
        }
        return config;
    };

    ChatWidget.attachStreamElements = function (defaults) {
        const waiting = document.getElementById('diagnostics');
        if (waiting) {
            waiting.textContent = ChatWidget.i18n.translate(
                defaults.language,
                'waitingForStreamElements'
            );
        }
        const load = (event) => {
            const config = ChatWidget.streamElementsConfig(defaults, event.detail);
            const t = (key, values) => ChatWidget.i18n.translate(config.language, key, values);
            try {
                ChatWidget.start(config, {
                    onStatus(status, panel, diagnosticsEnabled) {
                        if (diagnosticsEnabled) {
                            return;
                        }
                        const connections = [...status].filter(([key]) =>
                            key.endsWith(' · connection')
                        );
                        const failures = connections.filter(([, value]) =>
                            value.startsWith('error')
                        );
                        if (status.has('configuration')) {
                            failures.push(['configuration', status.get('configuration')]);
                        }
                        panel.hidden = failures.length === 0;
                        if (failures.length) {
                            panel.textContent = failures
                                .map(([key, value]) =>
                                    ChatWidget.diagnostics.formatStatus(config.language, key, value)
                                )
                                .join('\n');
                        }
                    },
                    emptySourcesMessage:
                        event.detail?.fieldData?.channelMode === 'custom'
                            ? t('customChannelRequired')
                            : t('overlayChannelMissing')
                });
            } catch (error) {
                const panel = document.getElementById('diagnostics');
                if (panel) {
                    panel.hidden = false;
                    panel.textContent = t('startFailed', { error: error.message });
                }
            }
        };
        // Use native IRC in both channel modes to preserve Shared Chat metadata.
        window.addEventListener('onWidgetLoad', load);
        return () => {
            window.removeEventListener('onWidgetLoad', load);
            window.CHAT_WIDGET_RUNTIME?.stop?.();
        };
    };
})(window.ChatWidget);
