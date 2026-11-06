import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

export const templateRoot = fileURLToPath(new URL('../src/templates/', import.meta.url));
const registryFile = path.join(templateRoot, 'registry.mjs');

export function readTemplates(root = templateRoot) {
    const templates = readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
        .map((entry) => {
            const directory = path.join(root, entry.name);
            const configFile = path.join(directory, 'config.json');
            const config = JSON.parse(readFileSync(configFile, 'utf8'));
            const keys = new Set([
                'id',
                'name',
                'order',
                'default',
                'presentation',
                'settings',
                'variables'
            ]);
            for (const key of Object.keys(config)) {
                if (!keys.has(key)) throw Error('Unknown template config key: ' + key);
            }
            if (
                !/^[a-z][a-z0-9-]*$/.test(config.id) ||
                config.id !== entry.name ||
                typeof config.name !== 'string' ||
                !config.name.trim()
            ) {
                throw Error('Invalid template configuration: ' + configFile);
            }
            if (
                (config.order !== undefined && !Number.isFinite(config.order)) ||
                (config.default !== undefined && typeof config.default !== 'boolean')
            ) {
                throw Error('Invalid template ordering/default: ' + configFile);
            }
            for (const key of ['presentation', 'settings', 'variables']) {
                const value = config[key];
                if (
                    value !== undefined &&
                    (!value || typeof value !== 'object' || Array.isArray(value))
                ) {
                    throw Error('Invalid template ' + key + ': ' + configFile);
                }
            }
            for (const [key, value] of Object.entries(config.variables || {})) {
                if (
                    !/^--[a-z0-9-]+$/.test(key) ||
                    typeof value !== 'string' ||
                    /[;{}]/.test(value)
                ) {
                    throw Error('Invalid template CSS variable: ' + configFile + ' / ' + key);
                }
            }
            for (const [key, value] of Object.entries(config.presentation || {})) {
                if (
                    !['glyphSpacing', 'paintActionText'].includes(key) ||
                    typeof value !== 'boolean'
                )
                    throw Error('Invalid presentation flags: ' + configFile);
            }
            const styleFile = path.join(directory, 'style.scss');
            if (!existsSync(styleFile)) throw Error('Missing template stylesheet: ' + styleFile);
            const presentationFile = path.join(directory, 'presentation.mjs');
            return {
                config,
                configFile,
                styleFile,
                presentationFile: existsSync(presentationFile) ? presentationFile : null
            };
        })
        .sort(
            (a, b) =>
                (a.config.order || 0) - (b.config.order || 0) ||
                a.config.id.localeCompare(b.config.id)
        );
    if (templates.filter((template) => template.config.default === true).length !== 1) {
        throw Error('The template catalog must define exactly one default template');
    }
    return templates;
}

export function templateOptions(templates = readTemplates()) {
    return Object.fromEntries(templates.map(({ config }) => [config.id, config.name]));
}

export function compileTemplates({
    templates = readTemplates(),
    namespace = 'window.ChatWidget'
} = {}) {
    const imports = [
        `import { createRegistry } from ${JSON.stringify(registryFile.replaceAll('\\', '/'))};`
    ];
    const registrations = [];
    templates.forEach(({ config, presentationFile }, index) => {
        // CSS tokens are compiled into stylesheets, not duplicated in runtime JS.
        const runtimeConfig = {
            id: config.id,
            name: config.name,
            presentation: config.presentation,
            settings: config.settings
        };
        if (presentationFile)
            imports.push(
                `import factory${index} from ${JSON.stringify(presentationFile.replaceAll('\\', '/'))};`
            );
        registrations.push(
            `{ const config = ${JSON.stringify(runtimeConfig)}; registry.register(config, ${presentationFile ? 'factory' + index + '(config)' : '{}'}); }`
        );
    });
    const defaultId = templates.find((template) => template.config.default).config.id;
    const result = buildSync({
        stdin: {
            contents:
                imports.join('\n') +
                `\nconst registry = createRegistry(${JSON.stringify(defaultId)});\n` +
                registrations.join('\n') +
                `\n${namespace}.templates = registry;`,
            resolveDir: templateRoot
        },
        bundle: true,
        write: false,
        format: 'iife',
        platform: 'browser',
        target: 'chrome100',
        legalComments: 'none',
        metafile: true
    });
    const sources = [
        ...new Set([
            ...Object.keys(result.metafile.inputs)
                .filter((file) => file !== '<stdin>')
                .map((file) => path.resolve(file)),
            ...templates.flatMap((template) => [template.configFile, template.styleFile])
        ])
    ];
    return { code: result.outputFiles[0].text, sources };
}

export async function writeTemplates(bundle = compileTemplates()) {
    await writeFile(new URL('../templates.js', import.meta.url), bundle.code);
}
