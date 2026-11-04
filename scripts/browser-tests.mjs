import { spawnSync } from 'node:child_process';
import { writeStyles } from './styles.mjs';

await writeStyles();

for (const suite of [
    'browser-cleanup-check',
    'spacing-browser-check',
    'visible-spacing-browser-check',
    'paint-browser-check',
    'links-browser-check',
    'demo-browser-check',
    'build-browser-check'
]) {
    const result = spawnSync(process.execPath, [`tests/browser/${suite}.mjs`], {
        windowsHide: true,
        stdio: 'inherit'
    });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}
