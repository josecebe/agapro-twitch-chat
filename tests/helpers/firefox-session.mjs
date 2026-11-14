import { spawn, execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';

// Native WebDriver BiDi avoids a separate driver or automation dependency.
export async function firefoxSession() {
    const candidates = [
        process.env.FIREFOX_PATH,
        ...(process.platform === 'win32'
            ? [
                  'C:/Program Files/Mozilla Firefox/firefox.exe',
                  'C:/Program Files (x86)/Mozilla Firefox/firefox.exe'
              ]
            : process.platform === 'darwin'
              ? ['/Applications/Firefox.app/Contents/MacOS/firefox']
              : ['/usr/bin/firefox'])
    ].filter(Boolean);
    let executable;
    for (const candidate of candidates) {
        try {
            await access(candidate);
            executable = candidate;
            break;
        } catch {}
    }
    if (!executable) return null;
    const profile = await mkdtemp(path.join(os.tmpdir(), 'chat-widget-firefox-'));
    let child, socket;
    let id = 0;
    const pending = new Map();
    async function close() {
        socket?.close();
        for (const request of pending.values()) {
            clearTimeout(request.timer);
            request.reject(Error('Firefox session closed'));
        }
        pending.clear();
        if (child?.pid && child.exitCode === null) {
            if (process.platform === 'win32')
                await promisify(execFile)('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
                    windowsHide: true
                }).catch(() => {});
            else child.kill();
            if (child.exitCode === null)
                await Promise.race([
                    once(child, 'exit'),
                    new Promise((resolve) => setTimeout(resolve, 1500))
                ]);
        }
        if (path.dirname(profile) !== path.resolve(os.tmpdir())) {
            throw Error('Firefox profile is outside the temporary directory');
        }
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
    try {
        child = spawn(
            executable,
            [
                '--headless',
                '--no-remote',
                '--profile',
                profile,
                '--remote-debugging-port',
                '0',
                'about:blank'
            ],
            { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
        );
        const address = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Firefox startup timed out')), 20000);
            let output = '';
            const onData = (chunk) => {
                output += chunk;
                const match = output.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
                if (match) {
                    clearTimeout(timer);
                    resolve(match[1]);
                }
            };
            child.stdout.on('data', onData);
            child.stderr.on('data', onData);
            child.once('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
            child.once('exit', (code) => {
                clearTimeout(timer);
                reject(Error('Firefox exited: ' + code));
            });
        });
        socket = new WebSocket(address + '/session');
        await once(socket, 'open');
        socket.addEventListener('message', (event) => {
            const response = JSON.parse(event.data),
                request = pending.get(response.id);
            if (!request) return;
            pending.delete(response.id);
            clearTimeout(request.timer);
            if (response.type === 'error')
                request.reject(Error(response.error + ': ' + response.message));
            else request.resolve(response.result);
        });
        const send = (method, params = {}) =>
            new Promise((resolve, reject) => {
                const command = ++id;
                const timer = setTimeout(() => {
                    pending.delete(command);
                    reject(Error('Firefox command timed out: ' + method));
                }, 20000);
                pending.set(command, { resolve, reject, timer });
                socket.send(JSON.stringify({ id: command, method, params }));
            });
        await send('session.new', { capabilities: { alwaysMatch: {} } });
        const { context } = await send('browsingContext.create', { type: 'tab' });
        return {
            close,
            send,
            context,
            async evaluate(expression) {
                const result = await send('script.evaluate', {
                    expression: `(async () => JSON.stringify(await (${expression})))()`,
                    target: { context },
                    awaitPromise: true
                });
                if (result.type === 'exception') throw Error(result.exceptionDetails.text);
                return result.result.type === 'undefined'
                    ? undefined
                    : JSON.parse(result.result.value);
            },
            async screenshot() {
                return (
                    await send('browsingContext.captureScreenshot', {
                        context,
                        origin: 'document',
                        format: { type: 'image/png' }
                    })
                ).data;
            }
        };
    } catch (error) {
        await close();
        throw error;
    }
}
