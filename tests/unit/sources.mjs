import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const core = readWidgetScripts();
const providers = readFileSync(new URL('../../src/providers.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
const base = vm.createContext({
    window: {},
    URL,
    AbortController,
    setTimeout,
    clearTimeout
});
vm.runInContext(core, base);
vm.runInContext(providers, base);
const A = base.window.ChatWidget;
let count = 0;
const test = (name, fn) => {
    fn();
    console.log('PASS', name);
    count++;
};
test('Sources normalize Twitch channels and optional IDs with Twitch as the default provider', () => {
    const r = A.normalizeSources([
        {
            provider: ' TWITCH ',
            channel: '@Samplehost',
            channelId: 999100001
        },
        {
            channel: 'Samplechannel'
        }
    ]);
    assert.equal(r.sources.length, 2);
    assert.equal(r.sources[0].id, 'twitch:samplehost');
    assert.equal(r.sources[0].channelId, '999100001');
    assert.equal(r.sources[1].provider, 'twitch');
    assert.equal(r.sources[1].channel, 'samplechannel');
});
test('Sources omit duplicates, disabled entries and invalid entries without losing valid ones', () => {
    const r = A.normalizeSources([
        {
            provider: 'twitch',
            channel: 'samplechannel'
        },
        {
            provider: 'twitch',
            channel: 'SAMPLECHANNEL'
        },
        {
            provider: 'twitch',
            channel: 'disabled',
            enabled: false
        },
        {
            provider: 'unknown',
            channel: 'a'
        },
        {
            provider: 'twitch',
            channel: '../a'
        },
        {
            provider: 'twitch',
            channel: 'valid',
            channelId: 'bad'
        },
        {
            provider: 'twitch',
            channel: 'other'
        }
    ]);
    assert.equal(r.sources.length, 2);
    assert.equal(r.errors.length, 4);
    assert.equal(r.sources[1].id, 'twitch:other');
    assert.equal(A.normalizeSources(null).sources.length, 0);
});
let globalCalls = 0;
const shared = A.sharedAssetFetcher(async (url) => {
    globalCalls++;
    return {
        url
    };
});
await Promise.all(
    Array.from(
        {
            length: 5
        },
        () => shared('https://7tv.io/v3/emote-sets/global')
    )
);
await Promise.all(
    Array.from(
        {
            length: 4
        },
        () => shared('https://api.ivr.fi/v2/twitch/badges/global')
    )
);
test('Sources share global catalog downloads', () => assert.equal(globalCalls, 2));
await Promise.all([
    shared('https://7tv.io/v3/users/twitch/1'),
    shared('https://7tv.io/v3/users/twitch/2')
]);
test('Sources keep separate channel catalogs', () => assert.equal(globalCalls, 4));
let failedCalls = 0;
const retryGlobals = A.sharedAssetFetcher(async () => {
    if (++failedCalls === 1) {
        throw Error('Temporary');
    }
    return {};
});
await assert.rejects(retryGlobals('https://7tv.io/v3/emote-sets/global'));
await retryGlobals('https://7tv.io/v3/emote-sets/global');
test('Global download failures are not cached permanently', () => assert.equal(failedCalls, 2));
function boot(sources, failChannel = '', options = {}) {
    const listeners = new Map();
    const root = {
        classList: {
            toggle() {}
        }
    };
    const panel = {};
    const properties = new Map();
    const classes = new Map();
    const style = {
        setProperty: (key, value) => properties.set(key, value)
    };
    const context = vm.createContext({
        window: {
            CHAT_WIDGET_CONFIG: {
                sources,
                maxMessages: 35,
                ...options
            },
            addEventListener: (event, callback) => listeners.set(event, callback)
        },
        URL,
        URLSearchParams,
        AbortController,
        setTimeout,
        clearTimeout,
        location: {
            search: ''
        },
        document: {
            getElementById: (id) => (id === 'chat' ? root : panel),
            body: {
                classList: {
                    toggle: (key, value) => classes.set(key, value)
                },
                style: {}
            },
            documentElement: {
                style
            }
        },
        console
    });
    vm.runInContext(core, context);
    vm.runInContext(providers, context);
    const a = context.window.ChatWidget;
    class Assets {
        constructor() {
            this.listeners = new Set();
            this.stops = 0;
        }
        start(c) {
            this.config = c;
        }
        setChannel(id) {
            this.channelId = id;
        }
        configure(data) {
            this.channelId = data.user_id;
        }
        stop() {
            this.stops++;
        }
    }
    class Connection {
        constructor(channel, onMessage, onState, onMetadata) {
            const name = typeof channel === 'string' ? channel : channel.channel;
            if (name === failChannel) {
                throw Error('Simulated failure');
            }
            Object.assign(this, {
                channel: name,
                onMessage,
                onState,
                onMetadata,
                connects: 0,
                stops: 0,
                options: channel
            });
        }
        connect() {
            this.connects++;
        }
        stop() {
            this.stops++;
        }
    }
    class Renderer {
        constructor() {
            this.registered = new Map();
            this.messages = [];
            this.moderations = [];
        }
        registerSource(id, assets) {
            this.registered.set(id, assets);
        }
        add(m) {
            this.messages.push(m);
        }
        moderate(m) {
            this.moderations.push(m);
        }
        fit() {}
        refresh() {}
        stop() {
            this.stopped = true;
        }
    }
    Object.assign(a, {
        Assets,
        TwitchChat: Connection,
        Renderer,
        Paints: class {}
    });
    vm.runInContext(main, context);
    vm.runInContext('window.ChatWidget.start(window.CHAT_WIDGET_CONFIG)', context);
    return {
        runtime: context.window.CHAT_WIDGET_RUNTIME,
        restart: () =>
            vm.runInContext('window.ChatWidget.start(window.CHAT_WIDGET_CONFIG)', context),
        listeners,
        panel,
        properties,
        classes
    };
}
const entries = [
    {
        provider: 'twitch',
        channel: 'alpha'
    },
    {
        provider: 'twitch',
        channel: 'beta'
    },
    {
        provider: 'twitch',
        channel: 'gamma'
    },
    {
        provider: 'twitch',
        channel: 'delta'
    }
];
const app = boot(entries);
test('Four Twitch channels start with independent catalogs', () => {
    assert.equal(app.runtime.connections.length, 4);
    assert.equal(new Set(app.runtime.sources.map((s) => s.assets)).size, 4);
    assert.equal(app.runtime.renderer.registered.size, 4);
    assert.ok(app.runtime.sources.every((s) => s.provider === 'twitch'));
});
for (const s of app.runtime.sources) {
    s.connection.onMessage({
        command: 'PRIVMSG',
        tags: {
            'room-id': s.channel === 'alpha' ? '1' : '2'
        },
        params: ['#c', 'Hola']
    });
    s.connection.onMessage({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'same'
        },
        params: []
    });
}
test('Messages and moderation commands preserve their source channel', () => {
    assert.equal(app.runtime.renderer.messages[0].sourceId, 'twitch:alpha');
    assert.equal(app.runtime.renderer.messages[1].sourceId, 'twitch:beta');
    assert.equal(app.runtime.renderer.messages[3].provider, 'twitch');
    assert.equal(app.runtime.renderer.moderations[3].sourceId, 'twitch:delta');
});
app.listeners.get('online')();
test('Network recovery reconnects sources without extra instances', () => {
    assert.equal(app.runtime.connections.length, 4);
    assert.ok(app.runtime.connections.every((c) => c.connects === 2));
});
app.listeners.get('pagehide')();
test('Closing stops all source connections, catalogs and the renderer', () => {
    assert.ok(app.runtime.connections.every((c) => c.stops === 1));
    assert.ok(app.runtime.sources.every((s) => s.assets.stops === 1));
    assert.equal(app.runtime.renderer.stopped, true);
});
const partial = boot(entries, 'beta');
test('A failed source does not prevent other sources from starting', () => {
    assert.equal(partial.runtime.connections.length, 3);
    assert.ok(partial.runtime.status.get('twitch:beta · connection').includes('error'));
});
partial.listeners.get('pagehide')();
const empty = boot([]);
test('Empty source arrays report configuration errors without opening connections', () => {
    assert.equal(empty.runtime.connections.length, 0);
    assert.equal(empty.panel.hidden, false);
});
empty.listeners.get('pagehide')();
test('Message backgrounds support color, opacity, disabling and safe bounds', () => {
    for (const [options, color, enabled] of [
        [{}, 'rgba(0,0,0,0.3)', false],
        [
            {
                messageBackground: true
            },
            'rgba(0,0,0,0.3)',
            true
        ],
        [
            {
                messageBackground: true,
                messageBackgroundColor: '#123abc',
                messageBackgroundOpacity: 0.5
            },
            'rgba(18,58,188,0.5)',
            true
        ],
        [
            {
                messageBackground: false
            },
            'rgba(0,0,0,0.3)',
            false
        ],
        [
            {
                messageBackground: true,
                messageBackgroundOpacity: 0
            },
            'rgba(0,0,0,0)',
            false
        ],
        [
            {
                messageBackground: true,
                messageBackgroundOpacity: 99,
                messageBackgroundColor: 'invalid'
            },
            'rgba(0,0,0,1)',
            true
        ]
    ]) {
        const app = boot([], '', options);
        assert.equal(app.properties.get('--message-background'), color);
        assert.equal(app.classes.get('message-background'), enabled);
        app.listeners.get('pagehide')();
    }
});
test('Restarting closes previous source connections and resources exactly once', () => {
    const app = boot(entries);
    const previous = app.runtime;
    const next = app.restart();
    assert.equal(previous.stopped, true);
    assert.ok(previous.connections.every((connection) => connection.stops === 1));
    assert.equal(previous.renderer.stopped, true);
    assert.ok(previous.sources.every((source) => source.assets.stops === 1));
    previous.stop();
    assert.ok(previous.connections.every((connection) => connection.stops === 1));
    assert.equal(next.connections.length, entries.length);
    next.stop();
});
console.log(`${count} tests PASS`);
