import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { readTemplates, compileTemplates, templateOptions } from '../../scripts/templates.mjs';
import { compileStyles } from '../../scripts/styles.mjs';
import { createFields } from '../../scripts/fields.mjs';
import { createRegistry } from '../../src/templates/registry.mjs';

test('80 independently configured templates register, compile styles and populate Fields without core changes', async () => {
    const parent = fileURLToPath(new URL('../artifacts/', import.meta.url));
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(path.join(parent, 'chat-template-catalog-'));
    try {
        await Promise.all(
            Array.from({ length: 80 }, async (_, index) => {
                const id = 'template-' + String(index).padStart(2, '0');
                const directory = path.join(root, id);
                await mkdir(directory);
                await writeFile(
                    path.join(directory, 'config.json'),
                    JSON.stringify({
                        id,
                        name: 'Template ' + index,
                        order: index,
                        default: index === 0,
                        presentation: { glyphSpacing: index % 2 === 0, paintActionText: true },
                        settings: { color: 'rgb(' + index + ',0,0)' },
                        variables: { '--template-accent': 'rgb(' + index + ',0,0)' }
                    })
                );
                await writeFile(
                    path.join(directory, 'presentation.mjs'),
                    'export default config => ({authorColor() { return config.settings.color; }});'
                );
                await writeFile(
                    path.join(directory, 'style.scss'),
                    '#chat[data-template="' + id + '"] .body {color:var(--template-accent)}'
                );
            })
        );
        const catalog = readTemplates(root);
        assert.equal(catalog.length, 80);
        const options = templateOptions(catalog);
        assert.equal(Object.keys(options).length, 80);
        const fields = createFields(
            { sources: [], template: 'template-00' },
            { templates: catalog }
        ).fields;
        assert.deepEqual(fields.template.options, options);
        assert.deepEqual(Object.keys(fields), ['channelMode', 'customChannels', 'template']);
        const bundle = compileTemplates({ templates: catalog });
        const sandbox = vm.createContext({ window: { ChatWidget: {} } });
        vm.runInContext(bundle.code, sandbox);
        const registry = sandbox.window.ChatWidget.templates;
        assert.equal(registry.list().length, 80);
        for (let i = 0; i < 80; i++) {
            const id = 'template-' + String(i).padStart(2, '0');
            assert.equal(registry.get(id).id, id);
            assert.equal(registry.get(id).authorColor(), 'rgb(' + i + ',0,0)');
            assert.equal(registry.get(id).glyphSpacing, i % 2 === 0);
        }
        assert.equal(registry.get('unknown').id, 'template-00');
        assert.equal(registry.get('__proto__').id, 'template-00');
        assert.ok(
            !bundle.code.includes('--template-accent'),
            'CSS config must not be duplicated in runtime JS'
        );
        const css = compileStyles({ templates: catalog }).css;
        for (const { config } of catalog) assert.ok(css.includes(config.id), config.id);
        assert.ok(css.includes('rgb(79,0,0)'));
        assert.equal(bundle.sources.filter((file) => file.endsWith('config.json')).length, 80);
    } finally {
        assert.equal(path.dirname(root), path.resolve(parent));
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});

test('registry rejects duplicates and non-presentation hooks and keeps the default explicit', () => {
    const registry = createRegistry('base');
    assert.throws(() => registry.get('unknown'), /Default template/);
    registry.register({ id: 'base', name: 'Base' });
    assert.throws(() => registry.register({ id: 'base', name: 'Again' }), /Duplicate/);
    assert.throws(
        () => registry.register({ id: 'other', name: 'Other' }, { connect() {} }),
        /presentation hook/
    );
    assert.equal(registry.get('unknown').id, 'base');
    assert.equal(registry.list().length, 1);
    assert.equal(Object.isFrozen(registry.get('base')), true);
});

test('catalog rejects shared chat settings inside template config', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chat-template-invalid-'));
    try {
        const directory = path.join(root, 'sample');
        await mkdir(directory);
        await writeFile(
            path.join(directory, 'config.json'),
            JSON.stringify({
                id: 'sample',
                name: 'Sample',
                default: true,
                sources: [{ channel: 'should-not-be-here' }]
            })
        );
        assert.throws(() => readTemplates(root), /Unknown template config key: sources/);
    } finally {
        assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
        await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});
