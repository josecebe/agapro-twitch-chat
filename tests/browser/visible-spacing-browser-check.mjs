import assert from 'node:assert/strict';
import { compileStyles } from '../../scripts/styles.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';

const browser = await browserSession();
try {
    await browser.send('Page.enable');
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 640,
        height: 320,
        deviceScaleFactor: 1,
        mobile: false
    });
    await browser.evaluate(`(() => {
        const style = document.createElement('style');
        style.textContent = ${JSON.stringify(compileStyles().css)} + 'html,body{background:#000!important}';
        document.head.append(style);
        document.body.innerHTML = '<div id="chat"></div>';
        document.getElementById('chat').style.cssText = 'inset:30px auto auto 30px;width:580px;height:260px;justify-content:flex-start';
        document.documentElement.style.setProperty('--reply-gap','0px');
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer']));
    await browser.evaluate(`(() => {
        window.spacingRenderer = new ChatWidget.Renderer(document.getElementById('chat'),{
            language:'en',maxMessages:35,showBadges:false,showTwitchEmotes:true,showTwitchGifs:false
        },{listeners:new Set(),emote:()=>null},{});
        const image = spacingRenderer.image.bind(spacingRenderer);
        spacingRenderer.image = (src,alt,kind,ratio) => image(kind==='emote'
            ? 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34"><rect width="34" height="34" fill="white"/></svg>')
            : src,alt,kind,ratio);
    })()`);
    const results = [];
    for (const font of ['Arial', 'Courier New']) {
        for (const lineHeight of [1.1, 3]) {
            for (const variant of ['text', 'emoji', 'emote', 'gif', 'multiline']) {
                await browser.evaluate(`(async () => {
                    const renderer=spacingRenderer;
                    for(const row of [...renderer.rows]) renderer.remove(row);
                    renderer.seen.clear();
                    document.body.style.fontFamily=${JSON.stringify(font)};
                    document.documentElement.style.setProperty('--message-line-height','${lineHeight}');
                    const text={text:'Message with plain text',emoji:'\u{1f600} \u{1f49c} Message',emote:'Kappa',gif:'[GIF]',multiline:'First line\\nSecond line with Kappa'}['${variant}'];
                    const tags={id:'sample',color:'#ffffff','display-name':'LunaByte',
                        'reply-parent-msg-id':'parent','reply-parent-user-login':'alice',
                        'reply-parent-msg-body':'Sample message'};
                    if('${variant}'==='emote') tags.emotes='25:0-4';
                    if('${variant}'==='multiline') tags.emotes='25:28-32';
                    if('${variant}'==='gif') tags.gifs='0-4|demo|https://media4.giphy.com/media/demo/giphy.gif';
                    renderer.add({prefix:'luna!test',tags,params:['#test',text]});
                    await Promise.all([...renderer.root.querySelectorAll('img')].map(image=>image.decode()));
                    renderer.fit();
                    renderer.fit();
                })()`);
                const frames = [];
                for (const layer of ['heading', 'content']) {
                    await browser.evaluate(`(() => {
                        const row=spacingRenderer.rows[0];
                        row.reply.node.style.visibility='${layer}'==='heading'?'visible':'hidden';
                        row.content.style.visibility='${layer}'==='content'?'visible':'hidden';
                    })()`);
                    frames.push(
                        (await browser.send('Page.captureScreenshot', { format: 'png' })).data
                    );
                }
                const gap = await browser.evaluate(`(async () => {
                    const boxes=await Promise.all(${JSON.stringify(frames)}.map(async data=>{
                        const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();
                        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
                        const context=canvas.getContext('2d');context.drawImage(image,0,0);
                        const pixels=context.getImageData(0,0,image.width,image.height).data;
                        let top=image.height,bottom=-1;
                        for(let y=0;y<image.height;y++) for(let x=0;x<image.width;x++){
                            const i=(y*image.width+x)*4;
                            if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>16){top=Math.min(top,y);bottom=Math.max(bottom,y);}
                        }
                        if(bottom<0)throw Error('No visible pixels');
                        return {top,bottom};
                    }));
                    return boxes[1].top-boxes[0].bottom-1;
                })()`);
                results.push({ font, lineHeight, variant, gap });
            }
        }
    }
    for (const result of results) assert.ok(Math.abs(result.gap) <= 2, JSON.stringify(result));
    for (const font of ['Arial', 'Courier New']) {
        const gaps = results.filter((result) => result.font === font).map((result) => result.gap);
        assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 2, JSON.stringify(results));
    }
    await browser.evaluate('spacingRenderer.stop()');
    console.log(
        'PASS screenshot pixels confirm equal zero reply spacing for text, emoji, emotes, GIF labels and multiline messages'
    );
} finally {
    await browser.close();
}
