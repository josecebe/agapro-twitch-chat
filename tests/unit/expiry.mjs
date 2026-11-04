import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let sequence = 0;
let reduced = false;
const timers = new Map();
const context = vm.createContext({
    window: {
        ChatWidget: {},
        matchMedia: () => ({
            matches: reduced
        })
    },
    setTimeout: (fn) => {
        const id = ++sequence;
        timers.set(id, fn);
        return id;
    },
    clearTimeout: (id) => timers.delete(id),
    clearInterval() {}
});
vm.runInContext(readWidgetScripts(), context);
vm.runInContext(readFileSync(new URL('../../src/renderer.js', import.meta.url), 'utf8'), context);
const Renderer = context.window.ChatWidget.Renderer;
function fixture() {
    const listeners = new Map();
    const classes = new Set();
    const row = {
        removed: 0,
        classList: {
            add: (c) => classes.add(c)
        },
        addEventListener: (type, fn) => {
            if (!listeners.has(type)) {
                listeners.set(type, new Set());
            }
            listeners.get(type).add(fn);
        },
        removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
        remove() {
            this.removed++;
        }
    };
    const record = {
        row,
        time: Date.now() - 10000,
        id: 'msg',
        source: 'msg',
        provider: 'twitch'
    };
    const renderer = Object.create(Renderer.prototype);
    Object.assign(renderer, {
        config: {
            messageLifetimeSeconds: 1,
            enableAnimations: true
        },
        rows: [record],
        assets: {
            listeners: new Set()
        },
        tombstones: new Map(),
        userClears: new Map()
    });
    return {
        renderer,
        record,
        row,
        classes,
        listeners,
        dispatch: (type, animationName = 'disappear') => {
            for (const fn of [...(listeners.get(type) || [])]) {
                fn({
                    target: row,
                    type,
                    animationName
                });
            }
        }
    };
}
let count = 0;
const test = (name, fn) => {
    fn();
    console.log('PASS', name);
    count++;
};
test('TTL starts the exit animation and removes the message when it ends', () => {
    const f = fixture();
    f.renderer.expire();
    assert.ok(f.classes.has('leaving'));
    assert.equal(f.row.removed, 0);
    f.dispatch('animationend', 'appear');
    assert.equal(f.row.removed, 0);
    f.dispatch('animationend');
    assert.equal(f.row.removed, 1);
    assert.equal(f.renderer.rows.length, 0);
    assert.equal(timers.size, 0);
});
test('Repeated TTL checks do not duplicate listeners or restart the exit', () => {
    const f = fixture();
    f.renderer.expire();
    const timer = f.record.exitTimer;
    f.renderer.expire();
    assert.equal(f.record.exitTimer, timer);
    assert.equal(f.listeners.get('animationend').size, 1);
    f.renderer.remove(f.record);
    assert.equal(timers.size, 0);
});
test('A fallback removes messages when CEF does not emit animationend', () => {
    const f = fixture();
    f.renderer.expire();
    timers.get(f.record.exitTimer)();
    assert.equal(f.row.removed, 1);
    assert.equal(timers.size, 0);
});
test('Reduced motion or disabled animations removes messages immediately', () => {
    reduced = true;
    let f = fixture();
    f.renderer.expire();
    assert.equal(f.row.removed, 1);
    assert.equal(timers.size, 0);
    reduced = false;
    f = fixture();
    f.renderer.config.enableAnimations = false;
    f.renderer.expire();
    assert.equal(f.row.removed, 1);
    assert.equal(timers.size, 0);
});
test('Zero TTL preserves messages without starting exit animations', () => {
    const f = fixture();
    f.renderer.config.messageLifetimeSeconds = 0;
    f.renderer.expire();
    assert.equal(f.row.removed, 0);
    assert.equal(timers.size, 0);
});
test('Moderation during an exit removes content and cancels scheduled work', () => {
    const f = fixture();
    f.renderer.expire();
    f.renderer.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'msg'
        },
        params: []
    });
    assert.equal(f.row.removed, 1);
    assert.equal(timers.size, 0);
    assert.equal(f.listeners.get('animationend').size, 0);
});
test('Cancelling animations or stopping the renderer leaves no timers', () => {
    let f = fixture();
    f.renderer.expire();
    f.dispatch('animationcancel');
    assert.equal(f.row.removed, 1);
    f = fixture();
    f.renderer.expire();
    f.renderer.stop();
    assert.equal(timers.size, 0);
    assert.equal(f.listeners.get('animationend').size, 0);
});
let bursts = 0;
context.window.ChatWidget.DustEffects = class {
    burst() {
        bursts++;
    }
    stop() {}
};
test('Moderation emits dust while removing content immediately', () => {
    const f = fixture();
    const before = bursts;
    f.renderer.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'msg'
        },
        params: []
    });
    assert.equal(bursts, before + 1);
    assert.equal(f.row.removed, 1);
    assert.equal(f.renderer.rows.length, 0);
    f.renderer.stop();
});
test('Disabled animations or the none effect prevents dust', () => {
    const before = bursts;
    let f = fixture();
    f.renderer.config.enableAnimations = false;
    f.renderer.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'msg'
        },
        params: []
    });
    f = fixture();
    f.renderer.config.moderationAnimation = 'none';
    f.renderer.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'msg'
        },
        params: []
    });
    assert.equal(bursts, before);
    assert.equal(f.row.removed, 1);
});
test('Expiry keeps its normal exit animation without emitting dust', () => {
    const f = fixture();
    const before = bursts;
    f.renderer.expire();
    assert.ok(f.classes.has('leaving'));
    assert.equal(bursts, before);
    f.dispatch('animationend');
    assert.equal(f.row.removed, 1);
});
console.log(`${count} tests PASS`);
