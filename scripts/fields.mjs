import { readTemplates, templateOptions } from './templates.mjs';

const specifications = {
    language: ['Chat language', 'Language'],
    template: ['Style template', 'Appearance'],
    messageBackground: ['Message background', 'Appearance'],
    messageBackgroundColor: ['Background color and opacity', 'Appearance'],
    enableAnimations: ['Enable animations', 'Appearance'],
    moderationAnimation: ['Moderation effect', 'Appearance'],
    layout: ['Message order', 'Messages'],
    maxMessages: ['Maximum messages', 'Messages', 1, 200],
    messageLifetimeSeconds: ['Message lifetime in seconds (0: never expire)', 'Messages', 0, 86400],
    messageGapPx: ['Message spacing (px)', 'Messages', 0, 100],
    fontSizePx: ['Text size', 'Typography', 12, 100],
    messageLineHeight: [
        'Message line height (1 = lines touching, 2 = double)',
        'Typography',
        1,
        3,
        0.05
    ],
    fontFamily: ['General local font', 'Typography'],
    googleFont: ['General Google Font (empty: local font)', 'Typography'],
    usernameFontFamily: ['Username local font (empty: general font)', 'Typography'],
    usernameGoogleFont: ['Username Google Font (empty: local font)', 'Typography'],
    usernameBold: ['Bold usernames and mentions', 'Typography'],
    usernameGradient: ['Gradient for normal Twitch nick colors', 'Typography'],
    showLocalizedUsername: ['Show login next to localized names', 'Typography'],
    textFontFamily: ['Message local font (empty: general font)', 'Typography'],
    textGoogleFont: ['Message Google Font (empty: local font)', 'Typography'],
    textColor: ['Text color', 'Typography'],
    textShadow: ['Text shadow', 'Typography'],
    showTwitchEmotes: ['Show Twitch emotes', 'Emotes and GIFs'],
    showSevenTVEmotes: ['Show 7TV emotes, including Shared Chat', 'Emotes and GIFs'],
    emoteSizePx: ['Emote size', 'Emotes and GIFs', 16, 160],
    showCheers: ['Show Cheers/Bits', 'Emotes and GIFs'],
    showTwitchGifs: ['Show Twitch GIFs', 'Emotes and GIFs'],
    gifMaxHeightPx: ['Maximum GIF height (px)', 'Emotes and GIFs', 16, 1000],
    showBadges: ['Show badges', 'Badges, icons and paints'],
    showSevenTVBadges: ['Show 7TV badges', 'Badges, icons and paints'],
    showSharedChatIcon: ['Shared Chat: show origin channel icon first', 'Badges, icons and paints'],
    badgeSizePx: ['Badge size', 'Badges, icons and paints', 12, 80],
    showProviderIcon: ['Show Twitch icon', 'Badges, icons and paints'],
    providerIconSizePx: ['Twitch icon size', 'Badges, icons and paints', 12, 64],
    showSevenTVPaints: ['Show equipped 7TV paints', 'Badges, icons and paints'],
    showReplies: ['Show reply header', 'Replies and notices'],
    showReplyPreview: ['Show original message preview', 'Replies and notices'],
    replyGapPx: ['Reply header spacing (px)', 'Replies and notices', -100, 100],
    colorMentions: ['Color mentions', 'Replies and notices'],
    highlightFirstMessages: ['Highlight first-time chatters', 'Replies and notices'],
    firstMessageBackground: ['First-message background', 'Replies and notices'],
    firstMessageBackgroundColor: ['First-message color and opacity', 'Replies and notices'],
    showChannelPointRedemptions: [
        'Show redemptions detected in IRC (limited mode)',
        'Replies and notices'
    ],
    showLinkLabels: ['Show domain labels for links', 'Links'],
    showLinkFavicons: ['Show favicons via DuckDuckGo', 'Links'],
    hideBotMessages: ['Hide listed bots', 'Filters'],
    botLogins: ['Bot usernames, comma-separated', 'Filters'],
    hideCommands: ['Hide messages starting with listed prefixes', 'Filters'],
    commandPrefixes: ['Message prefixes to hide, comma-separated', 'Filters'],
    characterArtFilterEnabled: ['Filter large character art', 'Filters'],
    characterArtFilterMinChars: ['Minimum art characters', 'Filters', 40, 10000],
    characterArtFilterMinDrawingRatio: ['Minimum art character ratio', 'Filters', 0.5, 1, 0.05],
    characterArtFilterMinRun: ['Minimum art run length', 'Filters', 8, 10000],
    characterArtFilterMinSimilarLines: ['Minimum similar rows', 'Filters', 3, 100],
    demo: ['Demo mode (no live chat)', 'Preview and diagnostics'],
    debug: ['Show diagnostics', 'Preview and diagnostics']
};

function flatten(defaults, prefix = '') {
    const result = {};
    for (const [key, value] of Object.entries(defaults)) {
        if (key === 'sources' || key === 'messageBackgroundOpacity') {
            continue;
        }
        const field = prefix ? prefix + key[0].toUpperCase() + key.slice(1) : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(result, flatten(value, field));
        } else {
            result[field] = value;
        }
    }
    return result;
}

export function createFields(config, { templates = readTemplates() } = {}) {
    const fields = {
        channelMode: {
            type: 'dropdown',
            label: 'Channel source',
            group: 'Channels',
            value: 'associated',
            options: {
                associated: 'Associated overlay channel',
                custom: 'Custom channels'
            }
        },
        customChannels: {
            type: 'text',
            label: 'Custom channels, comma-separated',
            group: 'Channels',
            value: (config.sources || [])
                .filter((source) => source.enabled !== false)
                .map((source) => source.channel)
                .join(', ')
        }
    };
    const data = Object.fromEntries(
        Object.entries(fields).map(([key, field]) => [key, field.value])
    );
    const values = flatten(config);
    for (const key of Object.keys(values)) {
        if (!Object.hasOwn(specifications, key)) {
            throw Error('Missing StreamElements field definition: ' + key);
        }
    }
    // Keep UI groups and controls ordered independently of user config key order.
    for (const [key, spec] of Object.entries(specifications)) {
        if (!Object.hasOwn(values, key)) continue;
        const value = values[key];
        const [label, group, min, max, step = 1] = spec;
        const field = { label, group, value, type: 'text' };
        if (typeof value === 'boolean') {
            field.type = 'dropdown';
            field.value = String(value);
            field.options = { true: 'Yes', false: 'No' };
        } else if (typeof value === 'number') {
            Object.assign(field, { type: 'number', min, max, step });
        } else if (Array.isArray(value)) {
            field.value = value.join(', ');
        } else if (key === 'template') {
            Object.assign(field, {
                type: 'dropdown',
                options: templateOptions(templates)
            });
        } else if (key === 'language') {
            Object.assign(field, { type: 'dropdown', options: { en: 'English', es: 'Spanish' } });
        } else if (['googleFont', 'usernameGoogleFont', 'textGoogleFont'].includes(key)) {
            field.type = 'googleFont';
        } else if (key.endsWith('Color')) {
            field.type = 'colorpicker';
        } else if (key === 'moderationAnimation') {
            Object.assign(field, {
                type: 'dropdown',
                options: { dust: 'Dust', none: 'None' }
            });
        } else if (key === 'layout') {
            Object.assign(field, {
                type: 'dropdown',
                options: { 'stack-bottom': 'Newest at bottom', 'stack-top': 'Newest at top' }
            });
        }
        fields[key] = field;
        data[key] = field.value;
    }
    return { fields, data };
}
