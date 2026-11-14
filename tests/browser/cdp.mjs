// A minimal Chrome DevTools Protocol client: enough to load the game in headless
// Chrome, press keys, move the mouse, run script and take screenshots. No dependencies.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const CANDIDATES = [
  process.env.NEON_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

const KEYS = {
  Enter: ['Enter', 13], Escape: ['Escape', 27], Space: [' ', 32], ShiftLeft: ['Shift', 16], Backspace: ['Backspace', 8], Tab: ['Tab', 9],
  ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function findChrome() {
  const path = CANDIDATES.find(candidate => candidate && existsSync(candidate));
  if (!path) throw new Error('No Chrome or Edge found. Set NEON_CHROME_PATH to a Chromium-based browser.');
  return path;
}

export async function launch({ width = 1600, height = 900, port = 9347, scale = 1 } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'neon-drift-cdp-'));
  const chrome = spawn(findChrome(), [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--no-first-run', '--no-default-browser-check', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let target = null;
  for (let attempt = 0; attempt < 80 && !target; attempt++) {
    await sleep(125);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find(entry => entry.type === 'page');
    } catch { /* Chrome is still starting. */ }
  }
  if (!target) { chrome.kill(); throw new Error('Chrome did not open a debugging port.'); }

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('CDP socket failed')); });
  let nextId = 0;
  const pending = new Map();
  const problems = [];      // uncaught exceptions and console errors
  const logs = [];
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails;
      problems.push(details.exception?.description || details.text);
    } else if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ');
      logs.push(`${message.params.type}: ${text}`);
      if (message.params.type === 'error') problems.push(text);
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      problems.push(`${message.params.entry.text} ${message.params.entry.url ?? ''}`.trim());
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });

  const page = {
    problems, logs, send, sleep,
    async goto(url) {
      await send('Page.navigate', { url });
      for (let i = 0; i < 100; i++) {
        await sleep(100);
        if (await page.evaluate('document.readyState === "complete"').catch(() => false)) return;
      }
      throw new Error(`Timed out loading ${url}`);
    },
    async resize(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false }); await sleep(250); },
    // Evaluates an expression (or calls a function with JSON arguments) in the page.
    async evaluate(script, ...args) {
      const expression = typeof script === 'function' ? `(${script})(...${JSON.stringify(args)})` : script;
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    async waitFor(script, timeout = 10000, ...args) {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const value = await page.evaluate(script, ...args);
        if (value) return value;
        await sleep(50);
      }
      throw new Error(`Timed out waiting for ${String(script).slice(0, 120)}`);
    },
    async screenshot(path) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(data, 'base64'));
      return path;
    },
    async keyDown(code) {
      const [key, vk] = KEYS[code] ?? [code.replace(/^Key|^Digit/, '').toLowerCase(), code.startsWith('Key') ? code.charCodeAt(3) : 0];
      // Enter and Space carry text, as real key presses do, so focused buttons activate.
      const text = { Enter: String.fromCharCode(13), Space: ' ' }[code];
      await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', code, key, text, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk,
        modifiers: code.startsWith('Shift') ? 8 : 0 });
    },
    async keyUp(code) {
      const [key, vk] = KEYS[code] ?? [code.replace(/^Key|^Digit/, '').toLowerCase(), code.startsWith('Key') ? code.charCodeAt(3) : 0];
      await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    },
    async press(code, hold = 40) { await page.keyDown(code); await sleep(hold); await page.keyUp(code); },
    async mouseMove(x, y) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); },
    async mouseDown(x, y, button = 'left') {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons: { left: 1, right: 2, middle: 4 }[button], clickCount: 1 });
    },
    async mouseUp(x, y, button = 'left') { await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 }); },
    async click(selector) {
      const box = await page.evaluate(sel => {
        const element = document.querySelector(sel);
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }, selector);
      if (!box) throw new Error(`Nothing matches ${selector}`);
      await page.mouseMove(box.x, box.y);
      await page.mouseDown(box.x, box.y);
      await page.mouseUp(box.x, box.y);
    },
    async close() {
      try { await send('Browser.close'); } catch { /* Already gone. */ }
      socket.close();
      await sleep(300);
      chrome.kill();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    },
  };
  return page;
}
