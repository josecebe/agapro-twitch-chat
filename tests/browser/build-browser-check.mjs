import { artifactPath } from '../helpers/artifacts.mjs';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { browserSession } from '../helpers/browser-session.mjs';
import { buildProject } from '../../scripts/build.mjs';

const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-widget-browser-build-'));
const googleFonts = {
    googleFont: 'Aclonica',
    usernameGoogleFont: 'Press Start 2P',
    textGoogleFont: 'Roboto'
};
const localConfig = path.join(outputDirectory, 'local/config.js');
let browser;
let previewDirectory;
const initialization = String.raw`
window.__chatSockets = [];
window.__chatFetches = [];
window.WebSocket = class {
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        window.__chatSockets.push(this);
        setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
    }
    send(command) {
        this.sent.push(command);
        if (command.startsWith('NICK ')) {
            queueMicrotask(() => this.emit(':tmi 001 justinfan :Welcome'));
        }
        if (command.startsWith('JOIN #')) {
            this.channel = command.trim().slice(6);
            queueMicrotask(() => this.emit('@room-id=111 :tmi ROOMSTATE #' + this.channel));
        }
    }
    emit(line) { this.onmessage?.({ data: line + '\r\n' }); }
    close() { this.readyState = 3; this.onclose?.(); }
};
window.fetch = async (url, options) => {
    url = String(url);
    window.__chatFetches.push(url);
    let data = {};
    if (url.includes('api.ivr.fi')) {
        data = [];
    } else if (url.includes('/v3/users/twitch/222')) {
        data = { emote_set: { emotes: [{ id: 'origin', name: 'SOURCE', data: { host: {
            url: '//cdn.7tv.app/emote/origin', files: [{name:'2x.webp',width:64,height:64}]
        } } }] } };
    } else if (url.includes('/v3/users/twitch/')) {
        data = { emote_set: { emotes: [] } };
    } else if (url.includes('emote-sets')) {
        data = { emotes: [] };
    } else if (url.includes('/v4/gql')) {
        data = { data: { users: { userByConnection: {style:{activePaint:null,activeBadge:null}} } } };
    }
    return { ok: true, status: 200, json: async () => data, headers: new Headers() };
};
`;

