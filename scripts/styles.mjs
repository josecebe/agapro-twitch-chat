import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'sass';

export function compileStyles() {
    return compile(fileURLToPath(new URL('../src/styles.scss', import.meta.url)), {
        style: 'expanded',
        sourceMap: false,
        charset: false
    });
}

export async function writeStyles(result = compileStyles()) {
    await writeFile(new URL('../styles.css', import.meta.url), result.css);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    await writeStyles();
    console.log('CSS generated: styles.css');
}
