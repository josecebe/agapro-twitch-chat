export default function createPresentation(config) {
    const settings = config.settings;
    return {
        authorColor(row, color) {
            row.style.setProperty('--bubble-user-color', color);
            return settings.nameColor;
        },
        styleBody(node) {
            const count = node.querySelectorAll('.emote-stack').length;
            const onlyEmotes = count > 0 && !node.textContent.trim();
            node.style.setProperty(
                '--bubble-emote-scale',
                String(
                    onlyEmotes
                        ? count === 1
                            ? settings.singleEmoteScale
                            : settings.multipleEmoteScale
                        : 1
                )
            );
            node.classList.toggle('bubble-single-emote', onlyEmotes && count === 1);
        },
        paintAuthor(node, css) {
            if (!node.classList.contains('name')) return;
            const row = node.closest('.message');
            const probe = document.createElement('span');
            probe.style.backgroundImage = css?.backgroundImage || '';
            const background = probe.style.backgroundImage;
            const painted = !!background && background !== 'none';
            probe.style.filter = painted ? css?.filter || '' : '';
            row.classList.toggle('bubble-painted', painted);
            row.style.setProperty('--bubble-name-paint', background || 'none');
            row.style.setProperty('--bubble-name-filter', probe.style.filter || 'none');
            node.style.color = settings.nameColor;
            return painted ? background : '';
        }
    };
}
