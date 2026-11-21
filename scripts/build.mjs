import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { transform } from 'esbuild';
import { minify } from 'html-minifier-terser';
import { createFields } from './fields.mjs';
import { stripIgnoredCharacters } from 'graphql';
import { compileStyles, writeStyles } from './styles.mjs';
import { readTemplates, compileTemplates, writeTemplates } from './templates.mjs';
import { hostedFiles, pruneHostedFiles, defaultHostedBaseURL } from './hosted.mjs';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const localizationFiles = ['i18n', 'locales/en', 'locales/es'];
const libraryFiles = [
    'core',
    'domain-tlds',
    ...localizationFiles,
    'diagnostics',
    'templates',
    'providers',
    'dust',
    'blood',
    'renderer',
    'demo',
    'main'
];

export async function readConfig() {
    const source = await readFile(path.join(projectRoot, 'config.js'), 'utf8');
    const context = vm.createContext({ window: {} });
    vm.runInContext(source, context, { timeout: 1000, filename: 'config.js' });
    const config = context.window.CHAT_WIDGET_CONFIG;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw Error('config.js must assign an object to window.CHAT_WIDGET_CONFIG');
    }
    return JSON.parse(JSON.stringify(config));
}

function isolate(source, file) {
    const suffix = file === 'core' ? /\}\)\(window\);\s*$/ : /\}\)\(window\.ChatWidget\);\s*$/;
    if (!suffix.test(source)) {
        throw Error('Unsupported module wrapper: src/' + file + '.js');
    }
    return source.replace(suffix, file === 'core' ? '})(namespace);' : '})(namespace.ChatWidget);');
}

async function javascript(library, entry) {
    const result = await transform(`const namespace = {};\n${library}\n${entry}`, {
        loader: 'js',
        format: 'iife',
        target: 'chrome100',
        minify: true,
        legalComments: 'none',
        charset: 'utf8'
    });
    return result.code.trim();
}

const htmlOptions = {
    collapseWhitespace: true,
    removeComments: true,
    removeAttributeQuotes: true,
    minifyCSS: false,
    minifyJS: false
};

