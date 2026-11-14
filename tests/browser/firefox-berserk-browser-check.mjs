import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { compileStyles } from '../../scripts/styles.mjs';
import { readConfig } from '../../scripts/build.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import { firefoxSession } from '../helpers/firefox-session.mjs';
import { artifactPath } from '../helpers/artifacts.mjs';

const browser = await firefoxSession();
if (!browser) {
    console.log('SKIP Firefox mask rendering: set FIREFOX_PATH or install Firefox');
    process.exit(0);
}
try {
    await browser.send('browsingContext.setViewport', {
        context: browser.context,
        viewport: { width: 1800, height: 1500 },
        devicePixelRatio: 1
    });
    await browser.evaluate(`(() => {
        document.head.innerHTML = '<style></style>';
        document.querySelector('style').textContent = ${JSON.stringify(compileStyles().css)} +
            'html,body{background:white!important;overflow:visible} #chat[data-template]{display:grid;grid-template-columns:repeat(4,max-content);gap:16px;inset:0 auto auto 0;padding:20px;width:1800px;max-width:none;height:max-content} #chat[data-template] .message{display:block} #chat[data-template] .message::after{display:none} #chat[data-template] .body{padding:0;margin:0;max-width:none} #chat[data-template] .berserk-bubble-background{filter:none;opacity:1} #chat[data-template] .berserk-bubble-background::before{background-image:linear-gradient(red,red)!important;background-size:100% 100%!important;}';
        document.body.innerHTML = '<main id="chat" data-template="berserk"></main>';
    })()`);
    for (const [width, height] of [
        [200, 120],
        [420, 240]
    ]) {
        const geometry = await browser.evaluate(String.raw`(async () => {
            const chat=document.getElementById('chat');chat.replaceChildren();
            const variants=getComputedStyle(chat).getPropertyValue('--berserk-bubble-variants').trim().split(/\s+/);
            for (const base of variants) for (const orientation of ['normal','horizontal','vertical','both']) {
                const row=document.createElement('div');row.className='message';
                row.dataset.berserkBubble=base;row.dataset.berserkBubbleOrientation=orientation;
                row.innerHTML='<span class="body" style="width:${width}px;height:${height}px"><span class="berserk-bubble-background"></span></span>';
                chat.append(row);
            }
            const images=[];
            const rectangles=[...chat.querySelectorAll('.berserk-bubble-background')].map(node=>{
                const style=getComputedStyle(node,'::before'),rect=node.getBoundingClientRect();
                for (const match of style.maskImage.matchAll(/url\("([^\"]+)"\)/g)) {
                    const image=new Image();image.src=match[1];images.push(image.decode());
                }
                return {x:Math.round(rect.x),y:Math.round(rect.y),width:rect.width,height:rect.height,
                    masks:(style.maskImage.match(/data:image/g)||[]).length};
            });
            await Promise.all(images);
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            return rectangles;
        })()`);
        const screenshot = await browser.screenshot();
        await writeFile(
            await artifactPath(`firefox-berserk-masks-${width}.png`),
            Buffer.from(screenshot, 'base64')
        );
        const pixels = await browser.evaluate(`(async () => {
            const image=new Image();image.src='data:image/png;base64,'+${JSON.stringify(screenshot)};await image.decode();
            const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
            const context=canvas.getContext('2d');context.drawImage(image,0,0);
            const data=context.getImageData(0,0,canvas.width,canvas.height).data;
            return ${JSON.stringify(geometry)}.map(rect=>{
                let filled=0,missing=0,centreMissing=0;
                for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++) {
                    const offset=((rect.y+y)*canvas.width+rect.x+x)*4;
                    const red=data[offset]>240 && data[offset+1]<20 && data[offset+2]<20;
                    if(red)filled++;else missing++;
                    if(x>34 && x<rect.width-34 && y>35 && y<rect.height-35 && !red)centreMissing++;
                }
                return {filled,missing,centreMissing};
            });
        })()`);
        assert.equal(geometry.length, 20);
        for (let index = 0; index < geometry.length; index++) {
            assert.equal(geometry[index].masks, 8);
            assert.ok(
                pixels[index].filled > width * height * 0.5,
                JSON.stringify({ index, ...pixels[index] })
            );
            assert.ok(pixels[index].missing > 20, JSON.stringify({ index, ...pixels[index] }));
            assert.equal(
                pixels[index].centreMissing,
                0,
                JSON.stringify({ index, ...pixels[index] })
            );
        }
    }
    await browser.send('browsingContext.setViewport', {
        context: browser.context,
        viewport: { width: 700, height: 850 }
    });
    await browser.evaluate(`(() => {
        document.querySelector('style').textContent = ${JSON.stringify(compileStyles().css)} + 'html,body{background:#111!important}';
        document.body.innerHTML = '<main id="chat"></main><pre id="diagnostics" hidden></pre>';
    })()`);
    await browser.evaluate(`(() => {${readWidgetScripts(['providers', 'renderer', 'main'])}})()`);
    const actual = await browser.evaluate(`(async () => {
        ChatWidget.start({...${JSON.stringify(await readConfig())},template:'berserk',sources:[],chatAlignment:'right',
            enableAnimations:false,layout:'stack-top',fontFamily:'Arial',usernameFontFamily:'Arial',textFontFamily:'Arial',
            googleFont:'',usernameGoogleFont:'',textGoogleFont:''});
        const {renderer,paints}=CHAT_WIDGET_RUNTIME;paints.getCosmetics=async()=>null;
        document.getElementById('diagnostics').hidden=true;
        renderer.add({prefix:'alice!test',tags:{id:'one','display-name':'Alice','first-msg':'1'},params:['#test','¡Hola! Este es el primer mensaje.']});
        renderer.add({prefix:'guts!test',tags:{id:'two','display-name':'Guts'},params:['#test','Un mensaje con textura continua, bordes de sangre y una sola sombra.']});
        await document.fonts.ready;renderer.fit();
        const label=renderer.rows[0].body.querySelector('.first-message-label');
        return {width:renderer.root.getBoundingClientRect().width,left:renderer.root.getBoundingClientRect().left,
            scale:getComputedStyle(renderer.rows[0].row,'::after').scale,
            firstInside:!!label,align:getComputedStyle(label).textAlign,
            panels:renderer.rows.map(r=>{const s=getComputedStyle(r.body.querySelector('.berserk-bubble-background'),'::before');return {
                masks:(s.maskImage.match(/data:image/g)||[]).length,positions:s.maskPosition.split(',').length,
                tint:s.backgroundImage.startsWith('linear-gradient'),
                texture:s.backgroundImage.includes('data:image/png')};})};
    })()`);
    assert.equal(actual.width, 525);
    assert.equal(actual.left, 175);
    assert.equal(parseFloat(actual.scale), -1);
    assert.equal(actual.firstInside, true);
    assert.equal(actual.align, 'right');
    assert.equal(actual.panels[0].tint, true);
    assert.equal(actual.panels[1].tint, false);
    for (const panel of actual.panels) {
        assert.equal(panel.masks, 8);
        assert.equal(panel.positions, 9);
        assert.equal(panel.texture, true);
    }
    await writeFile(
        await artifactPath('firefox-berserk.png'),
        Buffer.from(await browser.screenshot(), 'base64')
    );
    console.log(
        'PASS Firefox screenshot pixels: all five blood masks, four flips, two sizes, transparent edges and seamless centres'
    );
} finally {
    await browser.close();
}
