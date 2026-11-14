// Add Twitch channels to sources; enabled: false disables an entry.
// Never store credentials here.
window.CHAT_WIDGET_CONFIG = {
    // Channels
    sources: [
        {
            provider: 'twitch',
            channel: ''
        }
    ],

    // Language
    // English is the default; Spanish is available with language: 'es'.
    language: 'en',

    // Appearance
    // Select the visual template; chat behavior is shared.
    template: 'classic',
    messageBackground: false,
    // Color and opacity are independent. Opacity also controls Berserk's texture.
    messageBackgroundColor: '#000000',
    messageBackgroundOpacity: 0.7,
    enableAnimations: true,
    // Berserk: slide the sword, badges and nickname in together.
    berserkSwordAnimation: true,
    // "blood" adds a blood burst on removal/expiry; "none" disables particles.
    moderationAnimation: 'dust',

    // Messages
    // Also supports stack-top.
    layout: 'stack-bottom',
    chatAlignment: 'left', // 'left' or 'right'
    // Maximum width of the whole chat, including padding; name headers may overflow.
    chatMaxWidthPx: 525,
    maxMessages: 35,
    messageLifetimeSeconds: 0,
    messageGapPx: 10,

    // Typography
    fontSizePx: 25,
    messageLineHeight: 1.2,
    fontFamily: 'Aclonica',
    // Optional Google Fonts overrides; empty strings keep the corresponding local fonts.
    googleFont: 'Aclonica',
    // Empty string uses fontFamily.
    usernameFontFamily: 'Aclonica',
    usernameGoogleFont: 'Aclonica',
    // Also applies to @mentions.
    usernameBold: true,
    // Lighten the top and darken the bottom of normal nick colors; 7TV paints take priority.
    usernameGradient: true,
    showLocalizedUsername: true,
    // Empty string uses fontFamily.
    textFontFamily: 'Arial Black',
    textGoogleFont: '',
    textColor: '#ffffff',
    textShadow: true,

    // Emotes and GIFs
    showTwitchEmotes: true,
    showSevenTVEmotes: true,
    // Download resolution (1–4); emoteSizePx controls the displayed size separately.
    sevenTVEmoteScale: 1,
    emoteSizePx: 34,
    showCheers: true,
    showTwitchGifs: false,
    gifMaxHeightPx: 150,

    // Badges, icons and paints
    showBadges: true,
    showSevenTVBadges: true,
    // In Shared Chat, show the origin channel's avatar first among the badges.
    showSharedChatIcon: true,
    badgeSizePx: 30,
    showProviderIcon: false,
    providerIconSizePx: 30,
    showSevenTVPaints: true,

    // Replies and notices
    // false keeps only the leading @recipient mention.
    showReplies: true,
    showReplyPreview: true,
    replyGapPx: 4,
    colorMentions: true,
    // Uses the first-msg=1 tag supplied by Twitch.
    highlightFirstMessages: true,
    // false keeps the label and side border without the purple background.
    firstMessageBackground: true,
    firstMessageBackgroundColor: 'rgba(151, 71, 255, 0.7)',
    // IRC only: no reward title, cost, or redemptions without a message.
    showChannelPointRedemptions: true,

    // Links
    showLinkLabels: true,
    // Uses DuckDuckGo's favicon service; disable to avoid these external requests.
    showLinkFavicons: true,

    // Filters
    hideBotMessages: true,
    botLogins: [
        'nightbot',
        'streamelements',
        'streamlabs',
        'moobot',
        'fossabot',
        'wizebot',
        'sery_bot',
        'botrix',
        'spotchbot'
    ],
    // Also ignores leading whitespace. Prefixes are literal and comma-separated.
    hideCommands: true,
    commandPrefixes: '!',
    characterArtFilter: {
        enabled: true,
        // Counts non-whitespace characters.
        minChars: 200,
        // Braille, block, and box-drawing characters.
        minDrawingRatio: 0.8,
        minRun: 80,
        minSimilarLines: 4
    },

    // Preview and diagnostics
    demo: false,
    debug: false
};
