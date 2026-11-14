export default function createPresentation(config) {
    const settings = config.settings;
    const lastByChat = new WeakMap();
    const firstMessageLabels = new WeakMap();
    const orientations = ['normal', 'horizontal', 'vertical', 'both'];
    return {
        authorColor() {
            return settings.nameColor;
        },
        styleBody(node, userConfig = {}) {
            // One outer layer shadows the complete assembled mask, never its
            // individual slices or the message text. Rendering refreshes clear it.
            if (!node.querySelector('.berserk-bubble-background')) {
                const background = node.ownerDocument.createElement('span');
                background.className = 'berserk-bubble-background';
                background.setAttribute('aria-hidden', 'true');
                node.prepend(background);
            }
            const count = node.querySelectorAll('.emote-stack').length;
            const onlyEmotes = count > 0 && !node.textContent.trim();
            node.style.setProperty(
                '--berserk-emote-scale',
                String(
                    onlyEmotes
                        ? count === 1
                            ? settings.singleEmoteScale
                            : settings.multipleEmoteScale
                        : 1
                )
            );
            node.classList.toggle('berserk-single-emote', onlyEmotes && count === 1);
            const row = node.closest('.message');
            row.classList.toggle(
                'berserk-sword-animated',
                userConfig.berserkSwordAnimation !== false
            );
            // Keep the notice in the same panel as the message. Retain its node
            // when the renderer rebuilds the body after an emote refresh.
            const label = firstMessageLabels.get(row) || row.querySelector('.first-message-label');
            if (label) {
                firstMessageLabels.set(row, label);
                node.prepend(label);
            }
            if (!row.dataset.berserkBubble || !row.dataset.berserkBubbleOrientation) {
                const chat = node.ownerDocument.getElementById('chat');
                const variants = getComputedStyle(chat)
                    .getPropertyValue('--berserk-bubble-variants')
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean);
                if (variants.length) {
                    const previous = lastByChat.get(chat);
                    const candidates =
                        variants.length > 1
                            ? variants.filter((variant) => variant !== previous?.base)
                            : variants;
                    const base = candidates[Math.floor(Math.random() * candidates.length)];
                    // With a single base, avoid repeating its orientation instead.
                    const flips =
                        base === previous?.base
                            ? orientations.filter(
                                  (orientation) => orientation !== previous.orientation
                              )
                            : orientations;
                    const orientation = flips[Math.floor(Math.random() * flips.length)];
                    row.dataset.berserkBubble = base;
                    row.dataset.berserkBubbleOrientation = orientation;
                    lastByChat.set(chat, { base, orientation });
                }
            }
            // Pick once per message, including when its emotes refresh later.
            if (!row.style.getPropertyValue('--berserk-texture-x')) {
                row.style.setProperty('--berserk-texture-x', `${Math.random() * 100}%`);
                row.style.setProperty('--berserk-texture-y', `${Math.random() * 100}%`);
            }
        },
        // White lettering stays readable and paints never replace the sword artwork.
        paintAuthor(node) {
            if (!node.classList.contains('name')) return;
            node.style.color = config.settings.nameColor;
            return '';
        }
    };
}
