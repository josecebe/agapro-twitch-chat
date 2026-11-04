import { artifactPath } from '../helpers/artifacts.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await browserSession();
try {
    await browser.send('Runtime.enable');
    await browser.send('Page.navigate', {
        url: pathToFileURL(path.resolve('index.html')).href
    });
    for (let i = 0; i < 40 && !(await browser.evaluate('!!window.CHAT_WIDGET_RUNTIME')); i++) {
        await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(await browser.evaluate('!!window.CHAT_WIDGET_RUNTIME'), browser.errors.join('\n'));
    await browser.evaluate(`
(() => {
    window.sourceCounts = {};
    const r = CHAT_WIDGET_RUNTIME.renderer;
    const add = r.add.bind(r);
    r.add = (m) => {
        sourceCounts[m.sourceId] = (sourceCounts[m.sourceId] || 0) + 1;
        add(m);
    };
})();
`);
    await new Promise((r) => setTimeout(r, 18000));
    const result = await browser.evaluate(`
({
    sources: CHAT_WIDGET_RUNTIME.sources.map((s) => ({
        id: s.id,
        provider: s.provider,
        channel: s.channel,
        status: CHAT_WIDGET_RUNTIME.status.get(s.id + ' · connection'),
        channelId: s.assets.channelId,
        received: sourceCounts[s.id] || 0
    })),
    connections: CHAT_WIDGET_RUNTIME.connections.length,
    visibleSources: [...new Set(CHAT_WIDGET_RUNTIME.renderer.rows.map((r) => r.sourceId))],
    assetIsolation: CHAT_WIDGET_RUNTIME.sources.every(
        (s) => CHAT_WIDGET_RUNTIME.renderer.assetsFor(s.provider, s.id) === s.assets
    )
});
`);
    console.log(JSON.stringify(result));
    assert.ok(result.sources.length >= 2);
    assert.equal(result.connections, result.sources.length);
    assert.ok(result.assetIsolation);
    assert.ok(result.sources.every((s) => s.status?.startsWith('connected')));
    assert.ok(result.sources.every((s) => s.received > 0));
    assert.equal(browser.errors.length, 0, browser.errors.join('\n'));
    await writeFile(
        await artifactPath('sources-live.json'),
        JSON.stringify(result, null, 4) + '\n'
    );
} finally {
    await browser.close();
}
