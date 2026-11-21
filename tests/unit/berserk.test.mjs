import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import prepareBerserkAssets from '../../src/templates/berserk/prepare.cjs';
import createBerserkPresentation from '../../src/templates/berserk/presentation.mjs';
import { readTemplates, compileTemplates } from '../../scripts/templates.mjs';
import { compileStyles } from '../../scripts/styles.mjs';

const { prepareBubbles: prepareBerserkBubbles } = prepareBerserkAssets;

test('Berserk prepares all PNG assets and recalculates cap dimensions when artwork changes', async () => {
    const parent = fileURLToPath(new URL('../artifacts/', import.meta.url));
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(path.join(parent, 'berserk-assets-'));
    try {
        const folder = path.join(directory, 'assets/bubbles/example');
        await mkdir(folder, { recursive: true });
        await writeFile(
            path.join(folder, 'bubble.svg'),
            '<svg viewBox="0 0 1920 1080"><path d="M0 0H1920V1080H0Z"/></svg>'
        );
        for (const name of ['tip', 'blade', 'hilt', 'texture']) {
            await copyFile(
                new URL(`../../src/templates/berserk/assets/${name}.png`, import.meta.url),
                path.join(directory, 'assets', name + '.png')
            );
        }
        const prepared = prepareBerserkAssets(directory);
        for (const name of ['_sword.scss', '_texture.scss', '_bubble.scss']) {
            assert.ok((await readFile(path.join(directory, name), 'utf8')).length > 0);
        }
        assert.ok(prepared.sources.includes(path.join(directory, 'assets/texture.png')));
        const original = await readFile(path.join(directory, '_sword.scss'), 'utf8');
        const hilt = await readFile(path.join(directory, 'assets/hilt.png'));
        await copyFile(
            path.join(directory, 'assets/hilt.png'),
            path.join(directory, 'assets/tip.png')
        );
        prepareBerserkAssets(directory);
        const updated = await readFile(path.join(directory, '_sword.scss'), 'utf8');
        assert.notEqual(updated, original);
        assert.ok(updated.includes(`$tip-width: ${hilt.readUInt32BE(16)};`));
        assert.ok(updated.includes(`$tip-height: ${hilt.readUInt32BE(20)};`));
    } finally {
        assert.equal(path.dirname(directory), path.resolve(parent));
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});

test('Berserk avoids consecutive bases, covers all flips and keeps choices on refresh', () => {
    const originalRandom = Math.random;
    const originalComputedStyle = globalThis.getComputedStyle;
    const style = () => {
        const values = new Map();
        return {
            getPropertyValue: (key) => values.get(key) || '',
            setProperty: (key, value) => values.set(key, value)
        };
    };
    try {
        for (const variants of ['1 2 3 4', 'only-one']) {
            const chat = {};
            globalThis.getComputedStyle = () => ({ getPropertyValue: () => variants });
            const theme = createBerserkPresentation({
                settings: { nameColor: '#fff', singleEmoteScale: 4, multipleEmoteScale: 2 }
            });
            const flips = new Set();
            let previous;
            for (let index = 0; index < 40; index++) {
                Math.random = () => ((index % 4) + 0.125) / 4;
                const row = {
                    dataset: {},
                    style: style(),
                    querySelector: () => null,
                    classList: { toggle() {} }
                };
                let background;
                const body = {
                    textContent: 'Message',
                    querySelectorAll: () => [],
                    querySelector: () => background,
                    prepend: (element) => {
                        background = element;
                    },
                    style: style(),
                    classList: { toggle() {}, contains: () => false },
                    closest: () => row,
                    ownerDocument: {
                        getElementById: () => chat,
                        createElement: () => ({ setAttribute() {} })
                    }
                };
                theme.styleBody(body);
                const selected = { ...row.dataset };
                flips.add(selected.berserkBubbleOrientation);
                if (previous) {
                    if (variants !== 'only-one')
                        assert.notEqual(selected.berserkBubble, previous.berserkBubble);
                    else
                        assert.notEqual(
                            selected.berserkBubbleOrientation,
                            previous.berserkBubbleOrientation
                        );
                }
                Math.random = () => {
                    throw Error('A refresh must not reroll the bubble');
                };
                theme.styleBody(body);
                assert.deepEqual(row.dataset, selected);
                previous = selected;
            }
            assert.deepEqual([...flips].sort(), ['both', 'horizontal', 'normal', 'vertical']);
        }
    } finally {
        Math.random = originalRandom;
        if (originalComputedStyle === undefined) delete globalThis.getComputedStyle;
        else globalThis.getComputedStyle = originalComputedStyle;
    }
});

test('Berserk discovers and slices any number of bubble folders, including newly added styles', async () => {
    const parent = fileURLToPath(new URL('../artifacts/', import.meta.url));
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(path.join(parent, 'bubble-discovery-'));
    try {
        const add = async (id, width = 1920, height = 1080) => {
            const folder = path.join(directory, 'assets/bubbles', id);
            await mkdir(folder, { recursive: true });
            await writeFile(
                path.join(folder, 'bubble.svg'),
                `<svg viewBox="0 0 ${width} ${height}"><path d="M0 0H${width}V${height}H0Z"/></svg>`
            );
        };
        await Promise.all(Array.from({ length: 64 }, (_, index) => add('style-' + index)));
        assert.equal(prepareBerserkBubbles(directory).variants.length, 64);
        await add('new-style', 960, 540);
        const result = prepareBerserkBubbles(directory);
        assert.equal(result.variants.length, 65);
        assert.ok(result.variants.includes('new-style'));
        const top = await readFile(
            path.join(directory, 'assets/bubbles/new-style/bubble-top.svg'),
            'utf8'
        );
        assert.match(top, /viewBox="61 0 838 64"/);
        const generated = await readFile(path.join(directory, '_bubble.scss'), 'utf8');
        assert.ok(generated.includes('data-berserk-bubble="style-63"'));
        assert.ok(
            generated.includes('data-berserk-bubble="new-style"') ||
                generated.includes('--berserk-bubble-variants: new-style ')
        );
    } finally {
        assert.equal(path.dirname(directory), path.resolve(parent));
        await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
});

test('Berserk compiles independently without Bubble Chat styles or presentation', () => {
    const templates = readTemplates().filter(({ config }) => config.id !== 'bubble-chat');
    const berserk = templates.find(({ config }) => config.id === 'berserk');
    assert.ok(berserk);
    assert.ok(Object.keys(berserk.config.variables).every((key) => key.startsWith('--berserk-')));
    const bundle = compileTemplates({ templates });
    const styles = compileStyles({ templates });
    assert.ok(bundle.sources.every((file) => !file.includes('bubble-chat')));
    assert.ok(styles.loadedUrls.every((url) => !url.pathname.includes('/bubble-chat/')));
    assert.doesNotMatch(styles.css, /--bubble-|bubble-painted|bubble-single-emote/);
    const sandbox = vm.createContext({ window: { ChatWidget: {} } });
    vm.runInContext(bundle.code, sandbox);
    assert.equal(sandbox.window.ChatWidget.templates.get('berserk').authorColor(), '#ffffff');
});
