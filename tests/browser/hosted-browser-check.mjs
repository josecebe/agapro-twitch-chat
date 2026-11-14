import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildProject } from '../../scripts/build.mjs';
import { browserSession } from '../helpers/browser-session.mjs';

const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-widget-hosted-'));
let browser;
try {
    await buildProject({ outputDirectory, hostedBaseURL: 'https://widget.test/' });
    const loader = await readFile(
        path.join(outputDirectory, 'streamelements-hosted/index.js'),
        'utf8'
    );
    browser = await browserSession();
    const requests = [];
    browser.on('Fetch.requestPaused', async ({ requestId, request }) => {
        const url = new URL(request.url);
        assert.equal(url.origin, 'https://widget.test');
        requests.push(url.pathname);
        const name = url.pathname.slice(1);
        assert.ok(!name.includes('..'));
        const bytes = await readFile(path.join(outputDirectory, 'web', name));
        const type = name.endsWith('.json')
            ? 'application/json'
            : name.endsWith('.css')
              ? 'text/css'
              : name.endsWith('.js')
                ? 'application/javascript'
                : name.endsWith('.svg')
                  ? 'image/svg+xml'
                  : 'image/png';
        await browser.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [
                { name: 'Content-Type', value: type },
                { name: 'Access-Control-Allow-Origin', value: '*' }
            ],
            body: bytes.toString('base64')
        });
    });
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
    await browser.evaluate(`(() => {
        document.body.innerHTML='<main id="chat"></main><pre id="diagnostics"></pre>';
        window.starts=0;
        let runtime;
        Object.defineProperty(window,'CHAT_WIDGET_RUNTIME',{get:()=>runtime,set:value=>{runtime=value;starts++;}});
        ${loader}
        const fields={channelMode:'custom',customChannels:'',template:'berserk',enableAnimations:'false',
            googleFont:'',usernameGoogleFont:'',textGoogleFont:'',fontFamily:'Arial',usernameFontFamily:'Arial',textFontFamily:'Arial'};
        window.dispatchEvent(new CustomEvent('onWidgetLoad',{detail:{fieldData:{...fields,messageGapPx:15}}}));
        window.dispatchEvent(new CustomEvent('onWidgetLoad',{detail:{fieldData:{...fields,messageGapPx:37}}}));
    })()`);
    const deadline = Date.now() + 15000;
    while (!(await browser.evaluate('!!window.CHAT_WIDGET_RUNTIME'))) {
        if (Date.now() > deadline) throw Error('Hosted widget failed to start');
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const result = await browser.evaluate(String.raw`(async () => {
        const runtime=CHAT_WIDGET_RUNTIME;
        runtime.paints.getCosmetics=async()=>null;
        runtime.renderer.add({prefix:'guts!test',tags:{id:'hosted','display-name':'Guts'},params:['#test','Hosted blood bubble']});
        const layer=runtime.renderer.rows[0].body.querySelector('.berserk-bubble-background');
        const style=getComputedStyle(layer,'::before');
        const urls=[style.backgroundImage,style.maskImage,getComputedStyle(runtime.renderer.rows[0].row,'::after').backgroundImage].join(',');
        await Promise.all([...urls.matchAll(/url\("([^\"]+)"\)/g)].map(async match=>{const image=new Image();image.src=match[1];await image.decode();}));
        return {starts:window.starts,gap:runtime.config.messageGapPx,
            image:style.backgroundImage,mask:style.maskImage.slice(0,100),
            sheet:!!document.querySelector('link[rel=stylesheet]').sheet,
            local:runtime.renderer.rows[0].body.getBoundingClientRect().width>0};
    })()`);
    assert.equal(result.starts, 1, 'Only the latest buffered settings start the widget');
    assert.equal(result.gap, 37);
    assert.equal(result.sheet, true);
    assert.equal(result.local, true);
    assert.match(result.image, /https:\/\/widget.test\/assets\//);
    assert.match(result.mask, /https:\/\/widget.test\/assets\//);
    assert.equal(requests.filter((name) => name === '/manifest.json').length, 1);
    assert.ok(requests.some((name) => name.endsWith('.svg')));
    assert.ok(requests.some((name) => name.endsWith('.png')));
    await browser.evaluate(
        `window.dispatchEvent(new CustomEvent('onWidgetLoad',{detail:{fieldData:{channelMode:'custom',customChannels:'',template:'classic',googleFont:'',usernameGoogleFont:'',textGoogleFont:''}}}))`
    );
    assert.equal(await browser.evaluate('CHAT_WIDGET_RUNTIME.config.template'), 'classic');
    assert.equal(await browser.evaluate('window.starts'), 2);
    const hostedPaint = await browser.evaluate(`(() => {
        const {renderer,paints}=CHAT_WIDGET_RUNTIME;paints.getCosmetics=async()=>null;
        renderer.add({prefix:'paint!test',tags:{id:'paint','display-name':'Paint'},params:['#test','Shadow']});
        renderer.applyPaint(renderer.rows[0].name,{backgroundImage:'linear-gradient(90deg,red,gold)',filter:''});
        return getComputedStyle(renderer.rows[0].name).filter;
    })()`);
    assert.match(hostedPaint, /data:image\/svg\+xml/);
    assert.match(hostedPaint, /#s/);
    assert.deepEqual(browser.errors, []);

    await browser.close();
    browser = await browserSession();
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
    browser.on('Fetch.requestPaused', async ({ requestId }) => {
        await browser.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 503,
            responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }],
            body: ''
        });
    });
    await browser.evaluate(`(() => {
        document.body.innerHTML='<main id="chat"></main><pre id="diagnostics"></pre>';
        window.loadEvents=0;window.addEventListener('onWidgetLoad',()=>loadEvents++);
        ${loader}
        window.dispatchEvent(new CustomEvent('onWidgetLoad',{detail:{fieldData:{template:'classic'}}}));
    })()`);
    const failureDeadline = Date.now() + 10000;
    while (
        !(await browser.evaluate(
            `document.getElementById('diagnostics').textContent.includes('Unable to load')`
        ))
    ) {
        if (Date.now() > failureDeadline)
            throw Error('Failed hosted load did not report its error');
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(
        await browser.evaluate('window.loadEvents'),
        1,
        'Failed downloads must not replay configuration'
    );
    assert.equal(await browser.evaluate('!!window.CHAT_WIDGET_RUNTIME'), false);
    console.log(
        'PASS hosted loader buffers settings, loads resources and paint shadows, and handles failed downloads without replay'
    );
} finally {
    await browser?.close();
    assert.equal(path.dirname(outputDirectory), path.resolve(os.tmpdir()));
    await rm(outputDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
