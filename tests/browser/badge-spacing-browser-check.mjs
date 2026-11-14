import assert from 'node:assert/strict';
import { compileStyles } from '../../scripts/styles.mjs';
import { readConfig } from '../../scripts/build.mjs';
import { readWidgetScripts } from '../helpers/widget-scripts.mjs';
import { browserSession } from '../helpers/browser-session.mjs';

const defaults = await readConfig();
const browser = await browserSession();
try {
    await browser.send('Emulation.setDeviceMetricsOverride', {
        width: 1000,
        height: 1500,
        deviceScaleFactor: 1,
        mobile: false
    });
    await browser.evaluate(`(() => {
        document.head.innerHTML = '<style></style>';
        document.querySelector('style').textContent = ${JSON.stringify(compileStyles().css)};
        document.body.innerHTML = '<main id="chat"></main><pre id="diagnostics" hidden></pre>';
    })()`);
    await browser.evaluate(readWidgetScripts(['providers', 'renderer', 'main']));
    const results = await browser.evaluate(`(async () => {
        const results = [];
        const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="red" d="M0 0h32v32H0z"/></svg>');
        for (const template of ['classic', 'bubble-chat', 'berserk']) {
            for (const fontSizePx of [18, 25, 40]) {
                ChatWidget.start({...${JSON.stringify(defaults)}, sources: [], template, fontSizePx,
                    fontFamily:'Arial', usernameFontFamily:'Arial', textFontFamily:'Arial',
                    googleFont:'', usernameGoogleFont:'', textGoogleFont:'',
                    enableAnimations:false, layout:'stack-top', showProviderIcon:false});
                const {renderer, paints} = CHAT_WIDGET_RUNTIME;
                paints.getCosmetics = async () => null;
                for (const count of [0, 1, 3]) {
                    renderer.add({prefix:'alice!test',tags:{id:String(count),'display-name':'Alice'},params:['#test','Hello']});
                    const record = renderer.rows.at(-1);
                    await Promise.resolve();
                    for (let i=0; i<count; i++) record.badges.append(renderer.image(image,'badge','badge'));
                    await Promise.all([...record.badges.children].map(img => img.decode()));
                    const badges = [...record.badges.children].map(node => node.getBoundingClientRect());
                    const range = document.createRange();
                    range.selectNodeContents(record.name);
                    const name = range.getBoundingClientRect();
                    results.push({template,fontSizePx,count,
                        gap:count ? name.left-badges.at(-1).right : null,
                        between:badges.slice(1).map((badge,i) => badge.left-badges[i].right),
                        namePadding:parseFloat(getComputedStyle(record.name).paddingLeft)});
                }
            }
        }
        return results;
    })()`);
    for (const result of results) {
        if (result.count) {
            assert.ok(
                Math.abs(result.gap - result.fontSizePx * 0.22) < 0.1,
                JSON.stringify(result)
            );
            for (const gap of result.between)
                assert.ok(Math.abs(gap - result.gap) < 0.1, JSON.stringify(result));
        } else {
            assert.equal(
                result.namePadding,
                { classic: 0, 'bubble-chat': 10, berserk: 3 }[result.template]
            );
        }
    }
    assert.deepEqual(browser.errors, []);
    console.log(
        'PASS all templates match Classic badge/name spacing at multiple font sizes and preserve headers without badges'
    );
} finally {
    await browser.close();
}
