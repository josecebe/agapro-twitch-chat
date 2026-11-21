import assert from 'node:assert/strict';
import { readConfig } from '../../scripts/build.mjs';
import { compileStyles } from '../../scripts/styles.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import { browserSession } from '../helpers/browser-session.mjs';

const defaults = await readConfig();
const browser = await browserSession();
try {
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 800,
        height: 5000,
        deviceScaleFactor: 1,
        mobile: false
    });
    browser.on('Fetch.requestPaused', async ({ requestId, request }) => {
        assert.ok(
            ['cdn.7tv.app', 'static-cdn.jtvnw.net', 'media4.giphy.com'].includes(
                new URL(request.url).hostname
            )
        );
        const image =
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="gold"/></svg>';
        await browser.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'image/svg+xml' }],
            body: Buffer.from(image).toString('base64')
        });
    });
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
    await browser.evaluate(`(() => {
        document.head.innerHTML='<style></style>';document.querySelector('style').textContent=${JSON.stringify(compileStyles().css)};
        document.body.innerHTML='<main id="chat"></main><pre id="diagnostics" hidden></pre>';
        window.imageWrites=[];
        const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
        Object.defineProperty(HTMLImageElement.prototype,'src',{...descriptor,set(value){imageWrites.push({image:this,value});descriptor.set.call(this,value);}});
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer', 'main']));
    for (const template of ['classic', 'bubble-chat', 'berserk']) {
        const result = await browser.evaluate(`(async () => {
            ChatWidget.start({...${JSON.stringify(defaults)},sources:[],template:${JSON.stringify(template)},
                sevenTVEmoteScale:4,layout:'stack-top',enableAnimations:false,showTwitchGifs:true,showSharedChatIcon:false,
                fontFamily:'Arial',usernameFontFamily:'Arial',textFontFamily:'Arial',googleFont:'',usernameGoogleFont:'',textGoogleFont:''});
            const {renderer,assets,paints}=CHAT_WIDGET_RUNTIME;paints.getCosmetics=async()=>null;
            const catalog=(name,missing=false,overlay=false)=>({emotes:[{id:name,name,data:{flags:overlay?256:0,host:{
                url:'//cdn.7tv.app/emote/'+name,files:[{name:'1x.webp',size:100,width:32,height:32},{name:'1x.avif',size:80,width:32,height:32},
                    ...(!missing?[{name:'2x.webp',size:200,width:64,height:64},{name:'2x.avif',size:150,width:64,height:64}]:[])]}}}]});
            assets.channelId='111';
            assets.globalEmotes=new Map([...assets.normalize(catalog('Global'),'global'),...assets.normalize(catalog('Missing',true),'global'),...assets.normalize(catalog('Overlay',false,true),'global')]);
            assets.channelEmotes=assets.normalize(catalog('Channel'),'channel');
            assets.sourceChannels.set('222',{emotes:assets.normalize(catalog('Shared'),'source:222'),badges:{}});
            assets.ensureSource=()=>Promise.resolve();
            const add=(id,text,tags={})=>renderer.add({prefix:'user!test',tags:{id,'display-name':'User',...tags},params:['#test',text]});
            add('single','Global');
            add('spaces','  Global  ');
            add('multiple','Global Global');
            add('mixed','Hola Global');
            add('channel','Channel');
            add('shared','Shared',{'source-room-id':'222'});
            add('first','Global',{'first-msg':'1'});
            add('missing','Missing');
            add('stack','Global Overlay');
            add('native','Kappa',{emotes:'25:0-4'});
            add('gif-mixed','Global [GIF]',{gifs:'7-11|demo|https://media4.giphy.com/media/demo/giphy.gif'});
            add('reply','Hola',{'reply-parent-msg-id':'single','reply-parent-user-login':'user','reply-parent-display-name':'User','reply-parent-msg-body':'Global'});
            const collect=()=>renderer.rows.map(record=>({id:record.id,
                images:[...record.body.querySelectorAll('.emote')].map(image=>({src:image.src,writes:imageWrites.filter(write=>write.image===image).map(write=>write.value)})),
                quote:[...(record.reply?.quote?.querySelectorAll('.emote')||[])].map(image=>image.src)}));
            await Promise.all([...document.images].map(image=>image.decode()));
            const before=collect();
            renderer.refresh();
            await Promise.all([...document.images].map(image=>image.decode()));
            return {before,after:collect()};
        })()`);
        for (const rows of [result.before, result.after])
            for (const row of rows) {
                for (const image of row.images) {
                    assert.equal(image.writes.length, 1, JSON.stringify({ template, row }));
                    if (row.id === 'native') {
                        assert.match(image.src, /\/default\/dark\/2\.0$/);
                        continue;
                    }
                    const enlarged =
                        template !== 'classic' &&
                        ['single', 'spaces', 'channel', 'shared', 'first', 'stack'].includes(
                            row.id
                        );
                    assert.ok(
                        image.src.endsWith(enlarged ? '/2x.avif' : '/1x.avif'),
                        JSON.stringify({ template, row })
                    );
                }
                for (const src of row.quote)
                    assert.ok(src.endsWith('/1x.avif'), JSON.stringify({ template, row }));
            }
        assert.deepEqual(
            result.before.map((row) => row.images.map((image) => image.src)),
            result.after.map((row) => row.images.map((image) => image.src))
        );
    }
    assert.deepEqual(browser.errors, []);
    console.log(
        'PASS 7TV defaults to 1x, enlarged single-emote bubbles prefer 2x, previews stay 1x and images request only one source'
    );
} finally {
    await browser.close();
}
