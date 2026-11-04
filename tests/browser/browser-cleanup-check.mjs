import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { browserSession } from '../helpers/browser-session.mjs';

const initialListeners = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
const browser = await browserSession();
assert.equal(path.dirname(browser.profile), path.resolve(os.tmpdir()));
assert.ok((await stat(browser.profile)).isDirectory());
try {
    await assert.rejects(async () => {
        assert.equal(await browser.evaluate('6 * 7'), 42);
        throw Error('Deliberate test failure');
    }, /Deliberate test failure/);
} finally {
    await browser.close();
}
await assert.rejects(stat(browser.profile), { code: 'ENOENT' });
await browser.close();

const closed = await browserSession();
try {
    await closed.send('Browser.close');
} finally {
    await closed.close();
}
await assert.rejects(stat(closed.profile), { code: 'ENOENT' });
assert.deepEqual(
    [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')],
    initialListeners
);
console.log(
    'PASS temporary profiles removed after test failure, normal shutdown, and repeated close'
);
