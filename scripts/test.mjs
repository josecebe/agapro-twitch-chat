import { spawnSync } from 'node:child_process';

const suites = [
    'test',
    'mentions',
    'replies',
    'sources',
    'shared-chat',
    'character-art',
    'expiry',
    'dust'
];
for (const suite of suites) {
    const result = spawnSync(process.execPath, [`tests/unit/${suite}.mjs`], { stdio: 'inherit' });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}
const result = spawnSync(
    process.execPath,
    [
        '--test',
        'tests/unit/build.test.mjs',
        'tests/unit/browser-session.test.mjs',
        'tests/unit/i18n.test.mjs',
        'tests/unit/demo.test.mjs'
    ],
    {
        stdio: 'inherit'
    }
);
process.exitCode = result.status === 0 ? 0 : result.status || 1;
