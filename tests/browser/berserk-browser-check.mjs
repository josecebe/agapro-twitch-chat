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
        width: 900,
        height: 650,
        deviceScaleFactor: 1,
        mobile: false
    });
    browser.on('Fetch.requestPaused', async ({ requestId }) => {
        await browser.send('Fetch.fulfillRequest', { requestId, responseCode: 200, body: '' });
    });
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
    await browser.evaluate(`(() => {
        let seed = 97531;
        Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        document.head.innerHTML = '<style></style>';
        document.querySelector('style').textContent = ${JSON.stringify(compileStyles().css)};
        document.body.innerHTML = '<main id="chat"></main><pre id="diagnostics" hidden></pre>';
        window.testConfig = ${JSON.stringify({ ...defaults, template: 'berserk', chatMaxWidthPx: 2000, sources: [], enableAnimations: false, messageBackground: true, layout: 'stack-top' })};
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer', 'main']));
    await browser.evaluate(`(async () => {
        ChatWidget.start(testConfig);
        document.getElementById('diagnostics').hidden = true;
        const runtime = CHAT_WIDGET_RUNTIME;
        runtime.paints.getCosmetics = async () => null;
        ['Guts', 'Berserk_Fan', 'UnNickMuchoMasLargoParaProbarLaEspada'].forEach((name, i) => {
            runtime.renderer.add({prefix:name.toLowerCase() + '!test', tags:{id:'sword-' + i, 'display-name':name, color:'#9146ff'}, params:['#test', i === 2 ? 'Un mensaje largo para comprobar el ajuste de la burbuja al espacio disponible, incluso cuando ocupa varias líneas.' : (i === 1 ? 'Hola' : 'La espada se adapta al nick.')]});
        });
        const variants = getComputedStyle(document.getElementById('chat')).getPropertyValue('--berserk-bubble-variants').trim().split(' ').filter(Boolean);
        // Cover different random outcomes without relying on chance.
        [...document.querySelectorAll('.message')].forEach((row, i) => {
            delete row.dataset.berserkBubble;
            const random = Math.random;
            try {
                Math.random = () => ((i % variants.length) + 0.5) / variants.length;
                ChatWidget.templates.get('berserk').styleBody(row.querySelector('.body'));
            } finally { Math.random = random; }
        });
        await document.fonts.ready;
        runtime.renderer.fit();
    })()`);
    const geometry = () =>
        browser.evaluate(`Array.from(document.querySelectorAll('.message'), row => {
        const sword = getComputedStyle(row, '::after');
        const body = row.querySelector('.body');
        const background = row.querySelector('.berserk-bubble-background');
        const pool = getComputedStyle(background, '::before');
        return { name:row.querySelector('.name').textContent, width:parseFloat(sword.width) + parseFloat(sword.paddingLeft) + parseFloat(sword.paddingRight), sizes:sword.backgroundSize, repeat:sword.backgroundRepeat,
            images:(sword.backgroundImage.match(/data:image\\/png;base64/g) || []).length,
            color:getComputedStyle(row.querySelector('.name')).color,
            bubbleVariant:row.dataset.berserkBubble,
            backgroundLayers:row.querySelectorAll('.berserk-bubble-background').length,
            shadow:getComputedStyle(background).filter,
            bubbleOrientation:row.dataset.berserkBubbleOrientation,
            poolTransform:pool.transform,
            poolMask:pool.maskImage.slice(0, 64),
            poolMaskPieces:(pool.maskImage.match(/data:image\\/svg/g) || []).length,
            poolMaskHasRaster:pool.maskImage.includes('data%3Aimage%2Fpng'),
            poolMaskSize:pool.maskSize,
            poolMaskRepeat:pool.maskRepeat,
            poolMaskComposite:pool.maskComposite,
            poolBackground:pool.backgroundImage.slice(0, 64),
            poolSize:pool.backgroundSize,
            poolFilter:pool.filter,
            poolPosition:pool.backgroundPosition,
            poolWidth:parseFloat(pool.width),
            poolHeight:parseFloat(pool.height),
            bodyPadding:getComputedStyle(body).padding,
            poolRepeat:pool.backgroundRepeat,
            right:row.getBoundingClientRect().right,
            nameInset:row.querySelector('.name').getBoundingClientRect().left - row.getBoundingClientRect().left };
    })`);
    const wide = (await geometry()).sort((a, b) => a.name.length - b.name.length);
    const textureDimensions = await browser.evaluate(`(async () => {
        const image = new Image();
        image.src = getComputedStyle(document.querySelector('.berserk-bubble-background'), '::before').backgroundImage.slice(5, -2);
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
    })()`);
    assert.deepEqual(textureDimensions, [1102, 617]);
    assert.equal(new Set(wide.map((item) => item.poolPosition)).size, wide.length);
    assert.equal(wide.length, 3);
    const short = wide.find((item) => item.name === 'Berserk_Fan');
    assert.ok(short.poolWidth < short.width - 100, 'Short text must not inherit sword width');
    assert.equal(short.bodyPadding, '20px 39px 24px');
    const nickResize = await browser.evaluate(`(() => {
        const row = [...document.querySelectorAll('.message')].find(row => row.querySelector('.name').textContent === 'Berserk_Fan');
        const name = row.querySelector('.name');
        const body = row.querySelector('.body');
        const before = body.getBoundingClientRect().width;
        const original = name.textContent;
        name.textContent = original + '_MuchLongerNickname';
        const after = body.getBoundingClientRect().width;
        name.textContent = original;
        const range = document.createRange();
        range.selectNodeContents([...body.childNodes].find(node => node.nodeType === Node.TEXT_NODE));
        return {before, after, textWidth:range.getBoundingClientRect().width};
    })()`);
    assert.equal(nickResize.before, nickResize.after);
    assert.ok(Math.abs(nickResize.before - nickResize.textWidth - 78) < 1);
    assert.ok(wide[0].width < wide[1].width && wide[1].width < wide[2].width, JSON.stringify(wide));
    for (const sword of wide) {
        assert.equal(sword.images, 3);
        assert.equal(sword.sizes, wide[0].sizes, 'Tip and hilt keep their dimensions');
        assert.equal(sword.repeat, 'no-repeat, no-repeat, no-repeat');
        assert.equal(sword.color, 'rgb(255, 255, 255)');
        assert.ok(sword.nameInset < 80, 'Decorative pieces must not create empty grid tracks');
        assert.match(sword.poolMask, /data:image\/svg\+xml/);
        assert.ok(sword.bubbleVariant);
        const transforms = {
            normal: 'none',
            horizontal: 'matrix(-1, 0, 0, 1, 0, 0)',
            vertical: 'matrix(1, 0, 0, -1, 0, 0)',
            both: 'matrix(-1, 0, 0, -1, 0, 0)'
        };
        assert.equal(sword.poolTransform, transforms[sword.bubbleOrientation]);
        assert.equal(sword.poolMaskPieces, 8);
        assert.equal(sword.poolMaskHasRaster, false);
        assert.ok(sword.poolMaskSize.startsWith('30.5px 32px, 30.5px 32px, 30.5px 24.75px'));
        assert.equal(sword.poolMaskRepeat.split(',').length, 9);
        assert.ok(sword.poolMaskRepeat.split(',').every((value) => value.trim() === 'no-repeat'));
        assert.ok(sword.poolMaskComposite.split(',').every((value) => value.trim() === 'add'));
        assert.match(sword.poolBackground, /^url\("data:image\/png;base64,/);
        assert.doesNotMatch(sword.poolBackground, /gradient/);
        assert.match(sword.poolSize, /1102px/);
        assert.match(sword.poolSize, /617px/);
        assert.equal(sword.poolFilter, 'none');
        assert.equal(sword.backgroundLayers, 1);
        assert.match(sword.shadow, /drop-shadow/);
        assert.equal((sword.shadow.match(/drop-shadow/g) || []).length, 1);
        const position = sword.poolPosition.split(' ').map(parseFloat);
        assert.ok(position.every((value) => value >= 0 && value <= 100));
        const cropX = ((Math.max(1102, sword.poolWidth) - sword.poolWidth) * position[0]) / 100;
        const cropY = ((Math.max(617, sword.poolHeight) - sword.poolHeight) * position[1]) / 100;
        assert.ok(cropX >= 0 && cropX + sword.poolWidth <= Math.max(1102, sword.poolWidth));
        assert.ok(cropY >= 0 && cropY + sword.poolHeight <= Math.max(617, sword.poolHeight));
        assert.ok(sword.poolRepeat.split(',').every((repeat) => repeat.trim() === 'no-repeat'));
    }
    const variants = await browser.evaluate(
        `getComputedStyle(document.getElementById('chat')).getPropertyValue('--berserk-bubble-variants').trim().split(' ').filter(Boolean)`
    );
    assert.ok(new Set(wide.map((item) => item.bubbleVariant)).size >= Math.min(2, variants.length));
    for (const item of wide) assert.ok(variants.includes(item.bubbleVariant));
    await writeFile(
        await artifactPath('berserk.png'),
        Buffer.from(
            (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
            'base64'
        )
    );
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 320,
        height: 650,
        deviceScaleFactor: 1,
        mobile: false
    });
    for (const sword of await geometry()) {
        assert.ok(sword.right <= 290);
        assert.equal(
            sword.bubbleVariant,
            wide.find((item) => item.name === sword.name).bubbleVariant
        );
        assert.equal(
            sword.bubbleOrientation,
            wide.find((item) => item.name === sword.name).bubbleOrientation
        );
        assert.equal(sword.poolMaskSize, wide[0].poolMaskSize);
        assert.equal(
            sword.poolPosition,
            wide.find((item) => item.name === sword.name).poolPosition
        );
    }
    const overflowingHeader = await browser.evaluate(`(() => {
        const row = [...document.querySelectorAll('.message')].find(row => row.querySelector('.name').textContent === 'UnNickMuchoMasLargoParaProbarLaEspada');
        const name = row.querySelector('.name');
        const body = row.querySelector('.body');
        const frame = document.getElementById('chat');
        const sword = getComputedStyle(row, '::after');
        const range = document.createRange(); range.selectNodeContents(name);
        return {overflow:getComputedStyle(name).overflow,textOverflow:getComputedStyle(name).textOverflow,
            frameOverflow:getComputedStyle(frame).overflow,
            nameRight:name.getBoundingClientRect().right,frameRight:frame.getBoundingClientRect().right,
            bodyRight:body.getBoundingClientRect().right,
            swordWidth:parseFloat(sword.width) + parseFloat(sword.paddingLeft) + parseFloat(sword.paddingRight),
            textRight:range.getBoundingClientRect().right,rowLeft:row.getBoundingClientRect().left};
    })()`);
    assert.equal(overflowingHeader.overflow, 'visible');
    assert.equal(overflowingHeader.textOverflow, 'clip');
    assert.equal(overflowingHeader.frameOverflow, 'visible');
    assert.ok(overflowingHeader.nameRight > overflowingHeader.frameRight);
    assert.ok(overflowingHeader.bodyRight <= 290);
    assert.ok(
        overflowingHeader.rowLeft + overflowingHeader.swordWidth >= overflowingHeader.textRight
    );
    await writeFile(
        await artifactPath('berserk-narrow.png'),
        Buffer.from(
            (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
            'base64'
        )
    );
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 1400,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false
    });
    await browser.evaluate(`(() => {
        const rows = [...document.querySelectorAll('.message')];
        rows.slice(1).forEach(row => row.style.display = 'none');
        rows[0].style.width = '1200px';
        rows[0].querySelector('.body').style.minHeight = '700px';
    })()`);
    const oversized = (await geometry())[0];
    assert.ok(oversized.poolWidth > 1102 && oversized.poolHeight > 617);
    assert.equal(oversized.poolMaskSize, wide[0].poolMaskSize);
    assert.match(oversized.poolSize, /max\(1102px, 100%\)/);
    assert.match(oversized.poolSize, /max\(617px, 100%\)/);
    await writeFile(
        await artifactPath('berserk-oversized.png'),
        Buffer.from(
            (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
            'base64'
        )
    );
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 900,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
    });
    const contentCases = await browser.evaluate(`(async () => {
        const runtime = CHAT_WIDGET_RUNTIME;
        const renderer = runtime.renderer;
        renderer.rows.slice().forEach(record => renderer.remove(record));
        const src = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="30" fill="gold"/></svg>');
        runtime.assets.emote = token => token === 'Wave' ? {src, ratio:1} : null;
        const add = (id, text, tags = {}) => renderer.add({prefix:'longnickname!test', tags:{id,'display-name':'UnNickLargoParaUnMensajeCorto',color:'#9146ff',...tags}, params:['#test',text]});
        add('single-emote', 'Wave');
        add('first', 'Hola', {'first-msg':'1'});
        add('reply', 'Sí', {'reply-parent-msg-id':'first','reply-parent-user-login':'longnickname','reply-parent-display-name':'UnNickLargoParaUnMensajeCorto','reply-parent-msg-body':'Hola'});
        await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
        renderer.fit();
        return renderer.rows.map(record => {
            const body = record.body.getBoundingClientRect();
            const label = record.row.querySelector('.first-message-label');
            const labelBounds = label?.getBoundingClientRect();
            const labelStyle = label && getComputedStyle(label);
            const sword = getComputedStyle(record.row, '::after');
            return {id:record.id, bodyWidth:body.width,swordWidth:parseFloat(sword.width) + parseFloat(sword.paddingLeft) + parseFloat(sword.paddingRight),
                labelBottom:labelBounds?.bottom, labelTop:labelBounds?.top,
                labelRight:labelBounds?.right, bodyRight:body.right, bodyBottom:body.bottom,
                labelInside:label && record.body.contains(label), labelAlign:labelStyle?.textAlign,
                labelColor:labelStyle?.color, labelBackground:labelStyle?.backgroundImage, labelFilter:labelStyle?.filter,
                labelShadow:labelStyle?.textShadow,
                bodyTop:body.top, replyRight:record.reply?.node.getBoundingClientRect().right,
                emoteCentred:record.body.classList.contains('berserk-single-emote')};
        });
    })()`);
    for (const item of contentCases) assert.ok(item.bodyWidth < item.swordWidth - 80);
    assert.equal(contentCases.find((item) => item.id === 'single-emote').emoteCentred, true);
    const first = contentCases.find((item) => item.id === 'first');
    assert.equal(first.labelInside, true);
    assert.ok(first.labelTop > first.bodyTop);
    assert.ok(first.labelBottom < first.bodyBottom);
    assert.ok(first.labelRight < first.bodyRight);
    assert.equal(first.labelAlign, 'right');
    assert.equal(first.labelColor, 'rgb(232, 121, 249)');
    assert.equal(first.labelBackground, 'none');
    assert.equal(first.labelFilter, 'none');
    assert.notEqual(first.labelShadow, 'none');
    const refreshedNotice = await browser.evaluate(`(() => {
        const {renderer} = CHAT_WIDGET_RUNTIME;
        const first = renderer.rows.find(record => record.id === 'first');
        const label = first.body.querySelector('.first-message-label');
        renderer.refresh();
        renderer.refresh();
        return {same:first.body.querySelector('.first-message-label') === label,
            count:first.row.querySelectorAll('.first-message-label').length,
            text:label.textContent};
    })()`);
    assert.equal(refreshedNotice.same, true);
    assert.equal(refreshedNotice.count, 1);
    assert.equal(refreshedNotice.text, 'FIRST-TIME CHATTER');
    assert.ok(contentCases.find((item) => item.id === 'reply').replyRight <= 870);
    await writeFile(
        await artifactPath('berserk-content.png'),
        Buffer.from(
            (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
            'base64'
        )
    );
    await browser.evaluate(
        `document.documentElement.style.setProperty('background-color', '#6b747c', 'important')`
    );
    await writeFile(
        await artifactPath('berserk-shadow-preview.png'),
        Buffer.from(
            (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
            'base64'
        )
    );
    await browser.evaluate(`document.documentElement.style.removeProperty('background-color')`);
    const firstBackgroundCases = await browser.evaluate(`(() => {
        return [true,false].map(enabled => {
            ChatWidget.start({...testConfig,firstMessageBackground:enabled,
                firstMessageBackgroundColor:'rgba(12, 180, 90, 0.4)'});
            const {renderer,paints} = CHAT_WIDGET_RUNTIME;
            paints.getCosmetics = async () => null;
            renderer.add({prefix:'first!test',tags:{id:'first-tint','display-name':'First','first-msg':'1'},params:['#test','Textura y color']});
            const layer = renderer.rows[0].body.querySelector('.berserk-bubble-background');
            const style = getComputedStyle(layer,'::before');
            return {enabled,image:style.backgroundImage.slice(0,150),
                texture:style.backgroundImage.includes('data:image/png'),
                mask:style.maskImage !== 'none'};
        });
    })()`);
    for (const result of firstBackgroundCases) {
        assert.equal(result.texture, true);
        assert.equal(result.mask, true);
        if (result.enabled)
            assert.match(result.image, /^linear-gradient\(rgba\(12, 180, 90, 0\.4\)/);
        else assert.doesNotMatch(result.image, /linear-gradient/);
    }
    const highlighted = await browser.evaluate(`(() => {
        ChatWidget.start({...testConfig,chatMaxWidthPx:525});
        document.getElementById('diagnostics').hidden=true;
        const {renderer,paints}=CHAT_WIDGET_RUNTIME;paints.getCosmetics=async()=>null;
        const add=(id,tags)=>renderer.add({prefix:'guts!test',tags:{id,'display-name':'Guts',...tags},params:['#test','Un mensaje destacado sobre la textura de sangre.']});
        add('highlight',{'msg-id':'highlighted-message'});
        add('highlight-first',{'msg-id':'highlighted-message','first-msg':'1'});
        const background=renderer.rows[0].body.querySelector('.berserk-bubble-background');
        const animation=document.getAnimations().find(a=>a.animationName==='berserk-highlight-gradient');
        animation.pause();animation.currentTime=0;
        const before=getComputedStyle(background,'::before').backgroundPosition;
        animation.currentTime=2500;
        const style=getComputedStyle(background,'::before');
        const first=getComputedStyle(renderer.rows[1].body.querySelector('.berserk-bubble-background'),'::before');
        return {before,after:style.backgroundPosition,
            gradient:style.backgroundImage.startsWith('linear-gradient'),texture:style.backgroundImage.includes('data:image/png'),
            masks:(style.maskImage.match(/data:image/g)||[]).length,size:style.backgroundSize,
            shadow:getComputedStyle(background).filter,
            firstAnimation:first.animationName};
    })()`);
    assert.equal(highlighted.gradient, true);
    assert.equal(highlighted.texture, true);
    assert.equal(highlighted.masks, 8);
    assert.match(highlighted.size, /^900% 900%,/);
    assert.notEqual(highlighted.before.split(',')[0], highlighted.after.split(',')[0]);
    assert.equal(
        highlighted.before.split(',')[1],
        highlighted.after.split(',')[1],
        'Native texture crop stays still'
    );
    assert.equal((highlighted.shadow.match(/drop-shadow/g) || []).length, 1);
    assert.equal(highlighted.firstAnimation, 'none');
    await writeFile(
        await artifactPath('berserk-highlight.png'),
        Buffer.from(
            (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
            'base64'
        )
    );
    await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    assert.equal(
        await browser.evaluate(
            `getComputedStyle(CHAT_WIDGET_RUNTIME.renderer.rows[0].body.querySelector('.berserk-bubble-background'),'::before').animationName`
        ),
        'none'
    );
    await browser.send('Emulation.setEmulatedMedia', { features: [] });
    const opacityCases = await browser.evaluate(`(() => {
        return [0, 0.25, 1].map(opacity => {
            ChatWidget.start({...testConfig,messageBackgroundOpacity:opacity,messageBackgroundColor:'rgba(0,255,0,0.1)'});
            const renderer = CHAT_WIDGET_RUNTIME.renderer;
            CHAT_WIDGET_RUNTIME.paints.getCosmetics = async () => null;
            renderer.add({prefix:'opacity!test', tags:{id:'opacity-' + opacity,'display-name':'Opacity',color:'#9146ff'},params:['#test','Solo cambia la textura']});
            const {row,body,name} = renderer.rows[0];
            return {opacity, background:getComputedStyle(body.querySelector('.berserk-bubble-background')).opacity,
                body:getComputedStyle(body).opacity,name:getComputedStyle(name).opacity,
                sword:getComputedStyle(row,'::after').opacity,
                image:getComputedStyle(body.querySelector('.berserk-bubble-background'),'::before').backgroundImage.slice(0,32)};
        });
    })()`);
    for (const item of opacityCases) {
        assert.equal(Number(item.background), item.opacity);
        assert.equal(item.body, '1');
        assert.equal(item.name, '1');
        assert.equal(item.sword, '1');
        assert.match(item.image, /data:image\/png/);
    }
    await browser.evaluate(`window.swordAnimationCase = (enabled, globalEnabled = true) => {
        ChatWidget.start({...testConfig,enableAnimations:globalEnabled,berserkSwordAnimation:enabled});
        const {renderer,paints} = CHAT_WIDGET_RUNTIME;
        paints.getCosmetics = async () => null;
        renderer.add({prefix:'guts!test',tags:{id:'animation','display-name':'Guts'},params:['#test','Entrada de espada']});
        const {row,name,badges,body} = renderer.rows[0];
        return {sword:getComputedStyle(row,'::after').animationName,
            name:getComputedStyle(name).animationName,badges:getComputedStyle(badges).animationName,
            body:getComputedStyle(body).animationName};
    }`);
    for (const enabled of [undefined, true, false]) {
        const result = await browser.evaluate(`swordAnimationCase(${enabled})`);
        const expected = enabled === false ? 'none' : 'berserk-sword-enter';
        assert.equal(result.sword, expected);
        assert.equal(result.name, expected);
        assert.equal(result.badges, expected);
        assert.equal(result.body, 'none');
    }
    const animationFrames = await browser.evaluate(`(() => {
        swordAnimationCase(true);
        const animations = document.getAnimations().filter(a => a.animationName === 'berserk-sword-enter');
        const frames = animations.map(a => {
            a.pause(); a.currentTime = 160;
            return {duration:a.effect.getTiming().duration, frames:a.effect.getKeyframes().map(f=>({opacity:f.opacity,translate:f.translate}))};
        });
        animations.forEach(a=>a.finish());
        CHAT_WIDGET_RUNTIME.renderer.refresh();
        return {frames,restarted:document.getAnimations().some(a=>a.animationName==='berserk-sword-enter' && a.playState!=='finished')};
    })()`);
    assert.ok(animationFrames.frames.length >= 3);
    for (const animation of animationFrames.frames) {
        assert.equal(animation.duration, 320);
        assert.equal(animation.frames[0].opacity, '0');
        assert.equal(parseFloat(animation.frames[0].translate), 28);
        assert.equal(animation.frames.at(-1).opacity, '1');
    }
    assert.equal(animationFrames.restarted, false);
    assert.equal((await browser.evaluate('swordAnimationCase(true,false)')).sword, 'none');
    await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    assert.equal((await browser.evaluate('swordAnimationCase(true)')).sword, 'none');
    await browser.send('Emulation.setEmulatedMedia', { features: [] });
    assert.deepEqual(browser.errors, []);
    console.log(
        'PASS Berserk uses the supplied sword, grows with nicknames and fits narrow overlays'
    );
} finally {
    await browser.close();
}
