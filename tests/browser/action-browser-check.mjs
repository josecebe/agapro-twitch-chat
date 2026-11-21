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
        height: 1200,
        deviceScaleFactor: 1,
        mobile: false
    });
    await browser.evaluate(`(() => {
        document.head.innerHTML='<style></style>';document.querySelector('style').textContent=${JSON.stringify(compileStyles().css)};
        document.body.innerHTML='<main id="chat"></main><pre id="diagnostics" hidden></pre>';
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer', 'main']));
    for (const template of ['classic', 'bubble-chat', 'berserk'])
        for (const enabled of [false, true]) {
            const result = await browser.evaluate(`(async () => {
            ChatWidget.start({...${JSON.stringify(defaults)},sources:[],template:${JSON.stringify(template)},showSevenTVPaints:${enabled},
                enableAnimations:false,layout:'stack-top',textColor:'#ddeeff',fontFamily:'Arial',usernameFontFamily:'Arial',textFontFamily:'Arial',
                googleFont:'',usernameGoogleFont:'',textGoogleFont:''});
            const {renderer,paints}=CHAT_WIDGET_RUNTIME;
            const paint={backgroundImage:'linear-gradient(90deg, rgb(255, 0, 0), rgb(0, 0, 255))',filter:'drop-shadow(0px 0px 2px rgb(0, 255, 0))'};
            paints.getCosmetics=async()=>({paint});
            const add=(id,text,tags={})=>renderer.add({prefix:'alice!test',tags:{id,'display-name':'Alice',color:'#2fa84f',...tags},params:['#test',text]});
            add('action',String.fromCharCode(1)+'ACTION saluda al chat'+String.fromCharCode(1),{'first-msg':'1'});
            add('normal','Mensaje normal');
            await Promise.resolve();
            const record=renderer.rows[0],normal=renderer.rows[1];
            const read=()=>{
                const target=record.body._paintTarget||record.body,style=getComputedStyle(target);
                const label=record.row.querySelector('.first-message-label');
                const background=record.body.querySelector('.berserk-bubble-background');
                return {color:getComputedStyle(record.body).color,painted:target.classList.contains('painted'),
                    image:style.backgroundImage,filter:style.filter,fontStyle:style.fontStyle,
                    bodyFilter:getComputedStyle(record.body).filter,labelFill:getComputedStyle(label).webkitTextFillColor,
                    normalColor:getComputedStyle(normal.body).color,normalPainted:normal.body.classList.contains('painted'),
                    pool:background?getComputedStyle(background,'::before').backgroundImage:null,
                    poolShadow:background?getComputedStyle(background).filter:null};
            };
            const before=read();renderer.refresh();const after=read();
            renderer.applyPaint(record.body,null);renderer.refresh();const removed=read();
            return {before,after,removed};
        })()`);
            for (const state of [result.before, result.after]) {
                assert.equal(state.color, 'rgb(47, 168, 79)', template);
                assert.equal(state.painted, enabled, template);
                assert.equal(state.normalColor, 'rgb(221, 238, 255)', template);
                assert.equal(state.normalPainted, false, template);
                assert.notEqual(state.labelFill, 'rgba(0, 0, 0, 0)', template);
                if (enabled) {
                    assert.match(state.image, /linear-gradient/);
                    assert.match(state.filter, /rgb\(0, 255, 0\)/);
                }
                assert.equal(state.fontStyle, 'normal');
                if (template === 'berserk') {
                    assert.equal(state.bodyFilter, 'none');
                    assert.match(state.pool, /data:image\/png/);
                    assert.equal((state.poolShadow.match(/drop-shadow/g) || []).length, 1);
                }
            }
            assert.equal(result.removed.painted, false);
            assert.equal(result.removed.color, 'rgb(47, 168, 79)');
            assert.equal(result.after.pool, result.before.pool);
        }
    assert.deepEqual(browser.errors, []);
    console.log(
        'PASS all templates give /me the author color and enabled 7TV paint, preserve paints on refresh and isolate Berserk decorations'
    );
} finally {
    await browser.close();
}
