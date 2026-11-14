(function (baseURL) {
    'use strict';
    let latestLoad;
    const capture = (event) => {
        latestLoad = event.detail;
    };
    // StreamElements can dispatch its settings while the hosted files load.
    window.addEventListener('onWidgetLoad', capture);
    const detach = () => {
        window.removeEventListener('onWidgetLoad', capture);
        window.removeEventListener('agapro:runtime-ready', ready);
        const detail = latestLoad;
        latestLoad = null;
        return detail;
    };
    const ready = () => {
        const detail = detach();
        if (detail) {
            window.dispatchEvent(new CustomEvent('onWidgetLoad', { detail }));
        }
    };
    window.addEventListener('agapro:runtime-ready', ready);
    const load = (tag, url) =>
        new Promise((resolve, reject) => {
            const node = document.createElement(tag);
            node.onload = resolve;
            node.onerror = () => reject(Error('Could not load ' + url));
            if (tag === 'link') {
                node.rel = 'stylesheet';
                node.href = url;
            } else node.src = url;
            document.head.append(node);
        });
    (async () => {
        const response = await fetch(new URL('manifest.json', baseURL), { cache: 'no-store' });
        if (!response.ok) throw Error('Hosted widget is unavailable (' + response.status + ')');
        const manifest = await response.json();
        // Styles must be ready before the first onWidgetLoad reaches the renderer.
        await load('link', new URL(manifest.css, baseURL).href);
        await load('script', new URL(manifest.js, baseURL).href);
    })().catch((error) => {
        detach();
        const panel = document.getElementById('diagnostics');
        if (panel) {
            panel.hidden = false;
            panel.textContent = 'Unable to load the hosted chat. ' + error.message;
        }
    });
})(AGAPRO_HOSTED_BASE_URL);
