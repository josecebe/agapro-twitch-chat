import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';

const engine = readFileSync(new URL('../../src/i18n.js', import.meta.url), 'utf8');
function fixture(source = engine) {
    const context = vm.createContext({ window: { ChatWidget: {} } });
    vm.runInContext(source, context);
    return context.window.ChatWidget;
}

test('real catalogs have matching keys and placeholders outside core', () => {
    const core = fixture(readFileSync(new URL('../../src/core.js', import.meta.url), 'utf8'));
    assert.equal(core.i18n, undefined);
    const { i18n } = fixture(readWidgetScripts());
    i18n.validate();
    assert.equal(i18n.normalizeLanguage(' EN_us '), 'en');
    assert.equal(i18n.normalizeLanguage(), 'en');
    assert.equal(i18n.normalizeLanguage('fr'), 'en');
    assert.equal(i18n.normalizeLanguage('__proto__'), 'en');
    assert.equal(i18n.translate('es', 'replyTo'), 'respuesta a');
    assert.equal(i18n.translate('en', 'replyTo'), 'replying to');
});

test('translation falls back per key and interpolates values literally', () => {
    const { i18n } = fixture();
    i18n.register('en', { greeting: 'Hello {name}', empty: '' });
    i18n.register('es', { empty: '' });
    const { translate } = i18n;
    assert.equal(translate('es', 'greeting', { name: '$& <b>Alice</b>' }), 'Hello $& <b>Alice</b>');
    assert.equal(translate('es', 'greeting'), 'Hello {name}');
    assert.equal(translate('en', 'empty'), '');
    assert.equal(translate('en', 'constructor'), 'constructor');
    assert.equal(translate('es', 'missingKey'), 'missingKey');
});

test('locale registration validates input and keeps an immutable catalog snapshot', () => {
    const { i18n } = fixture();
    const messages = { greeting: 'Hello' };
    i18n.register('en', messages);
    messages.greeting = 'Changed';
    assert.equal(i18n.translate('en', 'greeting'), 'Hello');
    assert.throws(() => i18n.register('en', {}), /duplicate locale/);
    assert.throws(() => i18n.register('__proto__', {}), /Invalid/);
    assert.throws(() => i18n.register('fr', { greeting: 12 }), /Invalid translation catalog/);
    assert.throws(
        () => i18n.register('fr', { 'source text': 'value' }),
        /Invalid translation catalog/
    );
});

test('validation rejects missing keys, mismatched parameters, and a missing fallback locale', () => {
    const { i18n } = fixture();
    assert.throws(() => i18n.validate(), /Missing fallback locale/);
    i18n.register('es', { greeting: 'Hola {name}' });
    i18n.register('en', { greeting: 'Hello {user}' });
    assert.throws(() => i18n.validate(), /placeholders do not match: es.greeting/);
    const other = fixture().i18n;
    other.register('es', { greeting: 'Hola' });
    other.register('en', {});
    assert.throws(() => other.validate(), /keys do not match: es/);
});

test('diagnostic presentation uses semantic keys and preserves technical identifiers', () => {
    const { diagnostics } = fixture(readWidgetScripts());
    assert.equal(
        diagnostics.formatStatus(
            'en',
            'twitch:channel · connection',
            'error · JOIN was not confirmed within 20 seconds'
        ),
        'twitch:channel · connection: error · JOIN was not confirmed within 20 seconds'
    );
    assert.equal(diagnostics.formatStatus('es', 'connection', 'connected'), 'conexión: conectado');
    assert.equal(diagnostics.formatStatus('en', 'custom', '__proto__'), 'custom: __proto__');
});
