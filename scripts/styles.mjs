import { writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileString } from 'sass';
import { readTemplates, compileTemplates, writeTemplates } from './templates.mjs';

export function compileStyles({ templates = readTemplates() } = {}) {
    const sheets = new Map(
        templates.map((template, index) => ['template-' + index, pathToFileURL(template.styleFile)])
    );
    const imports = [
        "@use 'styles';",
        ...templates.map(
            (template, index) =>
                '@use ' + JSON.stringify('template-' + index) + ' as template' + index + ';'
        )
    ];
    const variables = templates.map(({ config }) => {
        const selector =
            '#chat[data-template=' +
            JSON.stringify(config.id) +
            ']' +
            (config.default ? ',#chat:not([data-template])' : '');
        return (
            selector +
            '{' +
            Object.entries(config.variables || {})
                .map(([key, value]) => key + ':' + value + ';')
                .join('') +
            '}'
        );
    });
    return compileString(imports.join('\n') + '\n' + variables.join('\n'), {
        loadPaths: [fileURLToPath(new URL('../src/', import.meta.url))],
        importers: [{ findFileUrl: (url) => sheets.get(url) || null }],
        style: 'expanded',
        sourceMap: false,
        charset: false
    });
}

export async function writeStyles(result = compileStyles()) {
    await writeFile(new URL('../styles.css', import.meta.url), result.css);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const rebuild = async () => {
        const templates = readTemplates();
        await writeStyles(compileStyles({ templates }));
        await writeTemplates(compileTemplates({ templates }));
        console.log('Generated styles.css and templates.js');
    };
    await rebuild();
    if (process.argv.includes('--watch')) {
        let timer;
        const watcher = watch(new URL('../src/', import.meta.url), { recursive: true }, () => {
            clearTimeout(timer);
            timer = setTimeout(() => rebuild().catch((error) => console.error(error.message)), 100);
        });
        process.once('SIGINT', () => {
            clearTimeout(timer);
            watcher.close();
        });
    }
}