export async function buildProject({
    outputDirectory = path.join(projectRoot, 'dist'),
    developmentCSS = false,
    hostedBaseURL = defaultHostedBaseURL
} = {}) {
    const outdir = path.resolve(outputDirectory);
    const protectedDirectories = ['src', 'scripts', 'tests', '.github'].map((name) =>
        path.join(projectRoot, name)
    );
    if (
        outdir === projectRoot ||
        path
            .relative(projectRoot, outdir)
            .split(path.sep)
            .some((name) => name.startsWith('_')) ||
        protectedDirectories.some(
            (directory) => outdir === directory || outdir.startsWith(directory + path.sep)
        )
    ) {
        throw Error('The build output must not overwrite project inputs');
    }
    const config = await readConfig();
    const localization = vm.createContext({ window: { ChatWidget: {} } });
    for (const name of localizationFiles) {
        vm.runInContext(
            await readFile(path.join(projectRoot, 'src', name + '.js'), 'utf8'),
            localization,
            { timeout: 1000 }
        );
    }
    localization.window.ChatWidget.i18n.validate();
    const configLiteral = JSON.stringify(config);
    const templates = readTemplates();
    const templateBundle = compileTemplates({ templates, namespace: 'namespace.ChatWidget' });
    const modules = await Promise.all(
        libraryFiles.map(async (name) => {
            if (name === 'templates') return templateBundle.code;
            let source = await readFile(path.join(projectRoot, 'src', name + '.js'), 'utf8');
            source = source.replace(/\/\* GraphQL \*\/\s*`([^`]*?)`/g, (_match, query) =>
                JSON.stringify(stripIgnoredCharacters(query))
            );
            return isolate(source, name);
        })
    );
    const library = modules.join('\n');
    const localJS = await javascript(
        library,
        'namespace.ChatWidget.start(window.CHAT_WIDGET_CONFIG || {});'
    );
    const adapters = await Promise.all(
        ['streamelements', 'streamlabs', 'hosted'].map(async (name) =>
            isolate(await readFile(path.join(projectRoot, 'src', name + '.js'), 'utf8'), name)
        )
    );
    const hostedJS = await javascript(
        library + '\n' + adapters.join('\n'),
        `namespace.ChatWidget.attachHosted(${configLiteral});`
    );
    const styles = compileStyles({ templates });
    if (developmentCSS) {
        await writeStyles(styles);
        await writeTemplates(compileTemplates({ templates }));
    }
    const css = (
        await transform(styles.css, {
            loader: 'css',
            minify: true,
            target: 'chrome100',
            legalComments: 'none'
        })
    ).code.trim();
    const document = await readFile(path.join(projectRoot, 'index.html'), 'utf8');
    const markup = document.match(/<main\b[\s\S]*?<\/main>\s*<pre\b[\s\S]*?<\/pre>/)?.[0];
    const loader = /<script\b[^>]*>[\s\S]*?<\/script>/;
    const stylesheet = /<link\b[^>]*id="widget-styles"[^>]*>/;
    if (!markup || !loader.test(document) || !stylesheet.test(document)) {
        throw Error('index.html is missing the widget markup, stylesheet, or development loader');
    }
    // Script closing tags must remain escaped even when config contains user-entered text.
    const safeJS = localJS.replace(/<\/script/gi, '<\\/script');
    const localHTML = await minify(
        document
            .replace(stylesheet, () => '<style>' + css + '</style>')
            .replace(
                loader,
                () => '<script src="config.js"></script><script>' + safeJS + '</script>'
            ),
        htmlOptions
    );
    const { fields, data } = createFields(config, { templates });
    const tabs = {
        'index.html': await minify(
            markup.replace(
                '<pre id="diagnostics" hidden></pre>',
                '<pre id="diagnostics">Waiting for StreamElements to load…</pre>'
            ),
            htmlOptions
        ),
        'fields.json': JSON.stringify(fields, null, 4) + '\n',
        'data.json': JSON.stringify(data, null, 4) + '\n'
    };
    const localConfig = await readFile(path.join(projectRoot, 'config.js'), 'utf8');
    const files = {
        'local/index.html': localHTML,
        'local/config.js': localConfig,
        ...Object.fromEntries(
            Object.entries(tabs).map(([name, content]) => ['streamelements/' + name, content])
        ),
        // Streamlabs sanitizes <pre> elements; keep diagnostics in a regular div.
        'streamlabs/index.html': await minify(
            markup.replace(
                '<pre id="diagnostics" hidden></pre>',
                '<div id="diagnostics" hidden role="status"></div>'
            ),
            htmlOptions
        )
    };
    Object.assign(
        files,
        await hostedFiles({
            // A dark color scheme can give transparent iframes an opaque canvas.
            css: css + ':root{color-scheme:normal}#diagnostics[hidden]{display:none!important}',
            js: hostedJS,
            config,
            baseURL: hostedBaseURL
        })
    );
    const manifest = {
        sources: [
            ...new Set(
                libraryFiles
                    .filter((name) => name !== 'templates')
                    .map((name) => 'src/' + name + '.js')
                    .concat(
                        templateBundle.sources.map((file) =>
                            path.relative(projectRoot, file).split(path.sep).join('/')
                        )
                    )
                    .concat(
                        'src/streamelements.js',
                        'src/hosted-loader.js',
                        'src/hosted.js',
                        'src/streamlabs.js',
                        'config.js',
                        'index.html'
                    )
                    .concat(
                        styles.loadedUrls.map((url) =>
                            path.relative(projectRoot, fileURLToPath(url)).split(path.sep).join('/')
                        )
                    )
            )
        ],
        files: Object.fromEntries(
            Object.entries(files).map(([name, content]) => [
                name,
                {
                    bytes: Buffer.byteLength(content),
                    sha256: createHash('sha256').update(content).digest('hex')
                }
            ])
        )
    };
    for (const [name, content] of Object.entries(files)) {
        const destination = path.join(outdir, name);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, content);
    }
    await pruneHostedFiles(outdir, files);
    for (const name of ['fields', 'data']) {
        await rm(path.join(outdir, 'streamelements', name), { force: true });
    }
    await writeFile(
        path.join(outdir, 'build-manifest.json'),
        JSON.stringify(manifest, null, 4) + '\n'
    );
    return { outdir, manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const { outdir, manifest } = await buildProject({
            developmentCSS: true,
            hostedBaseURL: process.env.HOSTED_BASE_URL || defaultHostedBaseURL
        });
        for (const [name, info] of Object.entries(manifest.files)) {
            console.log(`${name}: ${(info.bytes / 1024).toFixed(1)} KiB`);
        }
        console.log('Build complete: ' + outdir);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
