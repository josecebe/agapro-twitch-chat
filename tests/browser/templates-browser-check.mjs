import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { compileStyles } from '../../scripts/styles.mjs';
import { readConfig } from '../../scripts/build.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import { artifactPath } from '../helpers/artifacts.mjs';
import { readTemplates } from '../../scripts/templates.mjs';

const defaults = await readConfig();
const paintFixtures = await Promise.all(
    ['stained-glass-paint', 'epiphany-paint'].map(async (name) =>
        JSON.parse(
            await readFile(new URL('../fixtures/' + name + '.json', import.meta.url), 'utf8')
        )
    )
);
const classicCSS = compileStyles({
    templates: readTemplates().filter((template) => template.config.id === 'classic')
}).css;
const browser = await browserSession();
try {
    await browser.send('Page.enable');
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 480,
        height: 1400,
        deviceScaleFactor: 1,
        mobile: false
    });
    // Keep the regression screenshots independent of Google Fonts availability.
    browser.on('Fetch.requestPaused', async ({ requestId }) => {
        await browser.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/css' }],
            body: ''
        });
    });
    await browser.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*' }] });
    await browser.evaluate(`(() => {
        document.head.innerHTML = '<style id="styles"></style>';
        document.getElementById('styles').textContent = ${JSON.stringify(classicCSS)};
        document.body.innerHTML = '<main id="chat"></main><pre id="diagnostics" hidden></pre>';
        window.testConfig = ${JSON.stringify({ ...defaults, sources: [], enableAnimations: false })};
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer', 'main']));
    await browser.evaluate(`(() => {
        window.messageMarkup = (index = 0) => {
            const node = CHAT_WIDGET_RUNTIME.renderer.rows[index].row.cloneNode(true);
            for (const child of node.querySelectorAll('[style]')) child.removeAttribute('style');
            node.removeAttribute('style');
            return node.innerHTML;
        };
        window.renderTemplate = async template => {
            ChatWidget.start({...testConfig, template});
            document.getElementById('diagnostics').hidden = true;
            const runtime = CHAT_WIDGET_RUNTIME;
            const renderer = runtime.renderer;
            runtime.paints.getCosmetics = async () => null;
            const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="gold"/></svg>');
            runtime.assets.emote = token => token === 'Wave' ? {src:image,ratio:1} : null;
            const add = (id, text, tags = {}) => renderer.add({prefix:'alice!test',
                tags:{id, 'display-name':'Alice', color:'#9146ff', ...tags}, params:['#test',text]});
            add('plain', 'Un mensaje corto');
            add('long', 'Texto largo para comprobar cómo se ajusta la burbuja al espacio disponible sin salirse de la pantalla.');
            add('reply', 'Respuesta con @Alice y Wave', {
                'reply-parent-msg-id':'plain','reply-parent-user-login':'alice',
                'reply-parent-display-name':'Alice','reply-parent-msg-body':'Un mensaje corto'
            });
            add('action', '\\x01ACTION saluda al chat\\x01');
            add('first', 'Mi primer mensaje', {'first-msg':'1'});
            add('reward', 'Una recompensa', {'custom-reward-id':'reward'});
            add('emote', 'Wave');
            await Promise.all([...document.querySelectorAll('img')].map(img => img.decode()));
            await document.fonts.ready;
            renderer.fit();
            return runtime.config;
        };
    })()`);
    const baselineConfig = await browser.evaluate(`renderTemplate('classic')`);
    const screenshot = async () =>
        (await browser.send('Page.captureScreenshot', { format: 'png' })).data;
    const before = await screenshot();
    await browser.evaluate(
        `document.getElementById('styles').textContent = ${JSON.stringify(compileStyles().css)}`
    );
    await browser.evaluate(`renderTemplate('classic')`);
    assert.equal(await screenshot(), before, 'Adding theme CSS must not change any Classic pixels');
    const markup = await browser.evaluate(`messageMarkup()`);
    const replyMarkup = await browser.evaluate(`messageMarkup(2)`);
    const bubbleConfig = await browser.evaluate(`renderTemplate('bubble-chat')`);
    assert.equal(bubbleConfig.fontSizePx, defaults.fontSizePx);
    for (const key of [
        'fontFamily',
        'usernameFontFamily',
        'textFontFamily',
        'googleFont',
        'usernameGoogleFont',
        'textGoogleFont'
    ]) {
        assert.equal(bubbleConfig[key], defaults[key], key);
    }
    assert.equal(bubbleConfig.messageGapPx, defaults.messageGapPx);
    for (const key of [
        'maxMessages',
        'showSevenTVEmotes',
        'hideCommands',
        'showReplies',
        'usernameBold',
        'showLocalizedUsername',
        'textColor',
        'textShadow',
        'messageLineHeight',
        'badgeSizePx',
        'emoteSizePx',
        'moderationAnimation'
    ]) {
        assert.equal(bubbleConfig[key], baselineConfig[key], key);
    }
    assert.equal(
        await browser.evaluate(`messageMarkup()`),
        markup,
        'Both templates must use the same message HTML'
    );
    assert.equal(
        await browser.evaluate(`messageMarkup(2)`),
        replyMarkup,
        'Moving the reply must preserve the shared HTML structure and order'
    );
    const layout = await browser.evaluate(`(() => {
        const renderer = CHAT_WIDGET_RUNTIME.renderer;
        const rows = renderer.rows;
        const frame = renderer.root.getBoundingClientRect();
        const rect = node => {const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width}};
        return {
            padding:getComputedStyle(renderer.root).padding,
            background:getComputedStyle(rows[0].row,'::before').backgroundColor,
            radius:getComputedStyle(rows[0].row,'::before').borderRadius,
            nameBackground:getComputedStyle(rows[0].row,'::after').backgroundColor,
            textSize:getComputedStyle(rows[0].body).fontSize,
            emoteHeight:rows.at(-1).body.querySelector('img').getBoundingClientRect().height,
            rows:rows.map(row=>rect(row.row)), frame:rect(renderer.root),
            panels:rows.map(row=>({row:rect(row.row),name:rect(row.name),body:rect(row.body),reply:row.reply ? rect(row.reply.node) : null,
                fullWidth:row.row.matches('.first-message, .channel-points-redemption, .highlighted-message'),
                tracks:getComputedStyle(row.row).gridTemplateRows})),
            name:rect(rows[0].name), body:rect(rows[0].body),
            reply:rect(rows[2].reply.node), replyName:rect(rows[2].name), replyBody:rect(rows[2].body),
            replyFontSize:getComputedStyle(rows[2].reply.node).fontSize,
            namePadding:{top:parseFloat(getComputedStyle(rows[0].name).paddingTop),
                right:parseFloat(getComputedStyle(rows[0].name).paddingRight)}
        };
    })()`);
    assert.equal(layout.padding, '30px');
    assert.equal(layout.background, defaults.messageBackgroundColor);
    assert.equal(layout.radius, '30px / 25px');
    assert.equal(layout.nameBackground, 'rgb(145, 70, 255)');
    assert.equal(layout.textSize, defaults.fontSizePx + 'px');
    assert.equal(layout.emoteHeight, defaults.emoteSizePx * 4);
    for (const panel of layout.panels) {
        if (panel.fullWidth)
            assert.ok(
                Math.abs(panel.row.width - (layout.frame.width - 60)) < 0.5,
                JSON.stringify(panel)
            );
        else assert.ok(panel.row.width <= layout.frame.width - 60 + 0.5, JSON.stringify(panel));
        assert.ok(Math.abs(panel.body.width - (panel.row.width - 30)) < 0.5, JSON.stringify(panel));
        assert.ok(Math.abs(panel.body.left - panel.row.left - 15) < 0.5, JSON.stringify(panel));
        assert.ok(Math.abs(panel.row.right - panel.body.right - 15) < 0.5, JSON.stringify(panel));
        assert.ok(panel.name.width < panel.row.width, JSON.stringify(panel));
        if (!panel.reply)
            assert.ok(Math.abs(panel.name.top - panel.row.top) < 1, JSON.stringify(panel));
        assert.ok(Math.abs(panel.body.bottom - panel.row.bottom) < 1, JSON.stringify(panel));
    }
    assert.ok(layout.namePadding.top >= 8);
    assert.ok(layout.namePadding.right >= 20);
    assert.ok(
        layout.panels[0].row.width < layout.frame.width - 60 - 20,
        'Short ordinary messages should fit their content'
    );
    assert.ok(
        Math.abs(layout.panels[1].row.width - (layout.frame.width - 60)) < 0.5,
        'Long ordinary messages should use all available width'
    );
    assert.ok(layout.body.top + 36.75 >= layout.name.bottom - 0.5, JSON.stringify(layout));
    assert.ok(layout.replyBody.top >= layout.reply.bottom - 0.5, JSON.stringify(layout));
    assert.ok(layout.reply.bottom <= layout.replyName.top - 4, JSON.stringify(layout));
    assert.ok(
        parseFloat(layout.replyFontSize) < parseFloat(layout.textSize),
        JSON.stringify(layout)
    );
    for (const row of layout.rows) {
        assert.ok(row.left >= layout.frame.left + 30 - 0.5, JSON.stringify(layout));
        assert.ok(row.right <= layout.frame.right - 30 + 0.5, JSON.stringify(layout));
    }
    for (let i = 1; i < layout.rows.length; i++) {
        assert.ok(
            Math.abs(layout.rows[i].top - layout.rows[i - 1].bottom - defaults.messageGapPx) < 0.5,
            JSON.stringify(layout)
        );
    }
    await writeFile(
        await artifactPath('bubble-chat.png'),
        Buffer.from(await screenshot(), 'base64')
    );
    const paint = await browser.evaluate(`(() => {
        const renderer = CHAT_WIDGET_RUNTIME.renderer;
        const record = renderer.rows[0];
        renderer.applyPaint(record.name, {backgroundImage:'linear-gradient(red, blue)',filter:'drop-shadow(0 0 4px red)'});
        const painted = {background:getComputedStyle(record.row,'::after').backgroundImage,
            color:getComputedStyle(record.row,'::after').backgroundColor, text:getComputedStyle(record.name).webkitTextFillColor};
        renderer.applyPaint(record.name, null);
        return {painted, cleared:getComputedStyle(record.row,'::after').backgroundImage};
    })()`);
    assert.equal(paint.painted.background, 'linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))');
    assert.equal(paint.painted.color, 'rgba(0, 0, 0, 0)');
    assert.equal(paint.painted.text, 'rgb(255, 255, 255)');
    assert.equal(paint.cleared, 'none');
    const glows = await browser.evaluate(`(() => {
        const renderer = CHAT_WIDGET_RUNTIME.renderer;
        const record = renderer.rows[0];
        return ${JSON.stringify(paintFixtures)}.map(fixture => {
            const css = ChatWidget.paintCSS(fixture.paint);
            const probe = document.createElement('span');
            probe.style.filter = css.filter;
            document.body.append(probe);
            const expected = getComputedStyle(probe).filter;
            renderer.applyPaint(record.name, css);
            const enabled = getComputedStyle(record.row,'::after').filter;
            document.body.classList.remove('shadow');
            const withoutTextShadow = getComputedStyle(record.row,'::after').filter;
            const textFilter = getComputedStyle(record.name).filter;
            const bodyFilter = getComputedStyle(record.body).filter;
            document.body.classList.toggle('shadow', renderer.config.textShadow);
            renderer.applyPaint(record.name, null);
            const cleared = getComputedStyle(record.row,'::after').filter;
            probe.remove();
            return {expected, enabled, withoutTextShadow, textFilter, bodyFilter, cleared};
        });
    })()`);
    for (const glow of glows) {
        assert.notEqual(glow.expected, 'none');
        assert.equal(glow.enabled, glow.expected);
        assert.equal(glow.withoutTextShadow, glow.expected);
        assert.equal(glow.textFilter, 'none');
        assert.equal(glow.bodyFilter, 'none');
        assert.equal(glow.cleared, 'none');
    }
    const fallbackPaint = await browser.evaluate(`(async () => {
        const renderer = CHAT_WIDGET_RUNTIME.renderer;
        const record = renderer.rows[0];
        const original = getComputedStyle(record.name).color;
        renderer.applyPaint(record.name,{backgroundImage:'not-a-valid-background'});
        const invalid = getComputedStyle(record.row,'::after').backgroundImage;
        renderer.applyPaint(record.name,{backgroundImage:'url("data:image/png;base64,aW52YWxpZA==")',filter:'drop-shadow(0 0 4px red)'});
        for (let i=0; i<50 && record.row.classList.contains('bubble-painted'); i++) {
            await new Promise(resolve=>setTimeout(resolve,10));
        }
        return {invalid, original, restored:getComputedStyle(record.name).color,
            background:getComputedStyle(record.row,'::after').backgroundImage,
            filter:getComputedStyle(record.row,'::after').filter,
            textPaint:record.name.classList.contains('painted')};
    })()`);
    assert.equal(fallbackPaint.invalid, 'none');
    assert.equal(fallbackPaint.background, 'none');
    assert.equal(fallbackPaint.filter, 'none');
    assert.equal(fallbackPaint.restored, fallbackPaint.original);
    assert.equal(fallbackPaint.textPaint, false);
    const missingColors = await browser.evaluate(`(() => {
        const renderer = CHAT_WIDGET_RUNTIME.renderer;
        return [undefined, '', 'invalid', '#b8b2ff', '#ffff00', '#111111'].map((color,index) => {
            renderer.add({prefix:'gitanogitanez!test',tags:{id:'no-color-'+index,
                'display-name':'GitanoGitanez', ...(color===undefined?{}:{color})}, params:['#test','eee']});
            const record = renderer.rows.at(-1);
            const name = getComputedStyle(record.name).color;
            const background = getComputedStyle(record.row,'::after').backgroundColor;
            renderer.applyPaint(record.name,{backgroundImage:'linear-gradient(red,blue)'});
            renderer.applyPaint(record.name,null);
            const restored = getComputedStyle(record.name).color;
            return {name, background, restored};
        });
    })()`);
    for (const result of missingColors) {
        assert.equal(result.name, 'rgb(255, 255, 255)');
        assert.equal(result.restored, result.name);
    }
    assert.ok(
        missingColors.slice(0, 4).every((result) => result.background === 'rgb(184, 178, 255)')
    );
    assert.equal(missingColors[4].background, 'rgb(255, 255, 0)');
    assert.equal(missingColors[5].background, 'rgb(17, 17, 17)');
    const backgrounds = await browser.evaluate(`(async () => {
        const original = testConfig.messageBackgroundColor;
        const results = [];
        for (const color of ['rgba(20, 60, 120, 0.25)', 'rgba(20, 60, 120, 0)', '#143c78']) {
            testConfig.messageBackgroundColor = color;
            await renderTemplate('bubble-chat');
            const row = CHAT_WIDGET_RUNTIME.renderer.rows[0].row;
            results.push({body:getComputedStyle(row,'::before').backgroundColor,
                name:getComputedStyle(row,'::after').backgroundColor});
        }
        testConfig.messageBackgroundColor = original;
        return results;
    })()`);
    assert.deepEqual(
        backgrounds.map((item) => item.body),
        ['rgba(20, 60, 120, 0.25)', 'rgba(20, 60, 120, 0)', 'rgb(20, 60, 120)']
    );
    assert.ok(backgrounds.every((item) => item.name === layout.nameBackground));
    const firstMessages = await browser.evaluate(`(async () => {
        const original = {...testConfig};
        const results = [];
        for (const [color, enabled] of [
            ['rgba(100, 40, 10, 0.35)', true],
            ['rgba(100, 40, 10, 0)', true],
            ['rgba(100, 40, 10, 0.35)', false]
        ]) {
            Object.assign(testConfig, {firstMessageBackgroundColor:color, firstMessageBackground:enabled});
            await renderTemplate('bubble-chat');
            const rows = CHAT_WIDGET_RUNTIME.renderer.rows;
            results.push({first:getComputedStyle(rows[4].row,'::before').backgroundColor,
                normal:getComputedStyle(rows[0].row,'::before').backgroundColor,
                name:getComputedStyle(rows[4].row,'::after').backgroundColor});
        }
        Object.assign(testConfig, original);
        return results;
    })()`);
    assert.equal(firstMessages[0].first, 'rgba(100, 40, 10, 0.35)');
    assert.equal(firstMessages[1].first, 'rgba(100, 40, 10, 0)');
    assert.equal(firstMessages[2].first, defaults.messageBackgroundColor);
    assert.ok(firstMessages.every((item) => item.normal === defaults.messageBackgroundColor));
    assert.ok(firstMessages.every((item) => item.name === layout.nameBackground));
    const fontSizes = await browser.evaluate(`(async () => {
        const original = testConfig.fontSizePx;
        const root = document.getElementById('chat');
        // Keep all sample messages in the layout while testing larger fonts.
        root.style.height = '6000px';
        const results = [];
        for (const size of [12, 25, 40]) {
            testConfig.fontSizePx = size;
            const config = await renderTemplate('bubble-chat');
            const rows = CHAT_WIDGET_RUNTIME.renderer.rows;
            results.push({size, configured:config.fontSizePx,
                name:getComputedStyle(rows[0].name).fontSize,
                body:getComputedStyle(rows[0].body).fontSize,
                reply:getComputedStyle(rows[2].reply.node).fontSize,
                nameBottom:rows[0].name.getBoundingClientRect().bottom,
                bodyTextTop:rows[0].body.getBoundingClientRect().top +
                    parseFloat(getComputedStyle(rows[0].body).paddingTop)});
        }
        testConfig.fontSizePx = original;
        root.style.height = '';
        return results;
    })()`);
    for (const font of fontSizes) {
        assert.equal(font.configured, font.size);
        assert.equal(font.name, font.size + 'px');
        assert.equal(font.body, font.size + 'px');
        assert.ok(Math.abs(parseFloat(font.reply) - font.size * 0.72) < 0.01);
        assert.ok(font.bodyTextTop > font.nameBottom, JSON.stringify(font));
    }
    const families = await browser.evaluate(`(async () => {
        const original = {...testConfig};
        const results = [];
        const cases = [
            {fontFamily:'monospace', usernameFontFamily:'Georgia', textFontFamily:'Verdana',
                googleFont:'', usernameGoogleFont:'', textGoogleFont:''},
            {fontFamily:'monospace', usernameFontFamily:'', textFontFamily:'',
                googleFont:'', usernameGoogleFont:'', textGoogleFont:''},
            {fontFamily:'monospace', usernameFontFamily:'Georgia', textFontFamily:'Verdana',
                googleFont:'Roboto', usernameGoogleFont:'Bungee', textGoogleFont:'Lora'},
            {fontFamily:'monospace', usernameFontFamily:'', textFontFamily:'',
                googleFont:'Roboto', usernameGoogleFont:'', textGoogleFont:''},
            {fontFamily:'monospace', usernameFontFamily:'Georgia', textFontFamily:'Verdana',
                googleFont:'', usernameGoogleFont:'', textGoogleFont:''}
        ];
        for (const fields of cases) {
            Object.assign(testConfig, fields);
            await renderTemplate('bubble-chat');
            const rows = CHAT_WIDGET_RUNTIME.renderer.rows;
            results.push({general:getComputedStyle(document.body).fontFamily,
                username:getComputedStyle(rows[0].name).fontFamily,
                message:getComputedStyle(rows[0].body).fontFamily,
                action:getComputedStyle(rows[3].body).fontFamily,
                links:[...document.querySelectorAll('link[data-chat-google-font]')]
                    .map(link=>link.dataset.chatGoogleFont).sort()});
        }
        Object.assign(testConfig, original);
        return results;
    })()`);
    assert.deepEqual(families[0], {
        general: 'monospace',
        username: 'Georgia',
        message: 'Verdana',
        action: 'Verdana',
        links: []
    });
    assert.deepEqual(families[1], {
        general: 'monospace',
        username: 'monospace',
        message: 'monospace',
        action: 'monospace',
        links: []
    });
    assert.ok(families[2].general.includes('Roboto'));
    assert.ok(families[2].username.includes('Bungee'));
    assert.ok(families[2].message.includes('Lora'));
    assert.equal(families[2].action, families[2].message);
    assert.deepEqual(families[2].links, ['Bungee', 'Lora', 'Roboto']);
    assert.ok(families[3].username.includes('Roboto'));
    assert.ok(families[3].message.includes('Roboto'));
    assert.deepEqual(families[3].links, ['Roboto']);
    assert.deepEqual(families[4], families[0]);
    const media = await browser.evaluate(`(async () => {
        const original = {...testConfig};
        const root = document.getElementById('chat');
        root.style.height = '6000px';
        const results = [];
        for (const [emoteSizePx, badgeSizePx, messageLineHeight] of [[18,20,1], [44,40,2]]) {
            Object.assign(testConfig, {emoteSizePx, badgeSizePx, messageLineHeight});
            await renderTemplate('bubble-chat');
            const runtime = CHAT_WIDGET_RUNTIME;
            const renderer = runtime.renderer;
            const badge = renderer.image(runtime.assets.emote('Wave').src, 'badge', 'badge');
            renderer.rows[0].badges.append(badge);
            const single = renderer.rows.at(-1);
            const mixed = renderer.rows[2];
            renderer.add({prefix:'alice!test',tags:{id:'multi','display-name':'Alice'}, params:['#test','Wave Wave']});
            const multiple = renderer.rows.at(-1);
            await Promise.all([...root.querySelectorAll('img')].map(img => img.decode()));
            renderer.fit();
            results.push({emoteSizePx,badgeSizePx,messageLineHeight,
                badge:badge.getBoundingClientRect().height,
                single:single.body.querySelector('img').getBoundingClientRect().height,
                multiple:multiple.body.querySelector('img').getBoundingClientRect().height,
                mixed:mixed.body.querySelector('img').getBoundingClientRect().height,
                lineHeight:parseFloat(getComputedStyle(renderer.rows[0].body).lineHeight)});
        }
        const renderer = CHAT_WIDGET_RUNTIME.renderer;
        renderer.add({prefix:'alice!test',tags:{id:'long-message','display-name':'Alice'},
            params:['#test','A long message without a hidden height limit. '.repeat(100)]});
        const body = renderer.rows.at(-1).body;
        const long = {height:body.getBoundingClientRect().height, client:body.clientHeight, scroll:body.scrollHeight};
        Object.assign(testConfig, original);
        root.style.height = '';
        return {results,long};
    })()`);
    // The multiplier scales the visible letter height of the message font.
    const naturalLine = media.results[0].lineHeight / media.results[0].messageLineHeight;
    assert.ok(
        naturalLine > defaults.fontSizePx * 0.6 && naturalLine < defaults.fontSizePx * 1.2,
        String(naturalLine)
    );
    for (const item of media.results) {
        assert.equal(item.badge, item.badgeSizePx);
        assert.equal(item.mixed, item.emoteSizePx);
        assert.equal(item.single, item.emoteSizePx * 4);
        assert.equal(item.multiple, item.emoteSizePx * 2);
        assert.ok(
            Math.abs(item.lineHeight - naturalLine * item.messageLineHeight) < 0.1,
            JSON.stringify(item)
        );
    }
    assert.ok(media.long.height > 352.5);
    assert.ok(Math.abs(media.long.client - media.long.scroll) <= 1, JSON.stringify(media.long));
    const variedGaps = await browser.evaluate(`(async () => {
        ChatWidget.start({...testConfig,template:'bubble-chat',showTwitchGifs:false,showLinkFavicons:false});
        document.getElementById('diagnostics').hidden = true;
        const runtime = CHAT_WIDGET_RUNTIME;
        const renderer = runtime.renderer;
        renderer.root.style.height = '6000px';
        runtime.paints.getCosmetics = async()=>null;
        const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="12" fill="white"/></svg>');
        runtime.assets.emote = token=>token==='Wave'?{src:image,ratio:1}:null;
        const messages = [
            ['PrismaNocturno','Enlaces de prueba: https://youtube.com https://twitch.tv'],
            ['PrismaNocturno','\\x01ACTION baila al ritmo de la música 🎵\\x01'],
            ['RayoTurquesa','[GIF]',{gifs:'0-4|test|https://media4.giphy.com/media/test/giphy.gif'}],
            ['ZorroSolar','😀 Wave texto con emotes de Twitch Wave'],
            ['ZorroSolar','¿Qué os está pareciendo el directo de hoy? Wave'],
            ['RayoTurquesa','Respuesta de prueba',{'reply-parent-msg-id':'varied-0',
                'reply-parent-user-login':'prismanocturno','reply-parent-display-name':'PrismaNocturno',
                'reply-parent-msg-body':'Enlaces de prueba'}]
        ];
        messages.forEach(([name,text,tags={}],index)=>renderer.add({prefix:name.toLowerCase()+'!test',
            tags:{id:'varied-'+index,'display-name':name,...tags},params:['#test',text]}));
        await Promise.all([...renderer.root.querySelectorAll('img')].map(img=>img.decode()));
        await document.fonts.ready;
        const paints = ${JSON.stringify(paintFixtures)}.map(fixture=>ChatWidget.paintCSS(fixture.paint));
        // Emulate a nonzero anonymous grid line box from the shared ": " separator.
        // ACTION messages contain only whitespace there and do not create that item.
        renderer.rows.forEach(row=>{row.content.style.lineHeight='30px';});
        renderer.rows.forEach((row,index)=>{if(index!==2)renderer.applyPaint(row.name,paints[index<2?0:1]);});
        renderer.fit();
        const rows = renderer.rows.map(record=>{
            const row = record.row.getBoundingClientRect();
            const name = record.name.getBoundingClientRect();
            const body = record.body.getBoundingClientRect();
            const before = getComputedStyle(record.row,'::before');
            return {top:row.top,bottom:row.bottom,nameTop:name.top,nameBottom:name.bottom,bodyBottom:body.bottom,
                replyTop:record.reply?.node.getBoundingClientRect().top,
                replyBottom:record.reply?.node.getBoundingClientRect().bottom,
                backgroundBottom:name.bottom+parseFloat(before.marginTop)+parseFloat(before.height),
                tracks:getComputedStyle(record.row).gridTemplateRows};
        });
        renderer.root.style.height = '';
        return {gap:runtime.config.messageGapPx,rows};
    })()`);
    for (let i = 1; i < variedGaps.rows.length; i++) {
        const actual =
            (variedGaps.rows[i].replyTop ?? variedGaps.rows[i].nameTop) -
            variedGaps.rows[i - 1].backgroundBottom;
        assert.ok(Math.abs(actual - variedGaps.gap) < 1, JSON.stringify(variedGaps));
    }
    assert.ok(
        variedGaps.rows.at(-1).replyBottom < variedGaps.rows.at(-1).nameTop,
        JSON.stringify(variedGaps)
    );
    const gaps = await browser.evaluate(`(async () => {
        const original = testConfig.messageGapPx;
        const results = [];
        for (const gap of [0, 6, 24]) {
            testConfig.messageGapPx = gap;
            await renderTemplate('bubble-chat');
            const renderer = CHAT_WIDGET_RUNTIME.renderer;
            const badge = renderer.image('data:image/svg+xml,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"/>'), 'badge', 'badge');
            renderer.rows[1].badges.append(badge);
            await badge.decode();
            renderer.fit();
            const rows = renderer.rows;
            const measurements = rows.slice(1).map((row,index) => {
                const previous = rows[index].body.getBoundingClientRect();
                const top = (row.reply?.node || row.name).getBoundingClientRect().top;
                return top - previous.bottom;
            });
            results.push({gap, actual:renderer.root.style.gap || getComputedStyle(renderer.root).gap, measurements});
        }
        testConfig.messageGapPx = original;
        return results;
    })()`);
    for (const result of gaps) {
        assert.equal(result.actual, result.gap + 'px');
        assert.ok(
            result.measurements.every((gap) => Math.abs(gap - result.gap) < 1),
            JSON.stringify(result)
        );
    }
    await browser.evaluate(`renderTemplate('classic')`);
    assert.equal(await screenshot(), before, 'Switching back to Classic must restore every pixel');
    const fallback = await browser.evaluate(`renderTemplate('unknown')`);
    assert.equal(fallback.template, 'classic');
    assert.equal(await screenshot(), before);
    // Narrow layouts must keep header, reply and emotes inside the widget.
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 260,
        height: 1400,
        deviceScaleFactor: 1,
        mobile: false
    });
    await browser.evaluate(`renderTemplate('bubble-chat')`);
    assert.equal(
        await browser.evaluate(`document.getElementById('chat').scrollWidth <= 260`),
        true
    );
    const narrowReply = await browser.evaluate(`(() => {
        const record = CHAT_WIDGET_RUNTIME.renderer.rows.find(row => row.reply);
        const reply = record.reply.node.getBoundingClientRect();
        const name = record.name.getBoundingClientRect();
        return {bottom:reply.bottom, nameTop:name.top, left:reply.left, right:reply.right};
    })()`);
    assert.ok(narrowReply.bottom <= narrowReply.nameTop - 4, JSON.stringify(narrowReply));
    assert.ok(narrowReply.left >= 30 && narrowReply.right <= 230, JSON.stringify(narrowReply));
    assert.deepEqual(browser.errors, []);
    console.log(
        'PASS template selection, Bubble Chat appearance, shared HTML, paints, narrow layouts and pixel-identical Classic before/after switching'
    );
} finally {
    await browser.close();
}
