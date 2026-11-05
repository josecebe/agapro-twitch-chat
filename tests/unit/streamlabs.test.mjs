import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';

const source = readFileSync(new URL('../../src/streamlabs.js', import.meta.url), 'utf8');

function setup(readyState = 'complete', startError) {
    const listeners = new Map();
    const calls = [];
    const panel = { hidden: true, textContent: '' };
    let stops = 0;
    const sandbox = vm.createContext({
        document: {
            readyState,
            getElementById: () => panel,
            addEventListener: (name, callback) => listeners.set(name, callback),
            removeEventListener: (name) => listeners.delete(name)
        },
        window: { CHAT_WIDGET_RUNTIME: { stop: () => stops++ } }
    });
    vm.runInContext(readWidgetScripts(), sandbox);
    sandbox.window.ChatWidget.start = (config, options) => {
        if (startError) throw Error(startError);
        calls.push({ config, options });
    };
    vm.runInContext(source, sandbox);
    return {
        attach: sandbox.window.ChatWidget.attachStreamlabs,
        listeners,
        calls,
        panel,
        stops: () => stops
    };
}

test('Streamlabs starts immediately with explicit channels and preserves all configuration', () => {
    const app = setup();
    const config = {
        language: 'en',
        sources: [{ provider: 'twitch', channel: 'alpha' }],
        demo: true
    };
    const stop = app.attach(config);
    assert.equal(app.calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(app.calls[0].config)), config);
    assert.match(app.calls[0].options.emptySourcesMessage, /JS tab/);
    assert.equal(app.listeners.size, 0);
    stop();
    assert.equal(app.stops(), 1);
});

test('Streamlabs waits for the DOM and cancellation prevents a pending startup', () => {
    const app = setup('loading');
    const stop = app.attach({ language: 'es', sources: [] });
    assert.equal(app.calls.length, 0);
    const ready = app.listeners.get('DOMContentLoaded');
    stop();
    ready();
    assert.equal(app.calls.length, 0);
    assert.equal(app.listeners.size, 0);

    app.attach({ language: 'es', sources: [] });
    app.listeners.get('DOMContentLoaded')();
    assert.equal(app.calls.length, 1);
    assert.match(app.calls[0].options.emptySourcesMessage, /pestaña JS/);
});

test('Streamlabs displays startup and connection failures and clears recovered errors', () => {
    const failed = setup('complete', 'startup failure');
    failed.attach({ language: 'es' });
    assert.equal(failed.panel.hidden, false);
    assert.match(failed.panel.textContent, /No se pudo iniciar el chat: startup failure/);

    const app = setup();
    app.attach({ language: 'en', sources: [] });
    const report = app.calls[0].options.onStatus;
    const status = new Map([['configuration', 'Enter a channel']]);
    report(status, app.panel, false);
    assert.equal(app.panel.hidden, false);
    assert.match(app.panel.textContent, /Enter a channel/);
    status.clear();
    status.set('twitch:alpha · connection', 'error · blocked');
    report(status, app.panel, false);
    assert.equal(app.panel.hidden, false);
    assert.match(app.panel.textContent, /blocked/);
    status.set('twitch:alpha · connection', 'connected');
    report(status, app.panel, false);
    assert.equal(app.panel.hidden, true);
    app.panel.hidden = false;
    report(status, app.panel, true);
    assert.equal(app.panel.hidden, false);
});
