import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { compileStyles } from '../../scripts/styles.mjs';
import { readConfig } from '../../scripts/build.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import { browserSession } from '../helpers/browser-session.mjs';
import { artifactPath } from '../helpers/artifacts.mjs';

const defaults = await readConfig();
const browser = await browserSession();
try {
    await browser.send('Page.enable');
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 1000,
        height: 1100,
        deviceScaleFactor: 1,
        mobile: false
    });
    await browser.evaluate(`(() => {
        document.head.innerHTML = '<style></style>';
        document.querySelector('style').textContent = ${JSON.stringify(compileStyles().css)};
        document.body.innerHTML = '<main id="chat"></main><pre id="diagnostics" hidden></pre>';
        window.testConfig = ${JSON.stringify({ ...defaults, sources: [], enableAnimations: false, layout: 'stack-top', fontFamily: 'Arial', usernameFontFamily: 'Arial', textFontFamily: 'Arial', googleFont: '', usernameGoogleFont: '', textGoogleFont: '' })};
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer', 'main']));
    await browser.evaluate(`window.renderWidthCase = async (template, width) => {
        const config = {...testConfig, template};
        if (width === undefined) delete config.chatMaxWidthPx; else config.chatMaxWidthPx = width;
        ChatWidget.start(config);
        document.getElementById('diagnostics').hidden = true;
        const runtime = CHAT_WIDGET_RUNTIME;
        runtime.paints.getCosmetics = async () => null;
        const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="gold"/></svg>');
        runtime.assets.emote = token => token === 'Wave' ? {src:image,ratio:1} : null;
        const add=(id,text,tags={})=>runtime.renderer.add({prefix:'wide!test',tags:{id,'display-name':'WWWWWWWWWWWWWWWWWWWWWWWWW',color:'#bb3344',...tags},params:['#test',text]});
        add('short','Hola');
        add('long','Este mensaje debe respetar el ancho máximo del contenedor aunque el nick sea más ancho. '.repeat(4));
        add('emote','Wave');
        add('first','Primer mensaje',{'first-msg':'1'});
        await Promise.all([...document.images].map(img=>img.decode()));
        await document.fonts.ready;
        runtime.renderer.fit();
        const chat=document.getElementById('chat'), frame=chat.getBoundingClientRect(), frameStyle=getComputedStyle(chat);
        return {frameWidth:frame.width,contentRight:frame.right-parseFloat(frameStyle.paddingRight),
            normalized:runtime.config.chatMaxWidthPx,
            rows:runtime.renderer.rows.map(record=>{
                const name=record.name.getBoundingClientRect(),body=record.body.getBoundingClientRect(),style=getComputedStyle(record.row,'::after');
                const background=template==='berserk'?record.body.querySelector('.berserk-bubble-background'):null;
                const backgroundStyle=template==='bubble-chat'?getComputedStyle(record.row,'::before'):null;
                return {id:record.id,rowRight:record.row.getBoundingClientRect().right,nameRight:name.right,nameOverflow:getComputedStyle(record.name).overflow,
                    whiteSpace:getComputedStyle(record.name).whiteSpace,bodyRight:body.right,
                    headerRight:record.row.getBoundingClientRect().left+parseFloat(style.width)+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight),
                    backgroundRight:background?background.getBoundingClientRect().right:backgroundStyle?record.row.getBoundingClientRect().left+parseFloat(backgroundStyle.marginLeft)+parseFloat(backgroundStyle.width):body.right};
            })};
    }`);
    for (const template of ['classic', 'berserk', 'bubble-chat']) {
        for (const width of [undefined, 360, 700]) {
            const result = await browser.evaluate(
                `renderWidthCase(${JSON.stringify(template)},${width})`
            );
            assert.equal(result.frameWidth, width ?? 525);
            assert.equal(result.normalized, width ?? 525);
            for (const row of result.rows) {
                if (template === 'classic') {
                    // Inline pre-wrap fragments include invisible hanging spaces.
                    assert.ok(row.rowRight <= result.contentRight + 1);
                    continue;
                }
                assert.ok(
                    row.bodyRight <= result.contentRight + 1,
                    JSON.stringify({ template, width, row, result })
                );
                assert.ok(
                    row.backgroundRight <= result.contentRight + 1,
                    JSON.stringify({ template, width, row, result })
                );
            }
            if (template !== 'classic' && (width ?? 525) <= 525) {
                assert.ok(result.rows[0].nameRight > result.frameWidth);
                assert.ok(result.rows[0].headerRight >= result.rows[0].nameRight - 1);
                assert.equal(result.rows[0].whiteSpace, 'nowrap');
                assert.equal(result.rows[0].nameOverflow, 'visible');
            }
        }
        if (template !== 'classic') {
            await browser.evaluate(`renderWidthCase(${JSON.stringify(template)},525)`);
            await writeFile(
                await artifactPath(`chat-width-${template}.png`),
                Buffer.from(
                    (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
                    'base64'
                )
            );
        }
    }
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 280,
        height: 1600,
        deviceScaleFactor: 1,
        mobile: false
    });
    for (const template of ['berserk', 'bubble-chat']) {
        const result = await browser.evaluate(`renderWidthCase(${JSON.stringify(template)},525)`);
        assert.equal(result.frameWidth, 280);
        for (const row of result.rows) assert.ok(row.bodyRight <= result.contentRight + 1);
        assert.ok(result.rows[0].nameRight > 280);
    }
    assert.deepEqual(browser.errors, []);
    console.log(
        'PASS configured chat width caps message panels while Berserk/Bubble Chat headers overflow intact'
    );
} finally {
    await browser.close();
}
