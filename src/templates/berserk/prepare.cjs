const fs = require('node:fs');
const path = require('node:path');

const sides = ['top', 'bottom', 'left', 'right'];
const reference = { width: 1920, height: 1080, left: 122, right: 122, top: 128, bottom: 99 };
function writeChanged(file, contents) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== contents) {
        fs.writeFileSync(file, contents);
    }
}
function parseSvg(svg, file) {
    const root = svg.match(/<svg\b([^>]*)>([\s\S]*)<\/svg\s*>/i);
    const viewBox = root?.[1].match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1];
    const box = viewBox
        ?.trim()
        .split(/[\s,]+/)
        .map(Number);
    if (
        !root ||
        box?.length !== 4 ||
        box.some((value) => !Number.isFinite(value)) ||
        box[2] <= 0 ||
        box[3] <= 0
    ) {
        throw Error('Invalid bubble SVG: ' + file);
    }
    return { box, width: box[2], height: box[3], content: root[2].trim() };
}
function writeBubblePieces(directory, sources) {
    const file = path.join(directory, 'bubble.svg');
    if (!fs.existsSync(file)) return;
    sources.push(file);
    const svg = parseSvg(fs.readFileSync(file, 'utf8'), file);
    const [x, y, width, height] = svg.box;
    // Same cut proportions as the original 1920 x 1080 bubble.
    const left = (width * reference.left) / reference.width;
    const right = (width * reference.right) / reference.width;
    const top = (height * reference.top) / reference.height;
    const bottom = (height * reference.bottom) / reference.height;
    const centre = width - left - right;
    const cuts = {
        top: [x + left, y, centre, top],
        bottom: [x + left, y + height - bottom, centre, bottom],
        left: [x, y, left, height],
        right: [x + width - right, y, right, height]
    };
    for (const [side, box] of Object.entries(cuts)) {
        writeChanged(
            path.join(directory, `bubble-${side}.svg`),
            `<svg xmlns="http://www.w3.org/2000/svg" width="${box[2]}" height="${box[3]}" viewBox="${box.join(' ')}" preserveAspectRatio="none" overflow="hidden">\n${svg.content}\n</svg>\n`
        );
    }
}
function createMasks(directory, sources) {
    const pieces = {};
    for (const side of sides) {
        const file = path.join(directory, `bubble-${side}.svg`);
        if (!fs.existsSync(file)) throw Error('Missing bubble piece: ' + file);
        sources.push(file);
        pieces[side] = parseSvg(fs.readFileSync(file, 'utf8'), file);
    }
    const { top, bottom, left, right } = pieces;
    if (
        top.width !== bottom.width ||
        left.height !== right.height ||
        top.height + bottom.height >= left.height
    ) {
        throw Error('Inconsistent bubble pieces: ' + directory);
    }
    const height = left.height;
    const image = (piece, offsetY = 0, cropHeight = piece.height) => {
        const [x, y, width] = piece.box;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${cropHeight}" viewBox="${x} ${y + offsetY} ${width} ${cropHeight}" preserveAspectRatio="none" overflow="hidden">${piece.content}</svg>`;
        return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    };
    return {
        // Fixed corners, horizontal top/bottom centres and vertical side centres.
        // Standard mask-image layers work in Firefox as well as Chromium.
        images: [
            image(left, 0, top.height),
            image(right, 0, top.height),
            image(left, height - bottom.height, bottom.height),
            image(right, height - bottom.height, bottom.height),
            image(top),
            image(bottom),
            image(left, top.height, height - top.height - bottom.height),
            image(right, top.height, height - top.height - bottom.height)
        ],
        top: top.height,
        bottom: bottom.height,
        left: left.width,
        right: right.width
    };
}
function variantVariables(variant) {
    return `--berserk-bubble-masks: ${variant.images.join(', ')};
--berserk-bubble-top-height: calc(${variant.top}px * var(--berserk-bubble-edge-scale));
--berserk-bubble-bottom-height: calc(${variant.bottom}px * var(--berserk-bubble-edge-scale));
--berserk-bubble-left-width: calc(${variant.left}px * var(--berserk-bubble-edge-scale));
--berserk-bubble-right-width: calc(${variant.right}px * var(--berserk-bubble-edge-scale));`;
}
function prepareBubbles(directory = __dirname) {
    const root = path.join(directory, 'assets/bubbles');
    const sources = [__filename];
    const variants = [];
    const entries = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    for (const entry of entries) {
        if (!/^[a-zA-Z0-9_-]+$/.test(entry.name))
            throw Error(
                'Use letters, numbers, hyphens or underscores for bubble folders: ' + entry.name
            );
        const folder = path.join(root, entry.name);
        if (
            !fs.existsSync(path.join(folder, 'bubble.svg')) &&
            !sides.some((side) => fs.existsSync(path.join(folder, `bubble-${side}.svg`)))
        )
            continue;
        writeBubblePieces(folder, sources);
        variants.push({ id: entry.name, ...createMasks(folder, sources) });
    }
    if (!variants.length) throw Error('No bubble SVG styles found in ' + root);
    const stylesheet = `// Automatically discovered from assets/bubbles; do not edit.\n@mixin variants {\n--berserk-bubble-variants: ${variants.map((variant) => variant.id).join(' ')};\n${variantVariables(variants[0])}\n${variants
        .slice(1)
        .map(
            (variant) =>
                `.message[data-berserk-bubble="${variant.id}"] {\n${variantVariables(variant)}\n}`
        )
        .join('\n')}\n}\n`;
    writeChanged(path.join(directory, '_bubble.scss'), stylesheet);
    return { sources, variants: variants.map((variant) => variant.id) };
}

function pngAsset(directory, name, sources) {
    const file = path.join(directory, 'assets', name + '.png');
    const png = fs.readFileSync(file);
    if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.length < 24) {
        throw Error('Invalid PNG asset: ' + file);
    }
    sources.push(file);
    return {
        image: `url("data:image/png;base64,${png.toString('base64')}")`,
        width: png.readUInt32BE(16),
        height: png.readUInt32BE(20)
    };
}

module.exports = function prepare(directory = __dirname) {
    const result = prepareBubbles(directory);
    const sword = ['tip', 'blade', 'hilt'].map((name) => {
        const asset = pngAsset(directory, name, result.sources);
        return (
            `$${name}: ${asset.image};` +
            (name === 'blade'
                ? ''
                : `\n$${name}-width: ${asset.width};\n$${name}-height: ${asset.height};`)
        );
    });
    writeChanged(
        path.join(directory, '_sword.scss'),
        '// Generated from assets/tip.png, blade.png and hilt.png; do not edit.\n' +
            sword.join('\n') +
            '\n'
    );
    const texture = pngAsset(directory, 'texture', result.sources);
    writeChanged(
        path.join(directory, '_texture.scss'),
        `// Generated from assets/texture.png; do not edit.\n$image: ${texture.image};\n$width: ${texture.width}px;\n$height: ${texture.height}px;\n`
    );
    return result;
};
module.exports.prepareBubbles = prepareBubbles;
