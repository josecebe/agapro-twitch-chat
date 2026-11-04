(function (ChatWidget) {
    'use strict';

    const catalogs = new Map();
    const fallbackLanguage = 'en';
    const languageCode = (language) =>
        String(language || '')
            .trim()
            .toLowerCase()
            .split(/[-_]/)[0];
    const placeholders = (text) =>
        [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
    const normalizeLanguage = (language) => {
        const code = languageCode(language);
        return catalogs.has(code) ? code : fallbackLanguage;
    };

    ChatWidget.i18n = Object.freeze({
        register(language, messages) {
            if (!/^[a-z]{2,3}$/.test(language) || catalogs.has(language)) {
                throw Error('Invalid or duplicate locale: ' + language);
            }
            if (
                !messages ||
                typeof messages !== 'object' ||
                Array.isArray(messages) ||
                !Object.entries(messages).every(
                    ([key, value]) => /^[a-z][a-zA-Z0-9]*$/.test(key) && typeof value === 'string'
                )
            ) {
                throw Error('Invalid translation catalog: ' + language);
            }
            catalogs.set(language, Object.freeze({ ...messages }));
        },
        normalizeLanguage,
        translate(language, key, values = {}) {
            const catalog = catalogs.get(normalizeLanguage(language));
            const fallback = catalogs.get(fallbackLanguage);
            const template =
                catalog && Object.hasOwn(catalog, key)
                    ? catalog[key]
                    : fallback && Object.hasOwn(fallback, key)
                      ? fallback[key]
                      : key;
            return template.replace(/\{(\w+)\}/g, (match, name) =>
                Object.hasOwn(values, name) ? String(values[name]) : match
            );
        },
        validate() {
            const fallback = catalogs.get(fallbackLanguage);
            if (!fallback) {
                throw Error('Missing fallback locale: ' + fallbackLanguage);
            }
            const keys = Object.keys(fallback).sort();
            for (const [language, messages] of catalogs) {
                if (JSON.stringify(Object.keys(messages).sort()) !== JSON.stringify(keys)) {
                    throw Error('Translation keys do not match: ' + language);
                }
                for (const key of keys) {
                    if (
                        JSON.stringify(placeholders(messages[key])) !==
                        JSON.stringify(placeholders(fallback[key]))
                    ) {
                        throw Error(
                            'Translation placeholders do not match: ' + language + '.' + key
                        );
                    }
                }
            }
        }
    });
})(window.ChatWidget);
