import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context = vm.createContext({
    window: {},
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
});
for (const file of ['core', 'providers']) {
    vm.runInContext(
        readFileSync(new URL('../../src/' + file + '.js', import.meta.url), 'utf8'),
        context
    );
}
const A = context.window.ChatWidget;
let count = 0;
const test = (name, fn) => {
    fn();
    console.log('PASS', name);
    count++;
};
const calls = [];
let failed = false;
let active = 0;
let maxActive = 0;
const assets = new A.Assets(
    () => {},
    async (url) => {
        calls.push(url);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
        if (failed) {
            const e = Error('HTTP 429');
            e.status = 429;
            e.retryAfter = 120000;
            throw e;
        }
        const parsed = new URL(url);
        const id = parsed.searchParams.get('id') || parsed.pathname.split('/').at(-1);
        if (parsed.hostname === 'api.ivr.fi') {
            return [
                {
                    set_id: 'subscriber',
                    versions: [
                        {
                            id: '6',
                            title: 'sub-' + id,
                            image_url_4x: `https://static-cdn.jtvnw.net/badges/v1/${id}/3`
                        }
                    ]
                }
            ];
        }
        return {
            emote_set: {
                emotes: [
                    {
                        id: 'id-' + id,
                        name: 'ALIAS',
                        data: {
                            flags: 256,
                            animated: true,
                            host: {
                                url: '//cdn.7tv.app/emote/' + id,
                                files: [
                                    {
                                        name: '2x.webp',
                                        width: 64,
                                        height: 64
                                    }
                                ]
                            }
                        }
                    }
                ]
            }
        };
    }
);
assets.config = {
    showBadges: true,
    showSevenTVEmotes: true
};
assets.channelId = '100';
assets.channelBadges = {
    subscriber: {
        versions: {
            6: {
                title: 'local'
            }
        }
    }
};
assets.channelEmotes.set('ALIAS', {
    id: 'local'
});
assets.globalEmotes.set('GLOBAL', {
    id: 'global'
});
assets.globalBadges = {
    moderator: {
        versions: {
            1: {
                title: 'global-mod'
            }
        }
    }
};
await Promise.all(
    Array.from(
        {
            length: 20
        },
        () => assets.ensureSource('200')
    )
);
test('Shared Chat: 20 messages from one origin share two downloads', () => {
    assert.equal(calls.length, 2);
    assert.equal(assets.channelId, '100');
    assert.equal(assets.channelEmotes.get('ALIAS').id, 'local');
});
await assets.ensureSource('300');
test('Shared Chat: exact badges and aliases resolve within their origin channel', () => {
    assert.equal(assets.badge('subscriber', '6').title, 'local');
    assert.equal(assets.badge('subscriber', '6', '200').title, 'sub-200');
    assert.equal(assets.badge('subscriber', '12', '200'), undefined);
    assert.equal(assets.emote('ALIAS', '200').id, 'id-200');
    assert.equal(assets.emote('ALIAS', '300').id, 'id-300');
    assert.equal(assets.emote('ALIAS').id, 'local');
    assert.equal(assets.emote('GLOBAL', '200').id, 'global');
    assert.equal(assets.badge('moderator', '1', '200').title, 'global-mod');
});
const before = calls.length;
await assets.ensureSource('200');
await assets.ensureSource('evil');
await assets.ensureSource('100');
test('Shared Chat: cached origins, the main channel and invalid IDs avoid extra requests', () =>
    assert.equal(calls.length, before));
test('Shared Chat: missing origin catalogs never borrow main-channel emotes or badges', () => {
    assert.equal(assets.emote('ALIAS', '400'), undefined);
    assert.equal(assets.badge('subscriber', '6', '400'), undefined);
});
let changes = 0;
assets.listeners.add(() => changes++);
const old = assets.sourceChannels.get('200');
old.badgesDue = old.emotesDue = 0;
failed = true;
await assets.ensureSource('200');
test('Shared Chat: failures and 429 responses preserve caches and defer retries', () => {
    assert.equal(assets.emote('ALIAS', '200').id, 'id-200');
    assert.equal(assets.badge('subscriber', '6', '200').title, 'sub-200');
    assert.ok(old.emotesDue > Date.now() + 110000);
    assert.equal(changes, 1);
});
const afterFailure = calls.length;
await assets.ensureSource('200');
assert.equal(calls.length, afterFailure);
failed = false;
await Promise.all(['400', '500', '600', '700', '800'].map((id) => assets.ensureSource(id)));
test('Shared Chat: at most two channels and four HTTP requests load concurrently', () =>
    assert.ok(maxActive <= 4));
