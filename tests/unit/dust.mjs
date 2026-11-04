import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let sequence = 0;
let reduced = false;
let draws = 0;
let created = 0;
let removed = 0;
const frames = new Map();
const context2d = {
    setTransform() {},
    clearRect() {},
    fillRect() {
        draws++;
    }
};
const context = vm.createContext({
    window: {
        ChatWidget: {},
        innerWidth: 500,
        innerHeight: 800,
        matchMedia: () => ({
            get matches() {
                return reduced;
            }
        }),
        getComputedStyle: () => ({
            color: '#aabbcc'
        })
    },
    document: {
        createElement: () => {
            created++;
            return {
                setAttribute() {},
                getContext: () => context2d,
                remove() {
                    removed++;
                }
            };
        },
        body: {
            appendChild() {}
        }
    },
    performance: {
        now: () => 0
    },
    requestAnimationFrame: (callback) => {
        const id = ++sequence;
        frames.set(id, callback);
        return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id)
});
vm.runInContext(readFileSync(new URL('../../src/dust.js', import.meta.url), 'utf8'), context);
const Dust = context.window.ChatWidget.DustEffects;
const row = {
    querySelectorAll: () => [
        {
            getClientRects: () => [
                {
                    left: 10,
                    right: 400,
                    top: 100,
                    bottom: 135
                }
            ]
        }
    ]
};
let count = 0;
const test = (name, fn) => {
    fn();
    console.log('PASS', name);
    count++;
};
const step = (time) => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) {
        callback(time);
    }
};
test('Moderation creates decorative particles on one canvas without copying text', () => {
    const dust = new Dust();
    dust.burst(row);
    assert.ok(dust.particles.length >= 24);
    assert.equal(created, 1);
    assert.equal(frames.size, 1);
    step(16);
    assert.ok(draws > 0);
    assert.equal(frames.size, 1);
    dust.stop();
    assert.equal(frames.size, 0);
});
test('Mass moderation uses at most 512 particles and one animation loop', () => {
    const dust = new Dust();
    const before = created;
    for (let i = 0; i < 100; i++) {
        dust.burst(row);
    }
    assert.equal(dust.particles.length, 512);
    assert.equal(created, before + 1);
    assert.equal(frames.size, 1);
    dust.stop();
});
test('Finishing the effect releases its canvas and scheduled work', () => {
    const dust = new Dust();
    const before = removed;
    dust.burst(row);
    step(1000);
    assert.equal(dust.particles.length, 0);
    assert.equal(dust.canvas, null);
    assert.equal(frames.size, 0);
    assert.equal(removed, before + 1);
});
test('Reduced motion prevents particles and cancels active effects', () => {
    reduced = true;
    const dust = new Dust();
    const before = created;
    dust.burst(row);
    assert.equal(created, before);
    assert.equal(frames.size, 0);
    reduced = false;
    dust.burst(row);
    reduced = true;
    step(16);
    assert.equal(frames.size, 0);
    assert.equal(dust.canvas, null);
    reduced = false;
});
test('Messages without visible regions do not create effects', () => {
    const dust = new Dust();
    const before = created;
    dust.burst({
        querySelectorAll: () => []
    });
    assert.equal(created, before);
    assert.equal(frames.size, 0);
});
console.log(`${count} tests PASS`);
