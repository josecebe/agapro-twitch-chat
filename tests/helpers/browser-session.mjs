import { spawn, execFile } from 'node:child_process';
import { access, readFile, mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const profilePrefix = 'chat-widget-browser-';

async function defaultBrowser() {
    if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
    const candidates =
        process.platform === 'win32'
            ? [
                  path.join(
                      process.env.PROGRAMFILES || 'C:\\Program Files',
                      'Google/Chrome/Application/chrome.exe'
                  ),
                  path.join(
                      process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
                      'Microsoft/Edge/Application/msedge.exe'
                  ),
                  path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')
              ]
            : process.platform === 'darwin'
              ? [
                    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                    '/Applications/Chromium.app/Contents/MacOS/Chromium'
                ]
              : [
                    '/usr/bin/google-chrome',
                    '/usr/bin/google-chrome-stable',
                    '/usr/bin/chromium',
                    '/usr/bin/chromium-browser'
                ];
    for (const candidate of candidates) {
        try {
            await access(candidate);
            return candidate;
        } catch {
            /* Try the next supported browser. */
        }
    }
    throw Error('Chrome or Chromium not found. Set CHROME_PATH to the browser executable.');
}

export async function browserSession({
    executable,
    profileParent = os.tmpdir(),
    startupTimeoutMs = 20000
} = {}) {
    if (executable === undefined) executable = await defaultBrowser();
    if (typeof executable !== 'string' || !executable) {
        throw TypeError('The browser executable must be a non-empty path');
    }
    const parent = path.resolve(profileParent);
    const profile = await mkdtemp(path.join(parent, profilePrefix));
    const requests = new Map();
    const errors = [];
    const events = new Map();
    let socket;
    let sequence = 0;
    let launchError;
    let exited = false;
    let shutdown;
    const browserProcess = spawn(
        executable,
        [
            '--headless=new',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-background-networking',
            '--disable-extensions',
            '--remote-debugging-port=0',
            '--user-data-dir=' + profile,
            'about:blank'
        ],
        { windowsHide: true, stdio: 'ignore' }
    );
    const exit = new Promise((resolve) => {
        browserProcess.once('exit', () => {
            exited = true;
            resolve();
        });
        browserProcess.once('error', (error) => {
            launchError = error;
            exited = true;
            resolve();
        });
    });

    function settleRequests(error) {
        for (const request of requests.values()) {
            clearTimeout(request.timer);
            if (request.method === 'Browser.close') request.resolve({});
            else request.reject(error);
        }
        requests.clear();
    }

    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                reject(Error('Chrome connection is closed'));
                return;
            }
            const id = ++sequence;
            const timer = setTimeout(
                () => {
                    requests.delete(id);
                    reject(Error('CDP timeout ' + method));
                },
                method === 'Browser.close' ? 1500 : 45000
            );
            requests.set(id, { method, resolve, reject, timer });
            try {
                socket.send(JSON.stringify({ id, method, params }));
            } catch (error) {
                requests.delete(id);
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    async function waitForExit(milliseconds) {
        if (exited) return true;
        let timer;
        try {
            return await Promise.race([
                exit.then(() => true),
                new Promise((resolve) => {
                    timer = setTimeout(() => resolve(false), milliseconds);
                })
            ]);
        } finally {
            clearTimeout(timer);
        }
    }

    async function cleanup() {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', terminate);
        try {
            if (socket?.readyState === WebSocket.OPEN && !exited) {
                await send('Browser.close').catch(() => {});
            }
            socket?.close();
            settleRequests(Error('Chrome session closed'));
            if (!(await waitForExit(1500)) && browserProcess.pid) {
                // Only terminate the process tree created by this session.
                if (process.platform === 'win32') {
                    await execute(
                        'taskkill.exe',
                        ['/PID', String(browserProcess.pid), '/T', '/F'],
                        {
                            windowsHide: true,
                            timeout: 3000
                        }
                    ).catch(() => {});
                } else {
                    browserProcess.kill('SIGKILL');
                }
                if (!(await waitForExit(3000))) {
                    throw Error('Chrome did not exit; profile cleanup cannot proceed');
                }
            }
        } finally {
            events.clear();
            if (!exited && browserProcess.pid) {
                throw Error('Chrome is still running; its profile was not removed');
            }
            // Delete only the fresh directory owned by this session, after Chrome exits.
            if (
                path.dirname(profile) !== parent ||
                !path.basename(profile).startsWith(profilePrefix)
            ) {
                throw Error('Refusing to delete an unexpected browser profile path');
            }
            await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    }

    function close() {
        shutdown ||= cleanup();
        return shutdown;
    }

    function stopOnSignal(code) {
        close().then(
            () => process.exit(code),
            (error) => {
                console.error(error.message);
                process.exit(1);
            }
        );
    }
    function interrupt() {
        stopOnSignal(130);
    }
    function terminate() {
        stopOnSignal(143);
    }
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);

    try {
        let target;
        const deadline = Date.now() + startupTimeoutMs;
        while (Date.now() < deadline) {
            if (launchError) throw launchError;
            if (exited) throw Error('Chrome exited during startup');
            try {
                const port = Number(
                    (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(
                        '\n'
                    )[0]
                );
                const response = await fetch(`http://127.0.0.1:${port}/json`, {
                    signal: AbortSignal.timeout(2000)
                });
                target = (await response.json()).find((entry) => entry.type === 'page');
                if (target) break;
            } catch {}
            await delay(100);
        }
        if (!target) throw Error('Chrome startup timed out');
        socket = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('Chrome connection timed out')), 5000);
            socket.onopen = () => {
                clearTimeout(timer);
                resolve();
            };
            socket.onerror = () => {
                clearTimeout(timer);
                reject(Error('Chrome connection failed'));
            };
        });
        socket.onclose = () => settleRequests(Error('Chrome connection closed'));
        socket.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.method === 'Runtime.exceptionThrown') {
                errors.push(
                    message.params.exceptionDetails.exception?.description ||
                        message.params.exceptionDetails.text
                );
            }
            if (message.method && events.has(message.method)) {
                Promise.resolve()
                    .then(() => events.get(message.method)?.(message.params))
                    .catch((error) => errors.push(error.message));
            }
            const request = requests.get(message.id);
            if (request) {
                requests.delete(message.id);
                clearTimeout(request.timer);
                if (message.error) request.reject(message.error);
                else request.resolve(message.result);
            }
        };
        return {
            profile,
            send,
            errors,
            on: (event, handler) => events.set(event, handler),
            evaluate: async (expression) => {
                const result = await send('Runtime.evaluate', {
                    expression,
                    awaitPromise: true,
                    returnByValue: true
                });
                if (result.exceptionDetails) {
                    throw Error(
                        result.exceptionDetails.exception?.description ||
                            result.exceptionDetails.text
                    );
                }
                return result.result.value;
            },
            close
        };
    } catch (error) {
        try {
            await close();
        } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Chrome startup and cleanup failed');
        }
        throw error;
    }
}