const lastSeen = assets.sourceChannels.get('200').lastSeen;
await assets.ensureSource('200', false);
test('Shared Chat: refreshes do not extend the lifetime of inactive origins', () =>
    assert.equal(assets.sourceChannels.get('200').lastSeen, lastSeen));
test('Shared Chat: source-room-id selection and room-id fallback are validated', () => {
    assert.equal(
        A.sourceRoom({
            'source-room-id': '200',
            'room-id': '100'
        }),
        '200'
    );
    assert.equal(
        A.sourceRoom({
            'source-room-id': 'https://evil.org',
            'room-id': '100'
        }),
        '100'
    );
    assert.equal(A.sourceRoom({}, '100'), '100');
});
assets.stop();
let missingCalls = 0;
const missing = new A.Assets(
    () => {},
    async (url) => {
        missingCalls++;
        if (url.includes('7tv.io')) {
            const e = Error('404');
            e.status = 404;
            throw e;
        }
        return [];
    }
);
missing.channelId = '100';
await missing.ensureSource('900');
await missing.ensureSource('900');
test('Shared Chat: missing 7TV accounts are cached instead of queried per message', () => {
    assert.equal(missingCalls, 2);
    assert.equal(missing.sourceChannels.get('900').emotes.size, 0);
});
missing.stop();
let disabledCalls = 0;
const disabled = new A.Assets(
    () => {},
    async () => {
        disabledCalls++;
        return [];
    }
);
disabled.channelId = '100';
disabled.config = {
    showBadges: false,
    showSevenTVEmotes: false
};
await disabled.ensureSource('200');
test('Shared Chat: disabled assets are not downloaded', () => assert.equal(disabledCalls, 0));
disabled.stop();
const bounded = new A.Assets(
    () => {},
    async () => []
);
bounded.channelId = '100';
bounded.config = {
    showBadges: false,
    showSevenTVEmotes: false
};
for (let i = 200; i < 250; i++) {
    await bounded.ensureSource(String(i));
}
test('Shared Chat: origin cache size is limited to 32 channels', () =>
    assert.equal(bounded.sourceChannels.size, 32));
bounded.stop();
const avatarCalls = [];
let avatarFails = false;
const avatarAssets = new A.Assets(
    () => {},
    async (url) => {
        avatarCalls.push(url);
        if (avatarFails) throw Object.assign(Error('HTTP 500'), { status: 500 });
        const id = new URL(url).searchParams.get('id');
        return [
            {
                displayName: 'Chan' + id,
                logo:
                    id === '666'
                        ? 'https://evil.example/logo.png'
                        : `https://static-cdn.jtvnw.net/user-default-pictures/${id}.png`
            }
        ];
    }
);
let avatarChanges = 0;
avatarAssets.listeners.add(() => avatarChanges++);
avatarAssets.channelAvatar('200');
avatarAssets.channelAvatar('200');
avatarAssets.channelAvatar('evil');
await new Promise((r) => setTimeout(r, 5));
test('Shared Chat: origin channel avatars are fetched once, cached and validated', () => {
    assert.deepEqual(avatarCalls, ['https://api.ivr.fi/v2/twitch/user?id=200']);
    assert.equal(avatarChanges, 1);
    const avatar = avatarAssets.channelAvatar('200');
    assert.equal(avatar.src, 'https://static-cdn.jtvnw.net/user-default-pictures/200.png');
    assert.equal(avatar.name, 'Chan200');
    assert.equal(avatarCalls.length, 1);
});
avatarAssets.channelAvatar('666');
avatarFails = true;
avatarAssets.channelAvatar('300');
await new Promise((r) => setTimeout(r, 5));
test('Shared Chat: untrusted avatar hosts and failed lookups show no icon and defer retries', () => {
    assert.equal(avatarAssets.channelAvatar('666'), null);
    assert.equal(avatarAssets.channelAvatar('300'), null);
    assert.equal(avatarCalls.length, 3);
});
console.log(`${count} tests PASS`);
