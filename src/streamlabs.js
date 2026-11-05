(function (ChatWidget) {
    'use strict';

    ChatWidget.attachStreamlabs = function (config) {
        let stopped = false;
        const start = () => {
            if (stopped) return;
            try {
                ChatWidget.start(config, {
                    emptySourcesMessage: ChatWidget.i18n.translate(
                        config.language,
                        'streamlabsChannelRequired'
                    ),
                    onStatus(status, panel, diagnosticsEnabled) {
                        if (diagnosticsEnabled) return;
                        const failures = [...status].filter(
                            ([key, value]) =>
                                key === 'configuration' ||
                                (key.endsWith(' · connection') && value.startsWith('error'))
                        );
                        panel.hidden = failures.length === 0;
                        if (failures.length) {
                            panel.textContent = failures
                                .map(([key, value]) =>
                                    ChatWidget.diagnostics.formatStatus(config.language, key, value)
                                )
                                .join('\n');
                        }
                    }
                });
            } catch (error) {
                const panel = document.getElementById('diagnostics');
                if (panel) {
                    panel.hidden = false;
                    panel.textContent = ChatWidget.i18n.translate(config.language, 'startFailed', {
                        error: error.message
                    });
                }
            }
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', start, { once: true });
        } else {
            start();
        }
        return () => {
            stopped = true;
            document.removeEventListener('DOMContentLoaded', start);
            window.CHAT_WIDGET_RUNTIME?.stop?.();
        };
    };
})(window.ChatWidget);
