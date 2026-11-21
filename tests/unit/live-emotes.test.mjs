import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const emote = (id, name, zeroWidth = false) => ({
    id,
    name,
    data: {
        flags: zeroWidth ? 256 : 0,
        host: {
            url: 'https://cdn.7tv.app/emote/' + id,
            files: [{ name: '1x.webp', width: 32, height: 32, size: 100 }]
        }
    }
});
async function fixture({ missingChannelSet = false } = {}) {
    const timers = new Map();
    const intervals = new Map();
    const streams = [];
    const calls = [];
    let sequence = 0;
    const catalogs = new Map([
        ['global-set', { id: 'global-set', emotes: [emote('global', 'Global')] }],
        ['channel-set', { id: 'channel-set', emotes: [emote('wave', 'Wave')] }],
        ['shared-set', { id: 'shared-set', emotes: [emote('shared', 'Shared')] }]
    ]);
    class EventSource {
        constructor(url) {
            this.url = url;
            this.listeners = new Map();
            this.readyState = 1;
            streams.push(this);
        }
        addEventListener(type, callback) {
            this.listeners.set(type, callback);
        }
        emit(type, value = {}) {
            return this.listeners.get(type)?.({
                data: typeof value === 'string' ? value : JSON.stringify(value)
            });
        }
        close() {
            this.readyState = 2;
            this.closed = true;
        }
    }
    const context = vm.createContext({
        window: {},
        URL,
        EventSource,
        setTimeout: (fn, ms) => {
            const id = ++sequence;
            timers.set(id, { fn, ms });
            return id;
        },
        clearTimeout: (id) => timers.delete(id),
        setInterval: (fn, ms) => {
            const id = ++sequence;
            intervals.set(id, { fn, ms });
            return id;
        },
        clearInterval: (id) => intervals.delete(id)
    });
    for (const file of ['core', 'providers'])
        vm.runInContext(
            readFileSync(new URL('../../src/' + file + '.js', import.meta.url), 'utf8'),
            context
        );
    const widget = context.window.ChatWidget;
    const assets = new widget.Assets(
        () => {},
        async (url, options) => {
            calls.push({ url, options });
            if (url.includes('/users/twitch/')) {
                const room = url.split('/').at(-1);
                if (room === '42' && missingChannelSet) return { emote_set: null };
                const id = room === '42' ? 'channel-set' : 'shared-set';
                return { emote_set: structuredClone(catalogs.get(id)) };
            }
            const id = url.endsWith('/global') ? 'global-set' : url.split('/').at(-1);
            return structuredClone(catalogs.get(id));
        }
    );
    const flush = async () => {
        for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    const run = async (ms) => {
        for (const [id, task] of [...timers]) {
            if (task.ms !== ms || !timers.delete(id)) continue;
            await task.fn();
        }
        await flush();
    };
    assets.start({ showBadges: false, showSevenTVEmotes: true });
    assets.setChannel('42');
    await flush();
    return {
        widget,
        assets,
        streams,
        timers,
        intervals,
        calls,
        catalogs,
        flush,
        run,
        enableChannel: () => {
            missingChannelSet = false;
        },
        runInterval: async (ms) => {
            for (const task of intervals.values()) if (task.ms === ms) await task.fn();
            await flush();
        }
    };
}

test('7TV set events add, rename and remove emotes without reloading the overlay', async () => {
    const f = await fixture();
    try {
        const stream = f.streams.at(-1);
        assert.ok(decodeURIComponent(stream.url).includes('emote_set.*<object_id=channel-set>'));
        let refreshes = 0;
        f.assets.listeners.add(() => refreshes++);
        f.catalogs.set('channel-set', {
            id: 'channel-set',
            emotes: [emote('new', 'New'), emote('overlay', 'Overlay', true)]
        });
        const event = { type: 'emote_set.update', body: { id: 'channel-set' } };
        const before = f.calls.length;
        stream.emit('dispatch', event);
        stream.emit('dispatch', event);
        await f.run(250);
        assert.equal(f.calls.length, before + 1);
        assert.equal(f.assets.emote('Wave'), undefined);
        assert.ok(f.assets.emote('New'));
        assert.ok(f.assets.emote('Overlay').zeroWidth);
        assert.equal(refreshes, 1);
        assert.equal(f.calls.at(-1).options.cache, 'no-cache');
        f.catalogs.get('channel-set').emotes[0].name = 'Renamed';
        stream.emit('dispatch', event);
        await f.run(250);
        assert.equal(f.assets.emote('New'), undefined);
        assert.ok(f.assets.emote('Renamed'));
    } finally {
        f.assets.stop();
    }
});

test('an overlay opened without an active channel set discovers the first set and starts live updates', async () => {
    const f = await fixture({ missingChannelSet: true });
    try {
        assert.equal(f.assets.channelEmotes.size, 0);
        assert.equal(f.assets.emoteSets.has('42'), false);
        let refreshes = 0;
        f.assets.listeners.add(() => refreshes++);
        f.enableChannel();
        await f.runInterval(15000);
        assert.ok(f.assets.emote('Wave'));
        assert.equal(f.assets.emoteSets.get('42'), 'channel-set');
        assert.ok(refreshes > 0);
        assert.ok(decodeURIComponent(f.streams.at(-1).url).includes('channel-set'));
        const calls = f.calls.length;
        await f.runInterval(15000);
        assert.equal(f.calls.length, calls);
    } finally {
        f.assets.stop();
    }
    assert.equal(f.intervals.size, 0);
});

test('7TV reconnections resync global, channel and Shared Chat catalogs', async () => {
    const f = await fixture();
    try {
        await f.assets.ensureSource('77');
        const stream = f.streams.at(-1);
        f.catalogs.get('global-set').emotes.push(emote('global-new', 'GlobalNew'));
        f.catalogs.get('shared-set').emotes.push(emote('shared-new', 'SharedNew'));
        stream.emit('open');
        await f.run(250);
        assert.ok(f.assets.emote('GlobalNew'));
        assert.ok(f.assets.emote('SharedNew', '77'));
        stream.emit('reconnect');
        assert.ok(stream.closed);
        await f.run(10000);
        const next = f.streams.at(-1);
        assert.notEqual(next, stream);
        next.emit('hello', { heartbeat_interval: 1000 });
        await f.run(3000);
        assert.ok(next.closed);
        await f.run(10000);
        assert.notEqual(f.streams.at(-1), next);
    } finally {
        f.assets.stop();
    }
    assert.ok(f.streams.at(-1).closed);
    assert.equal(f.timers.size, 0);
});

test('7TV live reloads preserve cached emotes on failures and ignore retired streams', async () => {
    const f = await fixture();
    try {
        const old = f.streams.at(-1);
        f.assets.fetcher = async () => {
            throw Object.assign(Error('HTTP 429'), { status: 429 });
        };
        old.emit('dispatch', { type: 'emote_set.update', body: { id: 'channel-set' } });
        await f.run(250);
        assert.ok(f.assets.emote('Wave'));
        f.assets.setChannel('99');
        old.emit('dispatch', { type: 'emote_set.update', body: { id: 'channel-set' } });
        await f.flush();
        assert.equal([...f.timers.values()].filter((timer) => timer.ms === 250).length, 0);
        f.assets.stop();
        old.emit('open');
        assert.equal(f.timers.size, 0);
    } finally {
        f.assets.stop();
    }
});

test('forced catalog revalidation bypasses cached values and still shares pending downloads', async () => {
    const f = await fixture();
    f.assets.stop();
    let requests = 0;
    const fetcher = f.widget.sharedAssetFetcher(async () => ({ version: ++requests }));
    const url = 'https://7tv.io/v3/emote-sets/global';
    assert.equal((await fetcher(url)).version, 1);
    const [a, b] = await Promise.all([
        fetcher(url, { cache: 'no-cache' }),
        fetcher(url, { cache: 'no-cache' })
    ]);
    assert.equal(a.version, 2);
    assert.equal(b.version, 2);
    assert.equal((await fetcher(url)).version, 2);
});

test('updates received during a download trigger a second sync, and stopped overlays ignore late responses', async () => {
    const f = await fixture();
    try {
        const stream = f.streams.at(-1);
        const original = f.assets.fetcher;
        let release;
        f.assets.fetcher = () =>
            new Promise((resolve) => {
                release = resolve;
            });
        const update = { type: 'emote_set.update', body: { id: 'channel-set' } };
        stream.emit('dispatch', update);
        const running = f.run(250);
        await f.flush();
        stream.emit('dispatch', update);
        release({ id: 'channel-set', emotes: [emote('first', 'First')] });
        await running;
        f.catalogs.set('channel-set', { id: 'channel-set', emotes: [emote('latest', 'Latest')] });
        f.assets.fetcher = original;
        await f.run(250);
        assert.ok(f.assets.emote('Latest'));
        assert.equal(f.assets.emote('First'), undefined);
        f.assets.fetcher = () =>
            new Promise((resolve) => {
                release = resolve;
            });
        stream.emit('dispatch', update);
        const late = f.run(250);
        await f.flush();
        f.assets.stop();
        release({ id: 'channel-set', emotes: [] });
        await late;
        assert.ok(f.assets.emote('Latest'));
        assert.equal(f.timers.size, 0);
    } finally {
        f.assets.stop();
    }
});
