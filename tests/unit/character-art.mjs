import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const context = vm.createContext({
    window: {}
});
vm.runInContext(readFileSync(new URL('../../src/core.js', import.meta.url), 'utf8'), context);
const A = context.window.ChatWidget;
const options = {
    enabled: true,
    minChars: 200,
    minDrawingRatio: 0.8,
    minRun: 80,
    minSimilarLines: 4
};
let count = 0;
const test = (name, fn) => {
    fn();
    console.log('PASS', name);
    count++;
};
test('Filters long braille copypasta, including braille spaces in mosaics', () =>
    assert.equal(A.isLargeCharacterArt('⣿⣿⠿⠛⠉⠀⠀⣀⣤⣶'.repeat(30), options), true));
test('Filters long runs of Unicode blocks and borders', () => {
    assert.ok(A.isLargeCharacterArt('█'.repeat(200), options));
    assert.ok(A.isLargeCharacterArt('─'.repeat(200), options));
});
const grid = Array.from(
    {
        length: 8
    },
    () => ('⣿'.repeat(15) + ' ').repeat(2)
).join('\n');
test('Filters grids of similar lines without requiring a long run', () =>
    assert.ok(A.isLargeCharacterArt(grid, options)));
test('Accepts CRLF and Unicode separators without counting CRLF twice', () => {
    assert.ok(A.isLargeCharacterArt(grid.replaceAll('\n', '\r\n'), options));
    assert.ok(A.isLargeCharacterArt(grid.replaceAll('\n', '\u2028'), options));
});
test('Preserves short braille, decorative borders and small drawings', () => {
    for (const text of ['⠓⠑⠇⠇⠕ ⠺⠕⠗⠇⠙', '⣿'.repeat(199), '┌────────┐\n│ Hola │\n└────────┘']) {
        assert.equal(A.isLargeCharacterArt(text, options), false);
    }
});
test('Preserves long braille words without grids or huge runs', () =>
    assert.equal(A.isLargeCharacterArt('⠓⠑⠇⠇⠕ ⠺⠕⠗⠇⠙ '.repeat(30), options), false));
test('Preserves long ordinary text, Unicode scripts and emote sequences', () => {
    for (const text of [
        'Un mensaje normal con tildes, ñ y signos. '.repeat(15),
        '😀🎉 日本語 العربية '.repeat(30),
        'Kappa PogU RainTime '.repeat(30),
        'A'.repeat(10000)
    ]) {
        assert.equal(A.isLargeCharacterArt(text, options), false);
    }
});
test('Requires minimum length and a drawing ratio strictly above 80 percent', () => {
    assert.equal(A.isLargeCharacterArt('█'.repeat(160) + 'a'.repeat(40), options), false);
    assert.equal(A.isLargeCharacterArt('█'.repeat(161) + 'a'.repeat(39), options), true);
    assert.equal(A.isLargeCharacterArt('█'.repeat(199) + ' '.repeat(1000), options), false);
});
test('Requires a long run or grid in addition to a high drawing ratio', () =>
    assert.equal(A.isLargeCharacterArt(('⣿'.repeat(6) + ' ').repeat(40), options), false));
test('Requires similar line widths and sufficient content', () => {
    const text = [20, 35, 50, 65, 70].map((n) => '█'.repeat(n)).join('\n');
    assert.equal(A.isLargeCharacterArt(text, options), false);
});
test('Disabled or missing configuration preserves the message', () => {
    assert.equal(
        A.isLargeCharacterArt('█'.repeat(500), {
            ...options,
            enabled: false
        }),
        false
    );
    assert.equal(A.isLargeCharacterArt('█'.repeat(500)), false);
    assert.equal(A.isLargeCharacterArt('█'.repeat(500), null), false);
});
test('Supports custom thresholds and safe defaults for non-finite values', () => {
    assert.ok(
        A.isLargeCharacterArt('█'.repeat(100), {
            ...options,
            minChars: 100
        })
    );
    assert.equal(
        A.isLargeCharacterArt('█'.repeat(300), {
            ...options,
            minChars: 400
        }),
        false
    );
    assert.ok(
        A.isLargeCharacterArt('█'.repeat(300), {
            enabled: true,
            minChars: NaN,
            minRun: Infinity,
            minDrawingRatio: NaN
        })
    );
});
test('Character art filtering works with bots, commands and ACTION messages', () => {
    const config = {
        characterArtFilter: options
    };
    assert.ok(A.hideMessage(config, 'viewer', '\x01ACTION ' + '█'.repeat(300) + '\x01'));
    assert.equal(A.hideMessage(config, 'viewer', 'Hola'), false);
    assert.equal(
        A.hideMessage(
            {
                ...config,
                characterArtFilter: {
                    enabled: false
                }
            },
            'viewer',
            '█'.repeat(300)
        ),
        false
    );
});
test('Scans each character once without message-sized temporary lists', () => {
    let iterations = 0;
    let visited = 0;
    const text = '⣿'.repeat(200000);
    const iterable = {
        length: text.length,
        *[Symbol.iterator]() {
            iterations++;
            for (const char of text) {
                visited++;
                yield char;
            }
        }
    };
    assert.ok(A.isLargeCharacterArt(iterable, options));
    assert.equal(iterations, 1);
    assert.equal(visited, text.length);
});
const pastedArt = readFileSync(
    new URL('../fixtures/character-art-flattened.txt', import.meta.url),
    'utf8'
).trimEnd();
const croppedArt = readFileSync(
    new URL('../fixtures/character-art-cropped.txt', import.meta.url),
    'utf8'
).trimEnd();
test('Regression: filters the cropped mosaic sample', () =>
    assert.ok(A.isLargeCharacterArt(croppedArt, options)));
test('Regression: filters the exact flattened mosaic drawing', () =>
    assert.ok(A.isLargeCharacterArt(pastedArt, options)));
test('Regression: spaces, tabs and NBSP do not conceal the mosaic', () => {
    for (const separator of [' ', '  ', '\t', '\u00a0']) {
        assert.ok(A.isLargeCharacterArt(pastedArt.replaceAll(' ', separator), options));
    }
});
test('Recognizes drawing rows separated by spaces as a grid', () =>
    assert.ok(A.isLargeCharacterArt(('⣿'.repeat(20) + ' ').repeat(12), options)));
test('Short blocks and inconsistent row widths do not trigger filtering', () => {
    assert.equal(A.isLargeCharacterArt('⠓⠑⠇⠇⠕ ⠺⠕⠗⠇⠙ '.repeat(30), options), false);
    assert.equal(
        A.isLargeCharacterArt([20, 35, 50, 65, 70].map((n) => '█'.repeat(n)).join(' '), options),
        false
    );
});
test('The real sample respects disabled filtering and custom thresholds', () => {
    assert.equal(
        A.isLargeCharacterArt(pastedArt, {
            ...options,
            enabled: false
        }),
        false
    );
    assert.equal(
        A.isLargeCharacterArt(pastedArt, {
            ...options,
            minChars: 1000
        }),
        false
    );
    assert.ok(
        A.hideMessage(
            {
                characterArtFilter: options
            },
            'samplehost',
            pastedArt
        )
    );
});
console.log(`${count} tests PASS`);
