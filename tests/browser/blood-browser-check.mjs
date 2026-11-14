import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { compileStyles } from '../../scripts/styles.mjs';
import { readConfig } from '../../scripts/build.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import { artifactPath } from '../helpers/artifacts.mjs';

const defaults = await readConfig();
const browser = await browserSession();
try {
    await browser.send('Page.enable');
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 700,
        height: 650,
        deviceScaleFactor: 1,
        mobile: false
    });
    await browser.evaluate(`(() => {
        document.head.innerHTML = '<style></style>';
        document.querySelector('style').textContent = ${JSON.stringify(compileStyles().css)};
        document.body.innerHTML = '<main id="chat"></main><pre id="diagnostics" hidden></pre>';
        document.documentElement.style.setProperty('background-color','#23272c','important');
        window.testConfig = ${JSON.stringify({ ...defaults, template: 'berserk', sources: [], enableAnimations: true, moderationAnimation: 'blood', googleFont: '', usernameGoogleFont: '', textGoogleFont: '' })};
        let seed=13847;
        Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
        // Step particle frames explicitly for reproducible screenshots.
        window.testFrames = new Map();
        let sequence = 0;
        window.requestAnimationFrame = callback => {const id=++sequence;testFrames.set(id,callback);return id;};
        window.cancelAnimationFrame = id => testFrames.delete(id);
        window.stepParticles = time => {const callbacks=[...testFrames.values()];testFrames.clear();callbacks.forEach(callback=>callback(time));};
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'dust', 'blood', 'renderer', 'main']));
    await browser.evaluate(`(async () => {
        ChatWidget.start(testConfig);
        document.getElementById('diagnostics').hidden = true;
        const runtime = CHAT_WIDGET_RUNTIME;
        runtime.paints.getCosmetics = async () => null;
        const renderer = runtime.renderer;
        window.addBloodMessage = id => renderer.add({prefix:'guts!test',tags:{id,'display-name':'Guts',color:'#8c1525'},params:['#test','Un mensaje que desaparece en una explosión de sangre.']});
        addBloodMessage('blood-demo');
        await document.fonts.ready;
        renderer.fit();
        window.settled = true;
    })()`);
    await writeFile(
        await artifactPath('blood-before.png'),
        Buffer.from(
            (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
            'base64'
        )
    );
    const burst = await browser.evaluate(`(() => {
        const renderer = CHAT_WIDGET_RUNTIME.renderer;
        renderer.moderate({command:'CLEARMSG',tags:{'target-msg-id':'blood-demo'},params:[]});
        const effect = renderer.removalEffects;
        stepParticles(effect.particles[0].born + 130);
        const pixels = effect.context.getImageData(0,0,effect.canvas.width,effect.canvas.height).data;
        let redPixels = 0, otherPixels = 0;
        for(let index=0;index<pixels.length;index+=4) if(pixels[index+3] > 8) {
            if(pixels[index]>pixels[index+1]*1.5 && pixels[index]>pixels[index+2]*1.5) redPixels++;
            else otherPixels++;
        }
        return {removed:renderer.rows.length===0 && !document.getElementById('chat').textContent.trim(),
            canvases:document.querySelectorAll('.blood-layer').length,particles:effect.particles.length,
            frames:testFrames.size,redPixels,otherPixels};
    })()`);
    assert.equal(burst.removed, true);
    assert.equal(burst.canvases, 1);
    assert.ok(burst.particles >= 48 && burst.particles <= 128);
    assert.equal(burst.frames, 1);
    assert.ok(burst.redPixels > 100);
    assert.equal(burst.otherPixels, 0);
    await writeFile(
        await artifactPath('blood-during.png'),
        Buffer.from(
            (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
            'base64'
        )
    );
    const lifecycle = await browser.evaluate(`(() => {
        const renderer=CHAT_WIDGET_RUNTIME.renderer;
        const effect=renderer.removalEffects;
        stepParticles(effect.particles[0].born + 2500);
        const cleaned=!document.querySelector('.blood-layer') && testFrames.size===0;
        addBloodMessage('ttl');renderer.config.messageLifetimeSeconds=1;
        renderer.rows[0].time-=2000;renderer.expire();
        const expired=renderer.rows.length===0 && document.querySelectorAll('.blood-layer').length===1;
        renderer.stop();
        return {cleaned,expired,stopped:!document.querySelector('.blood-layer') && testFrames.size===0};
    })()`);
    assert.deepEqual(lifecycle, { cleaned: true, expired: true, stopped: true });
    await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    const reduced = await browser.evaluate(`(() => {
        addBloodMessage('reduced');
        const renderer=CHAT_WIDGET_RUNTIME.renderer;
        renderer.removeModerated(renderer.rows.slice());
        return renderer.rows.length===0 && !document.querySelector('.blood-layer') && testFrames.size===0;
    })()`);
    assert.equal(reduced, true);
    assert.deepEqual(browser.errors, []);
    console.log(
        'PASS blood bursts remove content immediately, draw red droplets and clean up on expiry, stop and reduced motion'
    );
} finally {
    await browser.close();
}
