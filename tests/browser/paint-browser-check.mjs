import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { compileStyles } from '../../scripts/styles.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import { artifactPath } from '../helpers/artifacts.mjs';

const capture = JSON.parse(
    await readFile(new URL('../fixtures/stained-glass-paint.json', import.meta.url), 'utf8')
);
const epiphanyCapture = JSON.parse(
    await readFile(new URL('../fixtures/epiphany-paint.json', import.meta.url), 'utf8')
);
const browser = await browserSession();
try {
    await browser.send('Page.enable');
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 600,
        deviceScaleFactor: 1,
        mobile: false
    });
    await browser.evaluate(`(() => {
        const style = document.createElement('style');
        style.textContent = ${JSON.stringify(compileStyles().css)};
        document.head.append(style);
        document.body.classList.add('shadow');
        document.body.innerHTML = '<div id="chat"></div>';
        document.documentElement.style.setProperty('--username-font-family','Arial');
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer']));
    const result = await browser.evaluate(`(async () => {
        const paint = ChatWidget.paintCSS(${JSON.stringify(capture.paint)});
        const renderer = new ChatWidget.Renderer(document.getElementById('chat'),{
            language:'en',maxMessages:35,showSevenTVPaints:true,showBadges:false,colorMentions:true
        },{listeners:new Set(),emote:()=>null},{getCosmetics:async id=>id==='123' ? {paint,badge:null}:null});
        window.paintRenderer = renderer;
        renderer.add({prefix:'prismanocturno!test',tags:{id:'paint-parent','user-id':'123','display-name':'PrismaNocturno',color:'#c084fc'},params:['#test','Stained Glass: original 7TV paint']});
        renderer.add({prefix:'luna!test',tags:{id:'paint-reply','display-name':'Luna',
            'reply-parent-msg-id':'paint-parent','reply-parent-user-id':'123',
            'reply-parent-user-login':'prismanocturno','reply-parent-display-name':'PrismaNocturno',
            'reply-parent-msg-body':'Stained Glass: original 7TV paint'},params:['#test','The paint of @PrismaNocturno keeps its own glow']});
        await new Promise(resolve=>setTimeout(resolve,0));
        const parent = renderer.rows[0];
        const record = renderer.rows[1];
        const mention = record.body.querySelector('.mention');
        const nodes = [parent.name, mention, record.reply.mention];
        const filters = () => nodes.map(node=>getComputedStyle(node).filter);
        const normalizer = document.createElement('span');
        normalizer.style.filter = paint.filter;
        document.body.append(normalizer);
        const expected = getComputedStyle(normalizer).filter;
        normalizer.remove();
        const enabled = filters();
        document.body.classList.remove('shadow');
        const disabled = filters();
        document.body.classList.add('shadow');
        const widths = [];
        for (const width of [850,500]) {
            renderer.root.style.width = width+'px';
            renderer.fit();
            const range = document.createRange();
            range.selectNodeContents(record.reply.heading);
            const text = range.getBoundingClientRect();
            const heading = record.reply.heading.getBoundingClientRect();
            widths.push({width,left:text.left-heading.left,right:heading.right-text.right,
                bleed:parseFloat(getComputedStyle(record.reply.heading).paddingLeft),
                clipped:record.reply.heading.scrollWidth>record.reply.heading.clientWidth});
        }
        renderer.applyPaint(record.reply.mention,{backgroundImage:paint.backgroundImage,filter:''});
        const fallback = {filter:getComputedStyle(record.reply.mention).filter,bleed:record.reply.heading.style.getPropertyValue('--reply-paint-bleed')};
        renderer.applyPaint(record.reply.mention,paint);
        renderer.root.style.width='850px';
        renderer.fit();
        return {expected,enabled,disabled,widths,fallback,background:getComputedStyle(parent.name).backgroundImage};
    })()`);
    assert.equal(result.enabled.length, 3);
    assert.ok(result.enabled.every((filter) => filter === result.expected));
    assert.deepEqual(result.disabled, result.enabled);
    assert.equal(result.expected.match(/drop-shadow\(/g).length, 2);
    assert.ok(result.background.startsWith('repeating-linear-gradient(135deg'));
    for (const width of result.widths) {
        assert.ok(width.bleed >= 13, JSON.stringify(width));
        assert.ok(width.left >= 12.5 && width.right >= 12.5, JSON.stringify(width));
        assert.equal(width.clipped, false, JSON.stringify(width));
    }
    assert.ok(result.fallback.filter.startsWith('url('));
    assert.equal(result.fallback.bleed, '');
    const screenshot = await browser.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
        await artifactPath('stained-glass-preview.png'),
        Buffer.from(screenshot.data, 'base64')
    );
    await browser.evaluate('paintRenderer.stop()');
    const paints = [
        {
            capture,
            filter: 'drop-shadow(0px 0px 0.1px rgba(194,58,251,1)) drop-shadow(0px 0px 4px rgba(87,87,87,1))'
        },
        { capture: epiphanyCapture, filter: 'drop-shadow(0px 0px 4px rgba(255,162,0,1))' }
    ];
    for (const fixture of paints) {
        const frames = [];
        for (const mode of ['actual', 'reference', 'no-shadow-setting', 'no-glow']) {
            const textShadow = await browser.evaluate(`(() => {
                document.body.replaceChildren();
                document.body.classList.toggle('shadow','${mode}' !== 'no-shadow-setting');
                const stage = document.createElement('div');
                stage.className = 'message';
                stage.style.cssText = 'position:fixed;inset:0;background:#ccc';
                const name = document.createElement('span');
                name.className = 'name';name.textContent = 'PrismaNocturno';
                name.style.cssText = 'position:absolute;left:30px;top:30px;font:700 32px Arial';
                stage.append(name);document.body.append(stage);
                const paint = ChatWidget.paintCSS(${JSON.stringify(fixture.capture.paint)});
                if ('${mode}' === 'reference') {
                    Object.assign(name.style,{backgroundImage:paint.backgroundImage,backgroundSize:'cover',backgroundPosition:'center',
                        backgroundClip:'text',webkitBackgroundClip:'text',webkitTextFillColor:'transparent',textShadow:'none',
                        filter:${JSON.stringify(fixture.filter)}});
                } else {
                    ChatWidget.Renderer.prototype.applyPaint.call({},name,paint);
                    if ('${mode}' === 'no-glow') name.style.filter='none';
                }
                return getComputedStyle(name).textShadow;
            })()`);
            assert.equal(textShadow, 'none');
            frames.push(
                (
                    await browser.send('Page.captureScreenshot', {
                        format: 'png',
                        clip: { x: 0, y: 0, width: 420, height: 110, scale: 1 }
                    })
                ).data
            );
        }
        const difference = await browser.evaluate(`(async () => {
            const pixels = await Promise.all(${JSON.stringify(frames)}.map(async data => {
                const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();
                const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
                const context=canvas.getContext('2d');context.drawImage(image,0,0);
                return context.getImageData(0,0,image.width,image.height).data;
            }));
            return {sum:pixels.slice(1).map(frame=>frame.reduce((total,value,index)=>total+Math.abs(value-pixels[0][index]),0)),
                max:pixels.slice(1).map(frame=>frame.reduce((maximum,value,index)=>Math.max(maximum,Math.abs(value-pixels[0][index])),0))};
        })()`);
        // Allow only tiny 8-bit antialiasing/compositing rounding differences.
        assert.ok(
            difference.max[0] <= 2 && difference.sum[0] <= 1000,
            fixture.capture.paint.name + ': differs from reference ' + JSON.stringify(difference)
        );
        assert.ok(
            difference.max[1] <= 2,
            fixture.capture.paint.name +
                ': Twitch shadow leaked into paint ' +
                JSON.stringify(difference)
        );
        assert.ok(difference.sum[2] > 10000, fixture.capture.paint.name + ': glow did not render');
    }
    await browser.evaluate(`(() => {
        document.body.replaceChildren();
        document.body.classList.add('shadow');
        for (const [index,color] of ['#fff','#bbb','#151515'].entries()) {
            const panel=document.createElement('div');
            panel.style.cssText='position:absolute;top:0;left:'+(index*300)+'px;width:300px;height:240px;padding:20px;background:'+color+';color:'+(index===2?'#fff':'#111');
            for(const capture of ${JSON.stringify([capture, epiphanyCapture])}) {
                const title=document.createElement('div');title.textContent=capture.paint.name;title.style.cssText='font:14px Arial;margin:10px 0';
                const row=document.createElement('div');row.className='message';
                const name=document.createElement('span');name.className='name';name.textContent=capture.paint.name==='Epiphany'?'ZorroSolar':'PrismaNocturno';
                name.style.font='700 25px Arial';
                ChatWidget.Renderer.prototype.applyPaint.call({},name,ChatWidget.paintCSS(capture.paint));
                row.append(name);panel.append(title,row);
            }
            document.body.append(panel);
        }
    })()`);
    const comparison = await browser.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: 900, height: 240, scale: 1 }
    });
    await writeFile(
        await artifactPath('paint-glow-comparison.png'),
        Buffer.from(comparison.data, 'base64')
    );
    console.log(
        'PASS screenshot pixels match the raw 7TV shadow definitions; both outer glows render and Twitch textShadow adds no extra shadow'
    );
    console.log(
        'PASS real Stained Glass paint preserves both glows on names, mentions and reply recipients without clipping or adding the Twitch shadow'
    );
} finally {
    await browser.close();
}
