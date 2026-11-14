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
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 1000,
        height: 1300,
        deviceScaleFactor: 1,
        mobile: false
    });
    await browser.evaluate(`(() => {
        document.head.innerHTML='<style></style>';
        document.querySelector('style').textContent=${JSON.stringify(compileStyles().css)};
        document.body.innerHTML='<main id="chat"></main><pre id="diagnostics" hidden></pre>';
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer', 'main']));
    await browser.evaluate(`window.alignmentCase = async (template, alignment) => {
        ChatWidget.start({...${JSON.stringify(defaults)},sources:[],template,chatAlignment:alignment,
            enableAnimations:false,layout:'stack-top',fontFamily:'Arial',usernameFontFamily:'Arial',textFontFamily:'Arial',
            googleFont:'',usernameGoogleFont:'',textGoogleFont:''});
        document.getElementById('diagnostics').hidden=true;
        const {renderer,paints}=CHAT_WIDGET_RUNTIME;
        paints.getCosmetics=async()=>null;
        const add=(id,name,text,tags={})=>renderer.add({prefix:name.toLowerCase()+'!test',tags:{id,'display-name':name,color:'#b13344',...tags},params:['#test',text]});
        add('short','Guts','Hola');
        add('long','WWWWWWWWWWWWWWWWWWWWWWWWW','Este mensaje debe quedar dentro del ancho configurado aunque la espada sea mucho más ancha. '.repeat(2));
        add('first','Casca','Primer mensaje',{'first-msg':'1'});
        add('highlight','Casca','Destacado',{'msg-id':'highlighted-message'});
        add('reward','Casca','Recompensa',{'custom-reward-id':'demo'});
        add('reply','Griffith','Una respuesta',{'reply-parent-msg-id':'short','reply-parent-user-login':'guts','reply-parent-display-name':'OrbitaZafiro','reply-parent-msg-body':'Este texto citado tiene que ceder espacio al nombre completo. '.repeat(20)});
        const record=renderer.rows[0];await Promise.resolve();
        const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="lime" d="M0 0h32v32H0z"/></svg>');
        record.badges.append(renderer.image(image,'Badge','badge'));
        await Promise.all([...document.images].map(image=>image.decode()));
        await document.fonts.ready;renderer.fit();
        const root=renderer.root.getBoundingClientRect(),rootStyle=getComputedStyle(renderer.root);
        return {left:root.left,right:root.right,width:root.width,
            contentLeft:root.left+parseFloat(rootStyle.paddingLeft),contentRight:root.right-parseFloat(rootStyle.paddingRight),
            rows:renderer.rows.map(record=>{
                const row=record.row.getBoundingClientRect(),body=record.body.getBoundingClientRect(),name=record.name.getBoundingClientRect();
                const sword=getComputedStyle(record.row,'::after');
                const reply=record.reply?.node.getBoundingClientRect();
                const range=document.createRange();range.selectNodeContents(record.name);
                const badge=record.badges.querySelector('.badge')?.getBoundingClientRect();
                return {id:record.id,rowLeft:row.left,rowRight:row.right,bodyLeft:body.left,bodyRight:body.right,
                    nameLeft:name.left,nameRight:name.right,scale:sword.scale,bodyAlign:getComputedStyle(record.body).textAlign,
                    badgeGap:badge?range.getBoundingClientRect().left-badge.right:null,
                    replyLeft:reply?.left,replyRight:reply?.right,
                    headingClipped:record.reply ? record.reply.heading.scrollWidth>record.reply.heading.clientWidth : false,
                    headingOverflow:record.reply ? getComputedStyle(record.reply.heading).textOverflow : null,
                    quoteClipped:record.reply?.quote ? record.reply.quote.scrollWidth>record.reply.quote.clientWidth : false,
                    labelInside:record.body.contains(record.row.querySelector('.first-message-label'))};
            })};
    }`);
    for (const template of ['classic', 'bubble-chat', 'berserk']) {
        for (const alignment of ['left', 'right']) {
            const result = await browser.evaluate(
                `alignmentCase(${JSON.stringify(template)},${JSON.stringify(alignment)})`
            );
            assert.equal(result.width, 525);
            assert.equal(result.left, alignment === 'right' ? 475 : 0);
            if (template === 'classic') {
                for (const id of ['first', 'highlight', 'reward']) {
                    const row = result.rows.find((row) => row.id === id);
                    assert.ok(
                        Math.abs(row.rowLeft - result.contentLeft) < 1,
                        JSON.stringify({ alignment, id, row, result })
                    );
                    assert.ok(
                        Math.abs(row.rowRight - result.contentRight) < 1,
                        JSON.stringify({ alignment, id, row, result })
                    );
                }
                if (alignment === 'right')
                    assert.ok(
                        result.rows.find((row) => row.id === 'short').rowLeft > result.contentLeft
                    );
            }
            for (const row of result.rows) {
                if (row.replyRight) {
                    assert.equal(
                        row.headingClipped,
                        false,
                        JSON.stringify({ template, alignment, row })
                    );
                    assert.equal(row.headingOverflow, 'clip');
                    assert.equal(row.quoteClipped, true);
                }
                if (template === 'classic') continue;
                if (alignment === 'right') assert.equal(row.bodyAlign, 'right');
                assert.ok(
                    row.bodyLeft >= result.contentLeft - 1,
                    JSON.stringify({ template, alignment, row, result })
                );
                assert.ok(
                    row.bodyRight <= result.contentRight + 1,
                    JSON.stringify({ template, alignment, row, result })
                );
                if (alignment === 'right')
                    assert.ok(Math.abs(row.rowRight - result.contentRight) < 1);
                if (row.replyRight) {
                    assert.ok(
                        row.replyLeft >= result.contentLeft - 1,
                        JSON.stringify({ template, alignment, row })
                    );
                    assert.ok(
                        row.replyRight <= result.contentRight + 1,
                        JSON.stringify({ template, alignment, row })
                    );
                }
            }
            const long = result.rows.find((row) => row.id === 'long');
            if (template !== 'classic') {
                assert.ok(
                    alignment === 'right'
                        ? long.nameLeft < result.contentLeft
                        : long.nameRight > result.contentRight
                );
                assert.ok(Math.abs(result.rows[0].badgeGap - 5.5) < 0.1);
            }
            if (template === 'berserk') {
                if (alignment === 'right') assert.equal(parseFloat(result.rows[0].scale), -1);
                else assert.equal(result.rows[0].scale, 'none');
                assert.equal(result.rows.find((row) => row.id === 'first').labelInside, true);
            }
        }
        if (template !== 'classic')
            await writeFile(
                await artifactPath(`right-${template}.png`),
                Buffer.from(
                    (await browser.send('Page.captureScreenshot', { format: 'png' })).data,
                    'base64'
                )
            );
    }
    for (const template of ['classic', 'bubble-chat', 'berserk'])
        for (const alignment of ['left', 'right']) {
            const media = await browser.evaluate(`(async () => {
            ChatWidget.start({...${JSON.stringify(defaults)},sources:[],template:${JSON.stringify(template)},chatAlignment:${JSON.stringify(alignment)},
                enableAnimations:false,layout:'stack-top',showTwitchGifs:true,fontFamily:'Arial',usernameFontFamily:'Arial',textFontFamily:'Arial',
                googleFont:'',usernameGoogleFont:'',textGoogleFont:''});
            const {renderer,paints}=CHAT_WIDGET_RUNTIME;paints.getCosmetics=async()=>null;
            const originalImage=renderer.image.bind(renderer);
            const image='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="120"><path fill="gold" d="M0 0h72v120H0z"/></svg>');
            renderer.image=(src,alt,cls,...args)=>originalImage(cls==='chat-gif'?image:src,alt,cls,...args);
            const gifTags={gifs:'0-4|demo|https://media4.giphy.com/media/demo/giphy.gif'};
            for(const [id,tags] of [['gif',{}],['gif-first',{'first-msg':'1'}],['gif-reply',{
                'reply-parent-msg-id':'gif','reply-parent-user-login':'longnickname','reply-parent-display-name':'LongNickname',
                'reply-parent-msg-body':'Hola'}],['gif-quote',{
                'reply-parent-msg-id':'gif','reply-parent-user-login':'longnickname','reply-parent-display-name':'LongNickname',
                'reply-parent-msg-body':'[GIF]'}]]) {
                renderer.add({prefix:'longnickname!test',tags:{id,'display-name':'LongNicknameForTheGif',...gifTags,...tags},params:['#test','[GIF]']});
            }
            await Promise.all([...document.images].map(image=>image.decode()));renderer.fit();
            return renderer.rows.map(record=>{
                const image=record.body.querySelector('.chat-gif').getBoundingClientRect();
                const container=${JSON.stringify(template)}==='classic'?record.content:record.body;
                const bounds=container.getBoundingClientRect(),style=getComputedStyle(container);
                let previewGap;
                if(record.reply?.quote) {
                    const heading=document.createRange();heading.selectNodeContents(record.reply.heading);
                    const quote=document.createRange();quote.selectNodeContents(record.reply.quote);
                    previewGap=quote.getBoundingClientRect().left-heading.getBoundingClientRect().right;
                }
                return {id:record.id,left:image.left,right:image.right,
                    previewGap,
                    contentLeft:bounds.left+parseFloat(style.paddingLeft),contentRight:bounds.right-parseFloat(style.paddingRight)};
            });
        })()`);
            assert.equal(media.length, 4);
            for (const row of media) {
                assert.ok(
                    Math.abs(
                        alignment === 'right'
                            ? row.right - row.contentRight
                            : row.left - row.contentLeft
                    ) < 1,
                    JSON.stringify({ template, alignment, row })
                );
                if (alignment === 'right' && row.previewGap !== undefined)
                    assert.ok(
                        row.previewGap >= 0 && row.previewGap < 12,
                        JSON.stringify({ template, alignment, row })
                    );
            }
        }
    const animatedSword = await browser.evaluate(`(() => {
        ChatWidget.start({...${JSON.stringify(defaults)},sources:[],template:'berserk',chatAlignment:'right',
            enableAnimations:true,berserkSwordAnimation:true,googleFont:'',usernameGoogleFont:'',textGoogleFont:''});
        const {renderer,paints}=CHAT_WIDGET_RUNTIME;paints.getCosmetics=async()=>null;
        renderer.add({prefix:'guts!test',tags:{id:'animation','display-name':'Guts'},params:['#test','Hola']});
        const row=renderer.rows[0].row, name=renderer.rows[0].name;
        document.getAnimations().filter(animation=>animation.animationName==='berserk-sword-enter').forEach(animation=>{animation.pause();animation.currentTime=0;});
        const before={scale:getComputedStyle(row,'::after').scale,nameScale:getComputedStyle(name).scale,
            offsets:[getComputedStyle(row,'::after'),getComputedStyle(name),getComputedStyle(renderer.rows[0].badges)].map(style=>parseFloat(style.translate)),
            animation:getComputedStyle(row,'::after').animationName};
        document.getAnimations().forEach(animation=>animation.finish());
        return {...before,after:getComputedStyle(row,'::after').scale};
    })()`);
    assert.equal(parseFloat(animatedSword.scale), -1);
    assert.equal(animatedSword.nameScale, 'none');
    assert.equal(animatedSword.animation, 'berserk-sword-enter');
    assert.deepEqual(animatedSword.offsets, [-28, -28, -28]);
    assert.equal(parseFloat(animatedSword.after), -1);
    await browser.evaluate(`(() => {
        const style=document.createElement('style');style.id='sword-motion-test';
        style.textContent='html,body{background:#fff!important}#diagnostics{display:none!important}#chat .message-content>*{visibility:hidden!important}#chat .message::after{opacity:1!important;filter:none!important}';
        document.head.append(style);
        const {renderer}=CHAT_WIDGET_RUNTIME;renderer.root.classList.add('top');
        const row=renderer.rows[0].row;
        // Restart only the pseudo-element's animation: pixel movement includes
        // its individual mirror scale, unlike inspecting transform alone.
        row.classList.remove('berserk-sword-animated');getComputedStyle(row,'::after').animationName;
        row.classList.add('berserk-sword-animated');
        window.motionSwordAnimation=document.getAnimations().find(animation=>animation.animationName==='berserk-sword-enter' && animation.effect.target===row);
        motionSwordAnimation.pause();motionSwordAnimation.currentTime=0;
    })()`);
    const motionFrames = [];
    for (const time of [0, 320]) {
        await browser.evaluate(`motionSwordAnimation.currentTime=${time}`);
        motionFrames.push(
            (
                await browser.send('Page.captureScreenshot', {
                    format: 'png',
                    clip: { x: 0, y: 0, width: 1000, height: 120, scale: 1 }
                })
            ).data
        );
    }
    const paintedOffsets = await browser.evaluate(`(async () => {
        return Promise.all(${JSON.stringify(motionFrames)}.map(async frame=>{
            const image=new Image();image.src='data:image/png;base64,'+frame;await image.decode();
            const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
            const context=canvas.getContext('2d');context.drawImage(image,0,0);
            const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;
            let left=canvas.width;
            for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++) {
                const offset=(y*canvas.width+x)*4;
                if(pixels[offset]<180 && pixels[offset+1]<180 && pixels[offset+2]<180)left=Math.min(left,x);
            }
            return left;
        }));
    })()`);
    assert.ok(
        Math.abs(paintedOffsets[1] - paintedOffsets[0] - 28) <= 1,
        JSON.stringify(paintedOffsets)
    );
    await browser.evaluate(`document.getElementById('sword-motion-test').remove()`);
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 280,
        height: 2000,
        deviceScaleFactor: 1,
        mobile: false
    });
    for (const template of ['bubble-chat', 'berserk']) {
        const result = await browser.evaluate(`alignmentCase(${JSON.stringify(template)},'right')`);
        assert.equal(result.width, 280);
        assert.equal(result.left, 0);
        for (const row of result.rows) {
            assert.ok(
                row.bodyLeft >= result.contentLeft - 1,
                JSON.stringify({ template, row, result })
            );
            assert.ok(
                row.bodyRight <= result.contentRight + 1,
                JSON.stringify({ template, row, result })
            );
        }
    }
    assert.deepEqual(browser.errors, []);
    console.log(
        'PASS left/right chat alignment, intact overflowing headers, mirrored sword, replies and shared badge gaps'
    );
} finally {
    await browser.close();
}
