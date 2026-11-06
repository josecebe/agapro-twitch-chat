import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildProject } from '../../scripts/build.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { artifactPath } from '../helpers/artifacts.mjs';

const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'chat-bubble-spacing-'));
let browser;
try {
    await buildProject({ outputDirectory });
    browser = await browserSession();
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 620,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false
    });
    browser.on('Fetch.requestPaused', async ({ requestId, request }) => {
        if (
            request.url.includes('fonts.googleapis.com') ||
            request.url.includes('fonts.gstatic.com')
        ) {
            await browser.send('Fetch.continueRequest', { requestId });
        } else {
            await browser.send('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
                body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHe8AAAAASUVORK5CYII='
            });
        }
    });
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
    const css = await readFile(path.join(outputDirectory, 'streamelements/style.css'), 'utf8');
    const script = await readFile(path.join(outputDirectory, 'streamelements/index.js'), 'utf8');
    const data = JSON.parse(
        await readFile(path.join(outputDirectory, 'streamelements/data.json'), 'utf8')
    );
    await browser.evaluate(`(() => {
        // Overlay/editor styles must not add margins or line boxes to the theme.
        document.head.innerHTML = '<style>.message { margin-bottom: 20px; } .message-content { font-size: 21px; line-height: 25px; }</style><style id="widget-css"></style>';
        document.getElementById('widget-css').textContent = ${JSON.stringify(css)};
        document.body.innerHTML = '<main id="chat"></main><pre id="diagnostics" hidden></pre>';
    })()`);
    await browser.evaluate(script);
    const result = await browser.evaluate(`(async () => {
        window.dispatchEvent(new CustomEvent('onWidgetLoad',{detail:{fieldData:{
            ...${JSON.stringify(data)}, template:'bubble-chat', channelMode:'custom', customChannels:'',
            messageGapPx:10, enableAnimations:'true'
        }}}));
        document.getElementById('diagnostics').hidden = true;
        const renderer = CHAT_WIDGET_RUNTIME.renderer;
        CHAT_WIDGET_RUNTIME.paints.getCosmetics = async () => null;
        const messages = [
            ['ainhoadless','no deberíais','#ff69b4'],
            ['luisilver20','De donde eres pache','#daa520'],
            ['elconchas300','BRO BRO NOOO','#b8b2ff'],
            ['casper0092','que tal con marlu? pachee','#b8b2ff'],
            ['orazere_','W JEFA','#0000ff'],
            ['emiliojmr07','subir tiempo de','#ff7f50']
        ];
        messages.forEach(([name,text,color],index)=>renderer.add({prefix:name+'!test', tags:{
            id:'m'+index,'display-name':name,color,...(index===5?{'first-msg':'1'}:{})
        }, params:['#test',text]}));
        await document.fonts.ready;
        await new Promise(resolve=>setTimeout(resolve,350));
        renderer.fit();
        const rect = node => {const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height}};
        const panels = renderer.rows.map(record=>({row:rect(record.row),name:rect(record.name),body:rect(record.body),
            tracks:getComputedStyle(record.row).gridTemplateRows,margin:getComputedStyle(record.content).margin,
            lineHeight:getComputedStyle(record.content).lineHeight}));
        return {gap:getComputedStyle(renderer.root).gap,panels,
            gaps:panels.slice(1).map((panel,index)=>panel.name.top-panels[index].body.bottom)};
    })()`);
    await writeFile(
        await artifactPath('bubble-spacing.png'),
        Buffer.from(
            (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
            'base64'
        )
    );
    assert.ok(
        result.gaps.every((gap) => Math.abs(gap - 10) < 1),
        JSON.stringify(result)
    );
    const typography = await browser.evaluate(`(async () => {
        const results = [];
        for (const enabled of [false, true]) {
            const fields = {...${JSON.stringify(data)}, template:'bubble-chat',
                channelMode:'custom', customChannels:'', enableAnimations:'false',
                fontSizePx:32, fontFamily:'monospace', usernameFontFamily:'Georgia', textFontFamily:'Verdana',
                googleFont:'', usernameGoogleFont:'', textGoogleFont:'',
                usernameBold:String(enabled), textShadow:String(enabled),
                showLocalizedUsername:String(enabled), textColor:'rgba(20, 80, 160, 0.4)'};
            window.dispatchEvent(new CustomEvent('onWidgetLoad',{detail:{fieldData:fields}}));
            document.getElementById('diagnostics').hidden = true;
            const renderer = CHAT_WIDGET_RUNTIME.renderer;
            CHAT_WIDGET_RUNTIME.paints.getCosmetics = async () => null;
            const add = (id, text, tags = {}) => renderer.add({prefix:'japanuser!test',
                tags:{id,'display-name':'テスト',color:'#9146ff',...tags},params:['#test',text]});
            add('plain','Hello @japanuser');
            add('action','\\x01ACTION waves\\x01');
            const plain = renderer.rows[0];
            const action = renderer.rows[1];
            const normalShadow = getComputedStyle(plain.body).textShadow;
            renderer.applyPaint(plain.name,{backgroundImage:'linear-gradient(red,blue)'});
            results.push({enabled,
                size:getComputedStyle(plain.body).fontSize,
                general:getComputedStyle(document.body).fontFamily,
                username:getComputedStyle(plain.name).fontFamily,
                message:getComputedStyle(plain.body).fontFamily,
                action:getComputedStyle(action.body).fontFamily,
                nameWeight:getComputedStyle(plain.name).fontWeight,
                mentionWeight:getComputedStyle(plain.body.querySelector('.mention')).fontWeight,
                color:getComputedStyle(plain.body).color,
                actionColor:getComputedStyle(action.body).color,
                name:plain.name.textContent, normalShadow,
                paintedShadow:getComputedStyle(plain.name).textShadow});
        }
        return results;
    })()`);
    for (const item of typography) {
        assert.equal(item.size, '32px');
        assert.equal(item.general, 'monospace');
        assert.equal(item.username, 'Georgia');
        assert.equal(item.message, 'Verdana');
        assert.equal(item.action, 'Verdana');
        assert.equal(item.nameWeight, item.enabled ? '700' : '400');
        assert.equal(item.mentionWeight, item.enabled ? '700' : '400');
        assert.equal(item.color, 'rgba(20, 80, 160, 0.4)');
        assert.equal(item.actionColor, item.color);
        assert.equal(item.name, item.enabled ? 'テスト (japanuser)' : 'テスト');
        assert.equal(item.normalShadow === 'none', !item.enabled);
        assert.equal(item.paintedShadow === 'none', !item.enabled);
    }
    const reply = await browser.evaluate(`(async () => {
        // Reproduce the light checkerboard in the StreamElements editor, with shadows off.
        document.body.style.setProperty('background', '#d4d4d8', 'important');
        window.dispatchEvent(new CustomEvent('onWidgetLoad',{detail:{fieldData:{
            ...${JSON.stringify(data)}, template:'bubble-chat', channelMode:'custom', customChannels:'',
            language:'en', enableAnimations:'false', textShadow:'false', showReplyPreview:'true'
        }}}));
        document.getElementById('diagnostics').hidden = true;
        const renderer = CHAT_WIDGET_RUNTIME.renderer;
        CHAT_WIDGET_RUNTIME.paints.getCosmetics = async () => null;
        renderer.add({prefix:'lordjovan!test',tags:{id:'parent','display-name':'LordJovan',color:'#ff00ff'},params:['#test','eee']});
        renderer.add({prefix:'gitanogitanez!test',tags:{id:'reply','display-name':'GitanoGitanez',
            'reply-parent-msg-id':'parent','reply-parent-user-login':'lordjovan',
            'reply-parent-display-name':'LordJovan','reply-parent-msg-body':'eee'},params:['#test','macarron']});
        await document.fonts.ready;
        renderer.fit();
        const record = renderer.rows[1];
        const context = record.reply;
        const range = document.createRange();
        range.selectNodeContents(context.heading.firstChild);
        const prefix = range.getBoundingClientRect();
        const node = context.node.getBoundingClientRect();
        const name = record.name.getBoundingClientRect();
        return {heading:context.heading.textContent,quote:context.quote.textContent,
            color:getComputedStyle(context.node).color,
            background:getComputedStyle(context.node).backgroundColor,
            prefixWidth:prefix.width, prefixHeight:prefix.height,
            quoteWidth:context.quote.getBoundingClientRect().width,
            quoteVisible:getComputedStyle(context.quote).visibility,
            replyBottom:node.bottom,nameTop:name.top};
    })()`);
    assert.equal(reply.heading, '↪ replying to @LordJovan');
    assert.equal(reply.quote, '— eee');
    assert.equal(reply.color, 'rgb(244, 244, 245)');
    assert.equal(reply.background, 'rgba(0, 0, 0, 0)');
    assert.ok(reply.prefixWidth > 40 && reply.prefixHeight > 0, JSON.stringify(reply));
    assert.ok(reply.quoteWidth > 20 && reply.quoteVisible === 'visible', JSON.stringify(reply));
    assert.ok(reply.replyBottom < reply.nameTop, JSON.stringify(reply));
    await writeFile(
        await artifactPath('bubble-reply-light.png'),
        Buffer.from(
            (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
            'base64'
        )
    );
    const longMessage = await browser.evaluate(`(async () => {
        const hostStyle = document.createElement('style');
        hostStyle.textContent = '.message, .body { height:300px; max-height:300px; overflow:hidden; }';
        document.head.append(hostStyle);
        window.dispatchEvent(new CustomEvent('onWidgetLoad',{detail:{fieldData:{
            ...${JSON.stringify(data)}, template:'bubble-chat', channelMode:'custom', customChannels:'',
            enableAnimations:'false', textShadow:'true'
        }}}));
        document.getElementById('diagnostics').hidden = true;
        const renderer = CHAT_WIDGET_RUNTIME.renderer;
        renderer.root.style.height = '6000px';
        CHAT_WIDGET_RUNTIME.paints.getCosmetics = async () => null;
        const text = 'A long message that must remain complete. '.repeat(70) + ' THE END';
        renderer.add({prefix:'alice!test',tags:{id:'long','display-name':'Alice'},params:['#test',text]});
        await document.fonts.ready;
        renderer.fit();
        const record = renderer.rows[0];
        const body = record.body;
        const range = document.createRange();
        range.selectNodeContents(body.lastChild);
        const last = [...range.getClientRects()].at(-1);
        const bounds = body.getBoundingClientRect();
        const result = {height:bounds.height, client:body.clientHeight, scroll:body.scrollHeight,
            bodyMax:getComputedStyle(body).maxHeight, rowMax:getComputedStyle(record.row).maxHeight,
            overflow:getComputedStyle(body).overflow, fullText:body.textContent===text,
            lastBottom:last.bottom, bodyBottom:bounds.bottom, rowBottom:record.row.getBoundingClientRect().bottom};
        hostStyle.remove();
        renderer.root.style.height = '';
        return result;
    })()`);
    assert.ok(longMessage.height > 300, JSON.stringify(longMessage));
    assert.equal(longMessage.bodyMax, 'none');
    assert.equal(longMessage.rowMax, 'none');
    assert.equal(longMessage.overflow, 'visible');
    assert.ok(longMessage.fullText);
    assert.ok(Math.abs(longMessage.client - longMessage.scroll) <= 1, JSON.stringify(longMessage));
    assert.ok(longMessage.lastBottom <= longMessage.bodyBottom, JSON.stringify(longMessage));
    assert.ok(longMessage.bodyBottom <= longMessage.rowBottom + 0.5, JSON.stringify(longMessage));
    const highlights = await browser.evaluate(`(() => {
        window.renderHighlightCase = template => {
            window.dispatchEvent(new CustomEvent('onWidgetLoad',{detail:{fieldData:{
                ...${JSON.stringify(data)}, template, channelMode:'custom', customChannels:'',
                enableAnimations:'true'
            }}}));
            document.getElementById('diagnostics').hidden = true;
            const renderer = CHAT_WIDGET_RUNTIME.renderer;
            renderer.root.style.height = '5000px';
            CHAT_WIDGET_RUNTIME.paints.getCosmetics = async () => null;
            const tags = [{}, {'first-msg':'1'}, {'msg-id':'highlighted-message'},
                {'first-msg':'1','msg-id':'highlighted-message'}, {'custom-reward-id':'reward'}];
            tags.forEach((extra,index)=>renderer.add({prefix:'alice!test',
                tags:{id:'highlight-'+index,'display-name':'Alice',...extra},params:['#test','Hello chat']}));
            const style = row => getComputedStyle(row,template==='bubble-chat'?'::before':null);
            const rows = renderer.rows;
            const highlight = rows[2].row;
            const decorated = style(highlight);
            const first = getComputedStyle(rows[1].row);
            const box = getComputedStyle(highlight);
            const result = {background:decorated.backgroundImage, size:decorated.backgroundSize,
                animation:decorated.animationName,
                border:box.borderInlineStart, firstBorder:first.borderInlineStart,
                radius:box.borderRadius, firstRadius:first.borderRadius,
                normal:style(rows[0].row).backgroundImage,
                first:style(rows[1].row).backgroundImage,
                combined:style(rows[3].row).backgroundImage,
                ordinaryReward:style(rows[4].row).backgroundImage,
                notices:[...renderer.root.querySelectorAll('.redemption-context')]
                    .map(node=>getComputedStyle(node).display)};
            highlight.classList.add('leaving');
            result.leaving = getComputedStyle(highlight).animationName;
            return result;
        };
        return {classic:renderHighlightCase('classic'),bubble:renderHighlightCase('bubble-chat')};
    })()`);
    assert.ok(highlights.classic.background.startsWith('linear-gradient('));
    assert.equal(highlights.classic.background, highlights.bubble.background);
    assert.equal(highlights.classic.size, '900% 900%');
    assert.equal(highlights.classic.size, highlights.bubble.size);
    assert.ok(highlights.classic.animation.includes('highlight-gradient'));
    assert.ok(highlights.classic.animation.includes('appear'));
    assert.ok(highlights.classic.leaving.includes('disappear'));
    assert.ok(highlights.classic.leaving.includes('highlight-gradient'));
    assert.equal(highlights.classic.border, highlights.classic.firstBorder);
    assert.equal(highlights.classic.radius, highlights.classic.firstRadius);
    assert.equal(highlights.classic.combined, highlights.classic.first);
    assert.equal(highlights.classic.normal, 'none');
    assert.equal(highlights.classic.ordinaryReward, 'none');
    assert.ok(highlights.classic.notices.every((display) => display === 'none'));
    assert.ok(highlights.bubble.notices.every((display) => display === 'none'));
    await browser.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    const reduced = await browser.evaluate(`({classic:renderHighlightCase('classic').animation,
        bubble:renderHighlightCase('bubble-chat').animation})`);
    assert.deepEqual(reduced, { classic: 'none', bubble: 'none' });
    const gradients = await browser.evaluate(`(async () => {
        const results = [];
        for (const template of ['classic','bubble-chat']) for (const enabled of [false,true]) {
            window.dispatchEvent(new CustomEvent('onWidgetLoad',{detail:{fieldData:{
                ...${JSON.stringify(data)}, template, channelMode:'custom', customChannels:'',
                enableAnimations:'false', usernameGradient:String(enabled)
            }}}));
            document.getElementById('diagnostics').hidden = true;
            const renderer = CHAT_WIDGET_RUNTIME.renderer;
            CHAT_WIDGET_RUNTIME.paints.getCosmetics = async()=>null;
            renderer.add({prefix:'nasi!test',tags:{id:'gradient','display-name':'Nasi__',color:'#808080'},params:['#test','Hello']});
            await Promise.resolve();
            const record = renderer.rows[0];
            const background = () => getComputedStyle(template==='bubble-chat'?record.row:record.name,
                template==='bubble-chat'?'::after':null).backgroundImage;
            const plain = background();
            const textColor = getComputedStyle(record.name).color;
            const realPaint = {backgroundImage:'linear-gradient(90deg,red,blue)',filter:'drop-shadow(0 0 4px red)'};
            renderer.applyPaint(record.name,realPaint);
            const equipped = background();
            renderer.applyPaint(record.name,null);
            const cleared = background();
            renderer.refresh();
            const refreshed = background();
            renderer.applyPaint(record.name,{backgroundImage:'invalid-background'});
            const invalid = background();
            renderer.applyPaint(record.name,{backgroundImage:'url("data:image/png;base64,aW52YWxpZA==")'});
            for (let i=0; i<50 && record.name._chatPaint?.backgroundImage.startsWith('url('); i++) {
                await new Promise(resolve=>setTimeout(resolve,10));
            }
            results.push({template,enabled,plain,textColor,equipped,cleared,refreshed,invalid,failed:background()});
        }
        return results;
    })()`);
    for (const item of gradients) {
        if (item.enabled) {
            assert.ok(item.plain.startsWith('linear-gradient('), JSON.stringify(item));
            assert.ok(item.plain.includes('rgb(166, 166, 166) 0%'), JSON.stringify(item));
            assert.ok(item.plain.includes('rgb(128, 128, 128) 50%'), JSON.stringify(item));
            assert.ok(item.plain.includes('rgb(109, 109, 109) 100%'), JSON.stringify(item));
        } else assert.equal(item.plain, 'none');
        if (item.template === 'bubble-chat') assert.equal(item.textColor, 'rgb(255, 255, 255)');
        assert.ok(
            item.equipped.includes('rgb(255, 0, 0)') && item.equipped.includes('rgb(0, 0, 255)')
        );
        assert.equal(item.cleared, item.plain);
        assert.equal(item.refreshed, item.plain);
        assert.equal(item.invalid, item.plain);
        assert.equal(item.failed, item.plain);
    }
    console.log(
        'PASS compiled StreamElements bubble spacing and Typography fields: size, fonts, bold, localized names, color/opacity and shadows'
    );
} finally {
    await browser?.close();
    await rm(outputDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
