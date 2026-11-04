import { readFileSync } from 'node:fs';

export function readWidgetScripts(modules = []) {
    return ['core', 'domain-tlds', 'i18n', 'locales/en', 'locales/es', 'diagnostics', ...modules]
        .map((name) => readFileSync(new URL('../../src/' + name + '.js', import.meta.url), 'utf8'))
        .join('\n');
}
