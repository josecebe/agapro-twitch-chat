import { artifactPath } from '../helpers/artifacts.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await browserSession();
try {
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 500,
        height: 400,
        deviceScaleFactor: 1,
        mobile: false
    });
    await browser.send('Page.navigate', {
        url: pathToFileURL(path.resolve('index.html')).href
    });
    for (let i = 0; i < 40 && !(await browser.evaluate('!!window.CHAT_WIDGET_RUNTIME')); i++) {
        await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(await browser.evaluate('!!window.CHAT_WIDGET_RUNTIME'));
    await browser.evaluate(`
(() => {
    const { renderer: r, connections } = CHAT_WIDGET_RUNTIME;
    for (const connection of connections) {
        connection.stop();
    }
    clearInterval(r.tick);
    for (const row of [...r.rows]) {
        r.remove(row);
    }
    Object.assign(r.config, {
        showBadges: false,
        showSevenTVBadges: false,
        showSevenTVPaints: false,
        messageLifetimeSeconds: 0,
        enableAnimations: true,
        moderationAnimation: 'dust'
    });
    r.add({
        tags: {
            id: 'dust-demo',
            'display-name': 'Usuario',
            color: '#bd85ff'
        },
        prefix: 'sample!x',
        params: ['#demo', 'This sample message turns into dust.']
    });
})();
`);
    await new Promise((r) => setTimeout(r, 250));
    const before = await browser.send('Page.captureScreenshot', {
        format: 'png'
    });
    await writeFile(await artifactPath('dust-before.png'), Buffer.from(before.data, 'base64'));
    const result = await browser.evaluate(`
(async () => {
    const r = CHAT_WIDGET_RUNTIME.renderer;
    r.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'dust-demo'
        },
        params: []
    });
    const removedImmediately =
        r.rows.length === 0 &&
        !document.getElementById('chat').textContent.includes('This message');
    await new Promise((resolve) => setTimeout(resolve, 90));
    const canvas = document.querySelector('.dust-layer');
    const pixels = canvas?.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    if (pixels) {
        for (let i = 3; i < pixels.length; i += 4) {
            if (pixels[i]) {
                painted++;
            }
        }
    }
    return {
        removedImmediately,
        canvasVisible: !!canvas,
        particles: r.dust?.particles.length,
        paintedPixels: painted
    };
})();
`);
    const during = await browser.send('Page.captureScreenshot', {
        format: 'png'
    });
    await writeFile(await artifactPath('dust-during.png'), Buffer.from(during.data, 'base64'));
    assert.ok(result.removedImmediately);
    assert.ok(result.canvasVisible);
    assert.ok(result.particles > 0 && result.particles <= 512);
    assert.ok(result.paintedPixels > 0);
    await new Promise((r) => setTimeout(r, 800));
    result.cleaned = await browser.evaluate(
        `!document.querySelector('.dust-layer')&&CHAT_WIDGET_RUNTIME.renderer.dust.particles.length===0`
    );
    assert.ok(result.cleaned);
    await browser.send('Emulation.setEmulatedMedia', {
        features: [
            {
                name: 'prefers-reduced-motion',
                value: 'reduce'
            }
        ]
    });
    result.reducedMotion = await browser.evaluate(`
(() => {
    const r = CHAT_WIDGET_RUNTIME.renderer;
    r.add({
        tags: {
            id: 'dust-reduced'
        },
        prefix: 'sample!x',
        params: ['#demo', 'Movimiento reducido']
    });
    r.moderate({
        command: 'CLEARMSG',
        tags: {
            'target-msg-id': 'dust-reduced'
        },
        params: []
    });
    return !document.querySelector('.dust-layer') && r.rows.length === 0;
})();
`);
    assert.ok(result.reducedMotion);
    await writeFile(
        await artifactPath('dust-browser-results.json'),
        JSON.stringify(result, null, 4) + '\n'
    );
    console.log('PASS deletion, real particles and cleanup', JSON.stringify(result));
} finally {
    await browser.close();
}
