import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { browserSession } from '../helpers/browser-session.mjs';

async function temporaryParent(context) {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'chat-browser-cleanup-test-'));
    context.after(async () => {
        assert.equal(path.dirname(parent), path.resolve(os.tmpdir()));
        await rm(parent, { recursive: true, force: true });
    });
    return parent;
}

test('missing browser executable removes its fresh profile and signal listeners', async (context) => {
    const parent = await temporaryParent(context);
    const listeners = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')];
    await assert.rejects(
        browserSession({
            executable: path.join(parent, 'missing-browser.exe'),
            profileParent: parent
        }),
        { code: 'ENOENT' }
    );
    assert.deepEqual(await readdir(parent), []);
    assert.deepEqual(
        [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')],
        listeners
    );
});

test('a browser that exits during startup leaves no profile behind', async (context) => {
    const parent = await temporaryParent(context);
    // Node rejects Chrome's flags and exits, exercising cleanup after a successful spawn.
    await assert.rejects(
        browserSession({
            executable: process.execPath,
            profileParent: parent,
            startupTimeoutMs: 1000
        }),
        /exited during startup|startup timed out/
    );
    assert.deepEqual(await readdir(parent), []);
});

test('invalid launch arguments fail before creating a profile', async (context) => {
    const parent = await temporaryParent(context);
    await assert.rejects(browserSession({ executable: null, profileParent: parent }), TypeError);
    assert.deepEqual(await readdir(parent), []);
});
