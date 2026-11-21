(function (ChatWidget) {
    'use strict';

    ChatWidget.attachHosted = function (defaults) {
        const script = document.currentScript;
        if (script?.dataset?.chatPlatform === 'streamlabs') {
            const settings = JSON.parse(script.dataset.chatConfig || '{}');
            ChatWidget.attachStreamlabs({ ...defaults, ...settings });
            delete script.dataset.chatConfig;
        } else {
            // Scripts inserted by older StreamElements loaders have no platform
            // attribute. Keep their existing manifest and ready-event contract.
            ChatWidget.attachStreamElements(defaults);
        }
        window.dispatchEvent(new Event('agapro:runtime-ready'));
    };
})(window.ChatWidget);