async function waitFor(expression) {
    for (let index = 0; index < 400; index++) {
        if (await browser.evaluate(expression)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error('Browser condition timed out: ' + expression);
}

try {
    await buildProject({ outputDirectory });
    await writeFile(
        localConfig,
        (await readFile(localConfig, 'utf8')) +
            '\nObject.assign(window.CHAT_WIDGET_CONFIG, ' +
            JSON.stringify({
                ...googleFonts,
                language: 'en',
                gifMaxHeightPx: 110,
                sources: [{ provider: 'twitch', channel: 'test' }]
            }) +
            ');\n'
    );
    browser = await browserSession();
    await browser.send('Runtime.enable');
    await browser.send('Page.enable');
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: initialization });
    browser.on('Fetch.requestPaused', async ({ requestId, request }) => {
        if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(request.url).hostname)) {
            await browser.send('Fetch.continueRequest', { requestId });
            return;
        }
        await browser.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
            body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHe8AAAAASUVORK5CYII='
        });
    });
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
    await browser.send('Page.navigate', {
        url: pathToFileURL(path.join(outputDirectory, 'local/index.html')).href
    });
    await waitFor('!!window.CHAT_WIDGET_RUNTIME && __chatSockets.some(socket => socket.channel)');
    const local = await browser.evaluate(`(() => {
        const runtime = CHAT_WIDGET_RUNTIME;
        runtime.config.showProviderIcon = true;
        __chatSockets[0].emit('@id=compiled-message;display-name=Alice;color=#12ab34;first-msg=1;custom-reward-id=reward;reply-parent-msg-id=parent;reply-parent-user-login=bob;reply-parent-display-name=Bob;source-room-id=222;source-id=origin-message :alice!x PRIVMSG #test :SOURCE');
        return { encapsulated: !window.ChatWidget, inlineStyles: !!document.querySelector('style'),
            sources: runtime.sources.map(source => source.channel), externalScripts: document.querySelectorAll('script[src]').length };
    })()`);
    await waitFor(
        'CHAT_WIDGET_RUNTIME.renderer.rows.some(record => record.body.querySelector(".emote"))'
    );
    const shared = await browser.evaluate(`(() => {
        const record = CHAT_WIDGET_RUNTIME.renderer.rows[0];
        return { firstMessage: record.row.classList.contains('first-message'),
            providerIcon: record.row.querySelector('.provider-icon').src === 'https://icons.duckduckgo.com/ip3/twitch.tv.ico',
            sourceCatalog: CHAT_WIDGET_RUNTIME.assets.sourceChannels.has('222'),
            sourceFetch: __chatFetches.some(url => url.includes('/v3/users/twitch/222')) };
    })()`);
    assert.equal(local.encapsulated, true);
    assert.equal(local.inlineStyles, true);
    assert.equal(local.externalScripts, 1);
    assert.ok(Object.values(shared).every(Boolean), JSON.stringify(shared));
    const checkLanguage = async (language) => {
        const labels = await browser.evaluate(`(() => {
            const record = CHAT_WIDGET_RUNTIME.renderer.rows[0];
            return {
                language: document.documentElement.lang,
                ariaLabel: document.getElementById('chat').getAttribute('aria-label'),
                reply: record.reply.heading.textContent,
                first: record.row.querySelector('.first-message-label').textContent,
                reward: record.row.querySelector('.redemption-context').textContent
            };
        })()`);
        assert.deepEqual(
            labels,
            language === 'en'
                ? {
                      language: 'en',
                      ariaLabel: 'Live chat',
                      reply: '↪ replying to @Bob',
                      first: 'FIRST-TIME CHATTER',
                      reward: '◈ Redeemed a Channel Points reward'
                  }
                : {
                      language: 'es',
                      ariaLabel: 'Chat en directo',
                      reply: '↪ respuesta a @Bob',
                      first: 'PRIMER MENSAJE',
                      reward: '◈ Recompensa canjeada con puntos del canal'
                  }
        );
        return labels;
    };
    const localLanguage = await checkLanguage('en');
    const checkLocalizedUsername = async () => {
        const weights = await browser.evaluate(`(() => {
            const runtime = CHAT_WIDGET_RUNTIME;
            const root = document.documentElement.style;
            const previousWeight = root.getPropertyValue('--username-weight');
            const previousSetting = runtime.config.showLocalizedUsername;
            root.setProperty('--username-weight', '700');
            runtime.config.showLocalizedUsername = true;
            const socket = __chatSockets.find(socket => socket.readyState === 1 && socket.channel);
            socket.emit('@id=localized-weight;display-name=タネセンパイ :tanesenpaii!x PRIVMSG #' + socket.channel + ' :test');
            const record = runtime.renderer.rows.find(record => record.t.id === 'localized-weight');
            runtime.renderer.refresh();
            const result = {
                text: record.name.textContent,
                name: getComputedStyle(record.name).fontWeight,
                login: getComputedStyle(record.name.querySelector('.name-login')).fontWeight
            };
            runtime.renderer.remove(record);
            root.setProperty('--username-weight', previousWeight);
            runtime.config.showLocalizedUsername = previousSetting;
            return result;
        })()`);
        assert.deepEqual(weights, {
            text: 'タネセンパイ (tanesenpaii)',
            name: '700',
            login: '400'
        });
    };
    await checkLocalizedUsername();
    const checkGifs = async (height) => {
        await browser.evaluate('CHAT_WIDGET_RUNTIME.config.showTwitchGifs = true');
        // Use the same intrinsic dimensions in the local page and opaque-origin iframe.
        const fixture =
            'data:image/svg+xml;base64,' +
            Buffer.from(
                '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="purple"/></svg>'
            ).toString('base64');
        await browser.evaluate(`(() => {
            const socket = __chatSockets.find(socket => socket.readyState === 1 && socket.channel);
            socket.emit('@id=gif-size;display-name=GifUser;gifs=0-4|test|https://media4.giphy.com/media/test/giphy.gif?cid=keep&rid=giphy.gif :gifuser!x PRIVMSG #' + socket.channel + ' :[GIF]');
            const img = document.querySelector('.chat-gif');
            if (img.getAttribute('src') !== 'https://media4.giphy.com/media/test/giphy.gif?cid=keep&rid=giphy.gif') throw Error('GIF URL changed');
            img.src = ${JSON.stringify(fixture)};
        })()`);
        await waitFor('document.querySelector(".chat-gif")?.naturalWidth > 0');
        const size = await browser.evaluate(`(() => {
            const renderer = CHAT_WIDGET_RUNTIME.renderer;
            renderer.refresh();
            const img = document.querySelector('.chat-gif');
            const src = img.getAttribute('src');
            img.src = ${JSON.stringify(fixture)};
            return { max: getComputedStyle(img).maxHeight, width: img.getBoundingClientRect().width,
                height: img.getBoundingClientRect().height, src };
        })()`);
        assert.equal(size.max, height + 'px');
        assert.equal(
            size.src,
            'https://media4.giphy.com/media/test/giphy.gif?cid=keep&rid=giphy.gif'
        );
        // Refresh creates a new image; wait for decoding before measuring it.
        await waitFor('document.querySelector(".chat-gif")?.naturalWidth > 0');
        const actual = await browser.evaluate(`(() => {
            const img = document.querySelector('.chat-gif');
            const size = img.getBoundingClientRect();
            return {width:size.width, height:size.height};
        })()`);
        assert.equal(actual.height, height);
        assert.equal(actual.width / actual.height, 1.5);
        await browser.evaluate(`(() => {
            const renderer = CHAT_WIDGET_RUNTIME.renderer;
            const record = renderer.rows.find(record => record.body.querySelector('.chat-gif'));
            const image = record.body.querySelector('.chat-gif');
            image.onerror();
            if (record.body.textContent !== '[GIF]') throw Error('GIF fallback lost');
            renderer.remove(record);
        })()`);
    };
    await checkGifs(110);
    const checkGoogleFonts = async () => {
        await waitFor(
            '[...document.querySelectorAll("link[data-chat-google-font]")].length === 3 && [...document.querySelectorAll("link[data-chat-google-font]")].every(link => link.sheet)'
        );
        const result = await browser.evaluate(`(async () => {
            await Promise.all(['Aclonica', 'Press Start 2P', 'Roboto'].map(family => document.fonts.load('400 25px ' + JSON.stringify(family))));
            const style = getComputedStyle(document.documentElement);
            return {
                downloaded: ['Aclonica', 'Press Start 2P', 'Roboto'].every(family => [...document.fonts].some(font => font.family.replace(/['"]/g, '') === family && font.status === 'loaded')),
                username: style.getPropertyValue('--username-font-family').trim(),
                text: style.getPropertyValue('--text-font-family').trim()
            };
        })()`);
        assert.equal(result.downloaded, true);
        assert.equal(result.username, '"Press Start 2P", sans-serif');
        assert.equal(result.text, '"Roboto", sans-serif');
        return result;
    };
    const localFonts = await checkGoogleFonts();

    const tabs = path.join(outputDirectory, 'streamelements') + path.sep;
    const html = await readFile(tabs + 'index.html', 'utf8');
    const css = await readFile(tabs + 'style.css', 'utf8');
    const js = await readFile(tabs + 'index.js', 'utf8');
    const data = JSON.parse(await readFile(tabs + 'data.json', 'utf8'));
    previewDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-se-preview-'));
    const preview = path.join(previewDirectory, 'index.html');
    const detail = {
        channel: {
            username: 'Overlay_User',
            id: 'mongo-id',
            providerId: '111',
            apiToken: 'NOT_FOR_THE_WIDGET'
        },
        fieldData: { ...data, ...googleFonts, language: 'es', gifMaxHeightPx: '80' }
    };
    const childDocument =
        '<!doctype html><meta charset="utf-8"><style>' +
        css +
        '</style>' +
        html +
        '<script>' +
        initialization +
        js +
        ';window.addEventListener("message", async event => { if(event.data.testExpression) {try { parent.postMessage({testResult:await eval(event.data.testExpression)}, "*"); } catch(error) {parent.postMessage({testError:error.message}, "*");} } });' +
        ';window.addEventListener("load", () => window.dispatchEvent(new CustomEvent("onWidgetLoad", {detail:' +
        JSON.stringify(detail) +
        '})));</script>';
    const childLiteral = JSON.stringify(childDocument).replaceAll('<', '\\u003c');
    await writeFile(
        preview,
        '<!doctype html><iframe sandbox="allow-scripts" width="450" height="800"></iframe><script>' +
            'document.querySelector("iframe").src=URL.createObjectURL(new Blob([' +
            childLiteral +
            '],{type:"text/html"}));</script>'
    );
    await browser.send('Page.navigate', { url: pathToFileURL(preview).href });
    await waitFor('document.readyState === "complete"');
    const parentEvaluate = browser.evaluate;
    browser.evaluate = async (expression) => {
        return parentEvaluate(`new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Sandbox response timed out')), 5000);
            const receive = event => {
                if (event.source !== document.querySelector('iframe').contentWindow) return;
                clearTimeout(timer); window.removeEventListener('message', receive);
                if(event.data.testError) reject(Error(event.data.testError)); else resolve(event.data.testResult);
            };
            window.addEventListener('message', receive);
            document.querySelector('iframe').contentWindow.postMessage({testExpression:${JSON.stringify(expression)}}, '*');
        })`);
    };
    await waitFor('!!window.CHAT_WIDGET_RUNTIME');
    assert.equal(
        await browser.evaluate('getComputedStyle(document.documentElement).colorScheme'),
        'normal'
    );
    await waitFor('window.CHAT_WIDGET_RUNTIME?.sources[0]?.channel === "overlay_user"');
    await waitFor('__chatSockets.some(socket => socket.channel === "overlay_user")');
    const associated = await browser.evaluate(`(() => ({
        encapsulated: !window.ChatWidget,
        channel: CHAT_WIDGET_RUNTIME.sources[0].channel,
        tokenRetained: JSON.stringify(CHAT_WIDGET_RUNTIME.config).includes('NOT_FOR_THE_WIDGET')
    }))()`);
    assert.equal(associated.encapsulated, true);
    assert.equal(associated.tokenRetained, false);
    const streamElementsFonts = await checkGoogleFonts();
    await browser.evaluate(`
        __chatSockets.find(socket => socket.channel === 'overlay_user').emit(
            '@id=se-shared;display-name=SharedUser;first-msg=1;custom-reward-id=reward;reply-parent-msg-id=parent;reply-parent-user-login=bob;reply-parent-display-name=Bob;source-room-id=222;source-id=se-origin :shareduser!x PRIVMSG #overlay_user :SOURCE'
        );
    `);
    await waitFor(
        'CHAT_WIDGET_RUNTIME.renderer.rows.some(record => record.body.querySelector(".emote"))'
    );
    const streamElementsShared = await browser.evaluate(`(() => {
        const before = CHAT_WIDGET_RUNTIME.renderer.rows.length;
        window.dispatchEvent(new CustomEvent('onEventReceived', {detail:{listener:'message',event:{data:{text:'SOURCE'}}}}));
        return {
            originCatalog: CHAT_WIDGET_RUNTIME.assets.sourceChannels.has('222'),
            noDuplicateEvent: CHAT_WIDGET_RUNTIME.renderer.rows.length === before,
            visibleMessages: before
        };
    })()`);
    assert.equal(streamElementsShared.originCatalog, true);
    assert.equal(streamElementsShared.noDuplicateEvent, true);
    assert.equal(streamElementsShared.visibleMessages, 1);
    const streamElementsLanguage = await checkLanguage('es');
    await checkLocalizedUsername();
    await checkGifs(80);
    await browser.evaluate(`(() => {
        window.__oldRuntime = CHAT_WIDGET_RUNTIME;
        window.dispatchEvent(new CustomEvent('onWidgetLoad', {detail:{channel:{username:'ignored'},fieldData:{...${JSON.stringify(data)},language:'en',googleFont:'',usernameGoogleFont:'',textGoogleFont:'',messageBackground:'true',messageBackgroundColor:'rgba(12,34,56,0.35)',firstMessageBackgroundColor:'rgba(151,71,255,0.75)',textColor:'rgba(255,255,255,0.8)',channelMode:'custom',customChannels:'alpha, beta, alpha'}}}));
    })()`);
    await waitFor(
        '__chatSockets.filter(socket => socket.readyState === 1 && socket.channel).length === 2'
    );
    const custom = await browser.evaluate(`(() => ({
        channels: CHAT_WIDGET_RUNTIME.sources.map(source => source.channel),
        oldStopped: __oldRuntime.stopped && __oldRuntime.connections.every(connection => connection.stopped),
        oldRowsCleared: document.querySelectorAll('.message').length === 0,
        openSockets: __chatSockets.filter(socket => socket.readyState === 1).length
    }))()`);
    assert.deepEqual(custom.channels, ['alpha', 'beta']);
    assert.equal(custom.oldStopped, true);
    assert.equal(custom.oldRowsCleared, true);
    assert.equal(custom.openSockets, 2);
    assert.equal(await browser.evaluate('document.documentElement.lang'), 'en');
    assert.equal(
        await browser.evaluate('document.querySelectorAll("link[data-chat-google-font]").length'),
        0
    );
    assert.equal(
        await browser.evaluate(
            'document.documentElement.style.getPropertyValue("--text-font-family")'
        ),
        data.textFontFamily
    );
    const colors = await browser.evaluate(`(() => {
        __chatSockets.find(socket => socket.readyState === 1 && socket.channel === 'alpha').emit('@id=color-picker;first-msg=1;display-name=Alice :alice!x PRIVMSG #alpha :Alpha');
        return {
            background: document.documentElement.style.getPropertyValue('--message-background'),
            first: document.documentElement.style.getPropertyValue('--first-message-background'),
            text: getComputedStyle(document.body).color
        };
    })()`);
    assert.deepEqual(colors, {
        background: 'rgba(12,34,56,0.35)',
        first: 'rgba(151,71,255,0.75)',
        text: 'rgba(255, 255, 255, 0.8)'
    });
    const demoInitial = await browser.evaluate(`(() => {
        window.__demoSetTimeout = window.setTimeout;
        window.setTimeout = (callback, delay, ...args) => __demoSetTimeout(callback, delay >= 600 && delay <= 1800 ? 10 : delay, ...args);
        window.dispatchEvent(new CustomEvent('onWidgetLoad', {detail:{channel:{username:'ignored'},fieldData:{...${JSON.stringify(data)},language:'en',googleFont:'',usernameGoogleFont:'',textGoogleFont:'',demo:'true'}}}));
        const runtime = CHAT_WIDGET_RUNTIME;
        runtime.assets.globalEmotes.set('DemoWave', {src:'https://cdn.7tv.app/emote/fixture/2x.webp',ratio:1});
        window.__demoTrace = {reply:false,first:false,reward:false,highlight:false,cheer:false,action:false,emotes:false,paint:false,mention:false,removed:false};
        const snapshot = () => {
            const trace = __demoTrace;
            for(const [key, selector] of Object.entries({reply:'.reply-context',first:'.first-message',cheer:'.cheer',action:'.action',emotes:'.emote',paint:'.name.painted',mention:'.mention'})) {
                trace[key] ||= !!document.querySelector(selector);
            }
            for(const label of document.querySelectorAll('.redemption-context')) {
                trace.reward ||= label.textContent.includes('Redeemed');
                trace.highlight ||= label.textContent.includes('Highlighted');
            }
        };
        window.__demoObserver = new MutationObserver(snapshot);
        __demoObserver.observe(document.getElementById('chat'), {subtree:true,childList:true,attributes:true});
        const moderate = runtime.renderer.moderate.bind(runtime.renderer);
        runtime.renderer.moderate = event => {
            const target = event.tags['target-msg-id'];
            const existed = runtime.renderer.rows.some(record => record.id === target);
            moderate(event);
            __demoTrace.removed ||= existed && !runtime.renderer.rows.some(record => record.id === target);
        };
        return {initial:runtime.renderer.rows.length,connections:runtime.connections.length};
    })()`);
    assert.deepEqual(demoInitial, { initial: 1, connections: 0 });
    await waitFor('Object.values(__demoTrace).every(Boolean)');
    const demo = await browser.evaluate(`(() => {
        window.setTimeout = __demoSetTimeout;
        __demoObserver.disconnect();
        CHAT_WIDGET_RUNTIME.stop();
        return {...__demoTrace, safe:!document.querySelector('.body script')};
    })()`);
    assert.ok(Object.values(demo).every(Boolean), JSON.stringify(demo));
    assert.equal(browser.errors.length, 0, browser.errors.join('\n'));
    const result = {
        local,
        shared,
        associated,
        streamElementsShared,
        custom,
        localFonts,
        streamElementsFonts,
        localLanguage,
        streamElementsLanguage,
        colors,
        demo,
        errors: browser.errors
    };
    await writeFile(
        await artifactPath('build-browser-results.json'),
        JSON.stringify(result, null, 4) + '\n'
    );
    console.log(
        'PASS compiled local HTML, embedded assets, Shared Chat, StreamElements channel modes, and reload cleanup'
    );
    console.log(JSON.stringify(result));
} finally {
    try {
        await browser?.close();
    } finally {
        for (const directory of [outputDirectory, previewDirectory].filter(Boolean)) {
            await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        }
    }
}
