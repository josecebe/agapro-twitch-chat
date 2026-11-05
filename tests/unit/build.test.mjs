import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { buildProject, readConfig, projectRoot } from '../../scripts/build.mjs';
import { createFields } from '../../scripts/fields.mjs';
import { parse, print } from 'graphql';

const defaults = await readConfig();
const core = readWidgetScripts();
const adapter = await readFile(new URL('../../src/streamelements.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: { ChatWidget: {} } });
vm.runInContext(adapter, context);
const configure = (detail) =>
    JSON.parse(JSON.stringify(context.window.ChatWidget.streamElementsConfig(defaults, detail)));
const outdir = await mkdtemp(path.join(os.tmpdir(), 'chat-widget-build-'));
const temporaryDirectories = [outdir];
after(async () => {
    for (const directory of temporaryDirectories) {
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
const result = await buildProject({ outputDirectory: outdir });

test('local build embeds the application and loads a separate readable config', async () => {
    assert.equal(defaults.language, 'en');
    const html = await readFile(path.join(outdir, 'local/index.html'), 'utf8');
    assert.match(html, /lang=en/);
    assert.match(html, /aria-label="Live chat"/);
    assert.match(html, /<style>/);
    assert.match(html, /icons\.duckduckgo\.com\/ip3\/twitch\.tv\.ico/);
    assert.match(html, /<script src=config.js><\/script><script>/);
    const config = await readFile(path.join(outdir, 'local/config.js'), 'utf8');
    assert.equal(config, await readFile(path.join(projectRoot, 'config.js'), 'utf8'));
    assert.match(config, /\n {4}sources:/);
    assert.doesNotMatch(html, /channel:"baitybait"/);
    assert.doesNotMatch(html, /<link\b[^>]*stylesheet/i);
    assert.doesNotMatch(html, /assets\/providers\/twitch\.png/);
    assert.equal((html.match(/<\/script>/g) || []).length, 2);
    new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
    assert.ok(html.length < 100000);
});

test('compiled GraphQL preserves the query while removing ignored whitespace', async () => {
    const provider = await readFile(path.join(projectRoot, 'src/providers.js'), 'utf8');
    const original = provider.match(/\/\* GraphQL \*\/\s*`([^`]*?)`/)[1];
    const html = await readFile(path.join(outdir, 'local/index.html'), 'utf8');
    const query = html.match(/query EquippedCosmetics[^"`]*?TWITCH[^"`]*?(?=["`])/)[0];
    assert.equal(print(parse(query)), print(parse(original)));
    assert.doesNotMatch(query, /\n| {2}/);
});

test('StreamElements produces five tabs with JSON settings and no separate opacity field', async () => {
    assert.deepEqual((await readdir(path.join(outdir, 'streamelements'))).sort(), [
        'data.json',
        'fields.json',
        'index.html',
        'index.js',
        'style.css'
    ]);
    const fields = JSON.parse(
        await readFile(path.join(outdir, 'streamelements/fields.json'), 'utf8')
    );
    const data = JSON.parse(await readFile(path.join(outdir, 'streamelements/data.json'), 'utf8'));
    assert.equal(Object.hasOwn(fields, 'messageBackgroundOpacity'), false);
    assert.equal(Object.hasOwn(data, 'messageBackgroundOpacity'), false);
    assert.equal(fields.firstMessageBackgroundColor.type, 'colorpicker');
    assert.equal(data.messageBackgroundColor, defaults.messageBackgroundColor);
    assert.equal(fields.channelMode.value, 'associated');
    assert.equal(fields.language.type, 'dropdown');
    assert.deepEqual(fields.language.options, { en: 'English', es: 'Spanish' });
    assert.equal(fields.language.value, 'en');
    assert.equal(data.language, 'en');
    assert.equal(data.language, defaults.language);
    for (const name of ['googleFont', 'usernameGoogleFont', 'textGoogleFont']) {
        assert.equal(fields[name].type, 'googleFont');
        assert.equal(data[name], defaults[name]);
    }
    for (const [name, field] of Object.entries(fields)) {
        assert.equal(data[name], field.value, name);
    }
});

test('Streamlabs produces three tabs and boots independently of StreamElements events', async () => {
    assert.deepEqual((await readdir(path.join(outdir, 'streamlabs'))).sort(), [
        'index.html',
        'index.js',
        'style.css'
    ]);
    const html = await readFile(path.join(outdir, 'streamlabs/index.html'), 'utf8');
    assert.match(html, /id=chat/);
    assert.match(html, /<div[^>]*id=diagnostics/);
    assert.doesNotMatch(html, /<pre/);
    assert.doesNotMatch(html, /Waiting for StreamElements|<script|<link/);
    assert.equal(
        await readFile(path.join(outdir, 'streamlabs/style.css'), 'utf8'),
        await readFile(path.join(outdir, 'streamelements/style.css'), 'utf8')
    );
    const js = await readFile(path.join(outdir, 'streamlabs/index.js'), 'utf8');
    const config = JSON.parse(js.match(/const config = ([\s\S]*?);\n/)[1]);
    assert.deepEqual(config, defaults);
    assert.doesNotMatch(js, /streamlabs-platform|Streamlabs\.init|channelMode/);
    const listeners = new Map();
    const sandbox = vm.createContext({
        document: {
            readyState: 'loading',
            addEventListener: (name, callback) => listeners.set(name, callback)
        },
        window: {}
    });
    vm.runInContext(js, sandbox);
    assert.equal(typeof listeners.get('DOMContentLoaded'), 'function');
    assert.equal(sandbox.window.ChatWidget, undefined);
    assert.equal(sandbox.window.CHAT_WIDGET_RUNTIME, undefined);
    assert.doesNotMatch(js, /onWidgetLoad|onEventReceived/);
});

test('compiled namespace is encapsulated and StreamElements waits for onWidgetLoad', async () => {
    const listeners = new Map();
    const sandbox = vm.createContext({
        document: { getElementById: () => null },
        window: {
            addEventListener: (name, callback) => listeners.set(name, callback)
        }
    });
    vm.runInContext(await readFile(path.join(outdir, 'streamelements/index.js'), 'utf8'), sandbox);
    assert.equal(sandbox.window.ChatWidget, undefined);
    assert.equal(sandbox.window.CHAT_WIDGET_RUNTIME, undefined);
    assert.equal(typeof listeners.get('onWidgetLoad'), 'function');
    assert.equal(listeners.has('onEventReceived'), false);
});

test('associated channel uses public overlay metadata without retaining its API token', () => {
    const config = configure({
        channel: {
            username: 'Overlay_User',
            id: 'not-a-twitch-id',
            providerId: '12345',
            apiToken: 'PRIVATE_TOKEN'
        }
    });
    assert.deepEqual(config.sources, [
        { provider: 'twitch', channel: 'Overlay_User', channelId: '12345' }
    ]);
    assert.ok(!JSON.stringify(config).includes('PRIVATE_TOKEN'));
    assert.equal(
        config.sources.some((source) => source.channel === defaults.sources[0]?.channel),
        false
    );
});

test('StreamElements exposes connection errors and clears them after reconnecting', () => {
    let load;
    let options;
    const sandbox = vm.createContext({
        document: { getElementById: () => null },
        window: {
            ChatWidget: {
                start: (_config, value) => {
                    options = value;
                }
            },
            addEventListener: (_event, callback) => {
                load = callback;
            }
        }
    });
    const start = sandbox.window.ChatWidget.start;
    vm.runInContext(core, sandbox);
    sandbox.window.ChatWidget.start = start;
    vm.runInContext(adapter, sandbox);
    sandbox.window.ChatWidget.attachStreamElements(defaults);
    load({ detail: { channel: { username: 'channel' } } });
    const panel = { hidden: true, textContent: '' };
    const status = new Map([['twitch:channel · connection', 'error · WebSocket bloqueado']]);
    options.onStatus(status, panel, false);
    assert.equal(panel.hidden, false);
    assert.match(panel.textContent, /WebSocket bloqueado/);
    status.set('twitch:channel · connection', 'connected');
    options.onStatus(status, panel, false);
    assert.equal(panel.hidden, true);
    panel.hidden = false;
    options.onStatus(status, panel, true);
    assert.equal(panel.hidden, false);
    status.set('configuration', 'Falta el canal del overlay');
    options.onStatus(status, panel, false);
    assert.equal(panel.hidden, false);
    assert.match(panel.textContent, /Falta el canal/);
});

test('custom mode ignores the overlay channel and preserves multiple Twitch channels', () => {
    const config = configure({
        channel: { username: 'ignored' },
        fieldData: { channelMode: 'custom', customChannels: '@alpha, #beta\ngamma' }
    });
    assert.deepEqual(
        config.sources.map((source) => source.channel),
        ['@alpha', '#beta', 'gamma']
    );
    assert.deepEqual(
        configure({ fieldData: { channelMode: 'custom', customChannels: '' } }).sources,
        []
    );
    assert.deepEqual(configure({ channel: { id: 'abc' } }).sources, []);
});

test('Fields/Data parse string booleans, numbers, bot lists, and nested filter settings', () => {
    const config = configure({
        channel: { username: 'channel' },
        fieldData: {
            showReplies: 'false',
            showTwitchGifs: 'false',
            showLocalizedUsername: 'false',
            gifMaxHeightPx: '220',
            textShadow: 'true',
            maxMessages: '18',
            fontSizePx: 'bad',
            botLogins: 'nightbot, bot_two\nBotThree',
            commandPrefixes: '!, /, $, hola',
            characterArtFilterEnabled: 'false',
            characterArtFilterMinChars: '300',
            usernameGoogleFont: 'Press Start 2P',
            textGoogleFont: 'Roboto',
            language: 'en'
        }
    });
    assert.equal(config.showReplies, false);
    assert.equal(config.showTwitchGifs, false);
    assert.equal(config.showLocalizedUsername, false);
    assert.equal(config.gifMaxHeightPx, 220);
    assert.equal(config.language, 'en');
    assert.equal(config.textShadow, true);
    assert.equal(config.usernameGoogleFont, 'Press Start 2P');
    assert.equal(config.textGoogleFont, 'Roboto');
    assert.equal(config.maxMessages, 18);
    assert.equal(config.fontSizePx, defaults.fontSizePx);
    assert.deepEqual(config.botLogins, ['nightbot', 'bot_two', 'BotThree']);
    assert.equal(config.commandPrefixes, '!, /, $, hola');
    assert.equal(createFields(defaults).fields.commandPrefixes.type, 'text');
    assert.equal(configure({ fieldData: {} }).commandPrefixes, '!');
    assert.equal(config.characterArtFilter.enabled, false);
    assert.equal(config.characterArtFilter.minChars, 300);
    assert.equal(createFields(defaults).fields.characterArtFilterMinChars.type, 'number');
});

test('build manifest verifies every artifact and includes only application sources', async () => {
    for (const source of [
        'src/i18n.js',
        'src/locales/es.js',
        'src/locales/en.js',
        'src/diagnostics.js',
        'src/styles.scss'
    ]) {
        assert.ok(result.manifest.sources.includes(source), source);
    }
    assert.ok(
        result.manifest.sources.every(
            (name) => name.startsWith('src/') || ['config.js', 'index.html'].includes(name)
        )
    );
    for (const [name, info] of Object.entries(result.manifest.files)) {
        const bytes = await readFile(path.join(outdir, name));
        assert.equal(bytes.length, info.bytes);
        assert.equal(createHash('sha256').update(bytes).digest('hex'), info.sha256);
    }
    await assert.rejects(
        buildProject({ outputDirectory: path.join(projectRoot, '_scratch', 'generated') })
    );
});

test('rebuilding produces identical minified artifacts', async () => {
    const repeatDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-widget-repeat-'));
    temporaryDirectories.push(repeatDirectory);
    const another = await buildProject({
        outputDirectory: repeatDirectory
    });
    assert.deepEqual(another.manifest, result.manifest);
});
