(function (ChatWidget) {
    'use strict';

    ChatWidget.diagnostics = {};
    const messageKeys = new Map(
        Object.entries({
            configuration: 'configuration',
            connection: 'connection',
            'character art filter': 'characterArtFilter',
            'Channel Points': 'channelPoints',
            mode: 'mode',
            'last message': 'lastMessage',
            enabled: 'enabled',
            disabled: 'disabled',
            'rows separated by line breaks or spaces': 'characterArtRows',
            Received: 'received',
            'channel badges': 'channelBadges',
            'badges channel': 'channelBadges',
            'channel 7TV': 'channelEmotes',
            '7TV channel': 'channelEmotes',
            '7TV badge': 'sevenTVBadge',
            'keeping previously loaded badges': 'keepingBadges',
            'keeping cached assets': 'keepingCache',
            'Channel has no 7TV account': 'noSevenTVAccount',
            'No paint: using the original color': 'noPaint',
            'No badge equipped': 'noBadge',
            'Equipped paint loaded': 'equippedPaint',
            'Unsupported paint: using the original color': 'unsupportedPaint',
            Equipped: 'equipped',
            'original color': 'originalColor',
            'API cooldown': 'apiCooldown',
            'Unknown badge schema': 'unknownBadgeSchema',
            'Invalid badge set': 'invalidBadgeSet',
            'Unknown emote set schema': 'unknownEmoteSetSchema',
            'GraphQL: schema or query rejected': 'graphQLRejected',
            'Unknown paint schema': 'unknownPaintSchema',
            'Unable to verify the equipped paint': 'unverifiedPaint',
            'WebSocket failed; check the connection and anonymous IRC': 'webSocketFailed',
            'JOIN was not confirmed within 20 seconds': 'joinTimedOut'
        })
    );
    ChatWidget.diagnostics.formatStatus = function (language, key, value) {
        const translate = (text) =>
            String(text)
                .split(' · ')
                .map((part) => {
                    const translated = ChatWidget.i18n.translate(
                        language,
                        messageKeys.get(part) || part
                    );
                    if (translated !== part || !part.includes(': ')) {
                        return translated;
                    }
                    const separator = part.indexOf(': ');
                    return (
                        ChatWidget.i18n.translate(
                            language,
                            messageKeys.get(part.slice(0, separator)) || part.slice(0, separator)
                        ) + part.slice(separator)
                    );
                })
                .join(' · ');
        return translate(key) + ': ' + translate(value);
    };
})(window.ChatWidget);
