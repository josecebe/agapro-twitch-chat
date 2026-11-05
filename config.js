// Add Twitch channels to sources; enabled: false disables an entry.
// Never store credentials here.
window.CHAT_WIDGET_CONFIG = {
    // English is the default; Spanish is available with language: 'es'.
    language: 'en',
    sources: [
        {
            provider: 'twitch',
            channel: ''
        }
    ],
    maxMessages: 35,
    messageLifetimeSeconds: 0,
    messageGapPx: 10,
    messageLineHeight: 1,
    replyGapPx: 4,
    fontSizePx: 25,
    emoteSizePx: 34,
    gifMaxHeightPx: 150,
    badgeSizePx: 30,
    fontFamily: 'Aclonica',
    // Empty string uses fontFamily.
    usernameFontFamily: 'Aclonica',
    // Empty string uses fontFamily.
    textFontFamily: 'Arial Black',
    // Optional Google Fonts overrides; empty strings keep the corresponding local fonts.
    googleFont: 'Aclonica',
    usernameGoogleFont: 'Aclonica',
    textGoogleFont: '',
    // Also applies to @mentions.
    usernameBold: true,
    showLocalizedUsername: true,
    textColor: '#ffffff',
    textShadow: true,
    messageBackground: false,
    // Alpha controls opacity in both local config and the StreamElements color picker.
    messageBackgroundColor: 'rgba(0, 0, 0, 0.6)',
    showProviderIcon: false,
    providerIconSizePx: 30,
    showBadges: true,
    showSevenTVBadges: true,
    showTwitchEmotes: true,
    showTwitchGifs: false,
    showCheers: true,
    showSevenTVEmotes: true,
    showSevenTVPaints: true,
    enableAnimations: true,
    // Use "none" for immediate removal without particles.
    moderationAnimation: 'dust',
    colorMentions: true,
    showLinkLabels: true,
    // Uses DuckDuckGo's favicon service; disable to avoid these external requests.
    showLinkFavicons: true,
    // false keeps only the leading @recipient mention.
    showReplies: true,
    showReplyPreview: true,
    // Uses the first-msg=1 tag supplied by Twitch.
    highlightFirstMessages: true,
    // false keeps the label and side border without the purple background.
    firstMessageBackground: true,
    firstMessageBackgroundColor: 'rgba(151, 71, 255, 0.7)',
    // IRC only: no reward title, cost, or redemptions without a message.
    showChannelPointRedemptions: true,
    hideBotMessages: true,
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
    // Also supports stack-top.
    layout: 'stack-bottom',
    debug: false,
    demo: false
};
