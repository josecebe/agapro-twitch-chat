import { readFileSync } from 'node:fs';
import { compileTemplates } from '../../scripts/templates.mjs';

const templates = compileTemplates().code;

export function readWidgetScripts(modules = []) {
    return [
        'core',
        'domain-tlds',
        'i18n',
        'locales/en',
        'locales/es',
        'diagnostics',
        'templates',
        ...modules
    ]
        .map((name) =>
            name === 'templates'
                ? templates
                : readFileSync(new URL('../../src/' + name + '.js', import.meta.url), 'utf8')
        )
        .join('\n');
}
