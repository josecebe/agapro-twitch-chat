import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let reduced = false;
let created = 0;
let sequence = 0;
const frames = new Map();
const draws = [];
const drawing = {
    setTransform() {},
    clearRect() {},
    beginPath() {},
    fill() {},
    ellipse(x, y, rx, ry, angle) {
        draws.push({ x, y, rx, ry, angle, color: this.fillStyle });
    }
};
const sandbox = vm.createContext({
    window: {
        ChatWidget: {},
        innerWidth: 600,
        innerHeight: 500,
        matchMedia: () => ({
            get matches() {
                return reduced;
            }
        }),
        getComputedStyle: () => ({ color: '#ffffff' })
    },
    document: {
        createElement() {
            created++;
            return { setAttribute() {}, getContext: () => drawing, remove() {} };
        },
        body: { appendChild() {} }
    },
    performance: { now: () => 0 },
    requestAnimationFrame: (callback) => {
        const id = ++sequence;
        frames.set(id, callback);
        return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id)
});
for (const name of ['dust', 'blood'])
    vm.runInContext(
        readFileSync(new URL(`../../src/${name}.js`, import.meta.url), 'utf8'),
        sandbox
    );
const Blood = sandbox.window.ChatWidget.BloodEffects;
const row = {
    get textContent() {
        throw Error('Do not retain removed text');
    },
    querySelectorAll(selector) {
        assert.equal(selector, '.body');
        return [{ getClientRects: () => [{ left: 20, right: 420, top: 100, bottom: 170 }] }];
    }
};
const step = (time) => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
};
let tests = 0;
const test = (name, fn) => {
    fn();
    tests++;
    console.log('PASS', name);
};

test('Blood uses red droplets from body geometry without retaining message content', () => {
    const effect = new Blood();
    effect.burst(row);
    assert.ok(effect.particles.length >= 48 && effect.particles.length <= 128);
    for (const particle of effect.particles) {
        assert.ok(particle.x >= 20 && particle.x <= 420);
        const red = parseInt(particle.color.slice(1, 3), 16),
            green = parseInt(particle.color.slice(3, 5), 16);
        assert.ok(red > green * 2);
    }
    step(100);
    assert.ok(draws.length > 0);
    assert.ok(draws.every((drop) => drop.rx >= drop.ry && drop.ry > 0));
    effect.stop();
});
test('Blood droplets fall with gravity and expire without leaving a canvas or frame', () => {
    const effect = new Blood();
    effect.burst(row);
    effect.particles = [
        { x: 200, y: 100, vx: 0, vy: 0, size: 4, color: '#9e101d', born: 0, life: 1200 }
    ];
    draws.length = 0;
    step(0);
    step(300);
    assert.ok(draws[1].y > draws[0].y);
    step(2000);
    assert.equal(effect.canvas, null);
    assert.equal(effect.particles.length, 0);
    assert.equal(frames.size, 0);
});
test('Mass blood bursts share one canvas and one loop with at most 512 droplets', () => {
    const effect = new Blood();
    const before = created;
    for (let index = 0; index < 100; index++) effect.burst(row);
    assert.equal(effect.particles.length, 512);
    assert.equal(created, before + 1);
    assert.equal(frames.size, 1);
    effect.stop();
    assert.equal(frames.size, 0);
});
test('Blood honours reduced motion before and during its animation', () => {
    const effect = new Blood();
    const before = created;
    reduced = true;
    effect.burst(row);
    assert.equal(created, before);
    reduced = false;
    effect.burst(row);
    reduced = true;
    step(50);
    assert.equal(effect.canvas, null);
    assert.equal(frames.size, 0);
    reduced = false;
});
console.log(`${tests} tests PASS`);
