import { createHash } from 'node:crypto';
import { readFile, readdir, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { transform } from 'esbuild';

export const defaultHostedBaseURL = 'https://josecebe.github.io/agapro-twitch-chat/';
const hash = (content) => createHash('sha256').update(content).digest('hex').slice(0, 20);

export async function pruneHostedFiles(outdir, files) {
    // Delete only generated hash-named files, never arbitrary output contents.
    // New builds otherwise accumulate every previous CSS/JS/asset version.
    for (const [folder, pattern] of [
        ['web', /^widget\.[a-f0-9]{20}\.(css|js)$/],
        ['web/assets', /^[a-f0-9]{20}\.(png|svg)$/]
    ]) {
        const directory = path.join(path.resolve(outdir), folder);
        const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
            if (error.code === 'ENOENT') return [];
            throw error;
        });
        for (const entry of entries) {
            const name = folder + '/' + entry.name;
            if (entry.isFile() && pattern.test(entry.name) && !Object.hasOwn(files, name)) {
                await rm(path.join(directory, entry.name));
            }
        }
    }
    // Retire the old duplicate export without deleting unrelated files.
    const legacyDirectory = path.join(path.resolve(outdir), 'streamelements-hosted');
    for (const name of ['index.html', 'style.css', 'index.js', 'fields.json', 'data.json']) {
        await rm(path.join(legacyDirectory, name), { force: true });
    }
    await rmdir(legacyDirectory).catch((error) => {
        if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
    });
}

export async function hostedFiles({ css, js, config, baseURL = defaultHostedBaseURL }) {
    const url = new URL(baseURL);
    if (url.protocol !== 'https:') throw Error('Hosted base URL must use HTTPS');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    const files = {};
    // Extract only our image data URLs; all other external resources stay intact.
    const externalCSS = css.replace(
        /url\((?:"([^"]*)"|'([^']*)'|([^)]*))\)/g,
        (original, double, single, bare) => {
            const data = (double ?? single ?? bare).match(
                /^data:(image\/(?:png|svg\+xml))(;base64)?,([\s\S]*)$/
            );
            if (!data) return original;
            // SVG filters use fragment IDs and must stay in the overlay's
            // document origin. Keep these tiny definitions inline.
            if (data[1] === 'image/svg+xml' && data[3].includes('#')) return original;
            const content = data[2]
                ? Buffer.from(data[3], 'base64')
                : Buffer.from(decodeURIComponent(data[3]));
            const name = 'assets/' + hash(content) + (data[1] === 'image/png' ? '.png' : '.svg');
            files['web/' + name] = content;
            return 'url("' + name + '")';
        }
    );
    const cssName = 'widget.' + hash(externalCSS) + '.css';
    const jsName = 'widget.' + hash(js) + '.js';
    files['web/' + cssName] = externalCSS;
    files['web/' + jsName] = js;
    files['web/manifest.json'] = JSON.stringify({ css: cssName, js: jsName }) + '\n';
    files['web/.nojekyll'] = '';
    files['web/index.html'] =
        '<!doctype html><meta charset="utf-8"><title>Agapro chat assets</title><p>Agapro chat: hosted StreamElements and Streamlabs resources.</p>';
    const loaderSource = await readFile(
        new URL('../src/hosted-loader.js', import.meta.url),
        'utf8'
    );
    const bootstrapCSS =
        'html,body{margin:0;background:transparent!important}#diagnostics[hidden]{display:none!important}';
    for (const platform of ['streamelements', 'streamlabs']) {
        const loader = (
            await transform(loaderSource, {
                loader: 'js',
                minify: true,
                target: 'chrome100',
                define: {
                    AGAPRO_HOSTED_BASE_URL: JSON.stringify(url.href),
                    AGAPRO_HOSTED_PLATFORM: JSON.stringify(platform),
                    AGAPRO_HOSTED_CONFIG: platform === 'streamlabs' ? 'config' : 'undefined'
                }
            })
        ).code;
        files[platform + '/style.css'] = bootstrapCSS;
        files[platform + '/index.js'] =
            platform === 'streamlabs'
                ? '(function () {\n// Edit your Twitch channels and appearance here.\nconst config = ' +
                  JSON.stringify(config, null, 4) +
                  ';\n' +
                  loader +
                  '\n})();\n'
                : loader;
    }
    return files;
}
