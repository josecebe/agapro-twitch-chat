import { artifactPath } from '../helpers/artifacts.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const browser = await browserSession();
try {
    await browser.send('Runtime.enable');
    await browser.send('Emulation.setEmulatedMedia', {
        features: [
            {
                name: 'prefers-reduced-motion',
                value: 'no-preference'
            }
        ]
    });
    await browser.send('Page.navigate', {
        url: pathToFileURL(path.resolve('diagnostics.html')).href
    });
    for (
        let i = 0;
        i < 40 &&
        !(await browser.evaluate(
            "!!window.CHAT_WIDGET_RUNTIME && !!document.getElementById('widget-styles').sheet"
        ));
        i++
    ) {
        await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(await browser.evaluate('!!window.CHAT_WIDGET_RUNTIME'), browser.errors.join('\n'));
    assert.deepEqual(
        await browser.evaluate(`({language:CHAT_WIDGET_RUNTIME.config.language,
            pageLanguage:document.documentElement.lang,
            chatLabel:document.getElementById('chat').getAttribute('aria-label'),
            redirected:location.pathname.endsWith('/index.html') && location.search==='?debug=1'})`),
        { language: 'en', pageLanguage: 'en', chatLabel: 'Live chat', redirected: true }
    );
    const art = (await readFile('tests/fixtures/character-art-cropped.txt', 'utf8')).trimEnd();
    const result = await browser.evaluate(`
(async () => {
    const { renderer: r, connections } = CHAT_WIDGET_RUNTIME;
    for (const connection of connections) {
        connection.stop();
    }
    clearInterval(r.tick);
    for (const row of [...r.rows]) {
        r.remove(row);
    }
    let cosmetics = 0;
    r.paints.getCosmetics = () => {
        cosmetics++;
        return Promise.resolve(null);
    };
    const before = r.rows.length;
    r.add({
        tags: {
            id: 'art-filter-live',
            'user-id': '1234'
        },
        prefix: 'filterprobe!x',
        params: ['#demo', ${JSON.stringify(art)}]
    });
    const filtered = r.rows.length === before && cosmetics === 0;
    r.config.showSevenTVPaints = false;
    r.config.showSevenTVBadges = false;
    r.config.messageLifetimeSeconds = 1;
    r.config.enableAnimations = true;
    document.body.classList.add('animated');
    r.add({
        tags: {
            id: 'expiry-live',
            'display-name': 'Sample'
        },
        prefix: 'test!x',
        params: ['#demo', 'Expiry sample']
    });
    const record = r.rows.at(-1);
    record.time = Date.now() - 1100;
    r.expire();
    const animation = getComputedStyle(record.row).animationName;
    const stillPresent = record.row.isConnected;
    await new Promise((resolve) => setTimeout(resolve, 120));
    const opacity = Number(getComputedStyle(record.row).opacity);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
        filtered,
        cosmeticsDuringArt: cosmetics,
        animation,
        stillPresent,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        stylesheetReady: !!document.getElementById('widget-styles').sheet,
        messageClasses: record.row.className,
        opacityDuringExit: opacity,
        removed: !record.row.isConnected,
        scripts: [...document.scripts].map((s) => s.src).filter(Boolean),
        stylesheet: document.getElementById('widget-styles').href
    };
})();
`);
    assert.ok(result.filtered);
    assert.equal(result.animation, 'disappear', JSON.stringify(result));
    assert.ok(result.stillPresent);
    assert.ok(result.opacityDuringExit < 1);
    assert.ok(result.removed);
    assert.ok(result.scripts.every((src) => new URL(src).searchParams.has('v')));
    console.log(
        'PASS character-art filtering, fresh scripts, English diagnostics and TTL exit',
        JSON.stringify(result)
    );
    await writeFile(
        await artifactPath('ui-lifecycle-results.json'),
        JSON.stringify(result, null, 4) + '\n'
    );
} finally {
    await browser.close();
}
