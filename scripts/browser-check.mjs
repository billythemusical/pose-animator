// Opens the show page in headless Chrome, waits, then saves a screenshot and
// the console output, so a change can be checked without a person watching.
//
// Start the dev server first (yarn dev), then:
//   node scripts/browser-check.mjs "/?3d&video=/api/video/four-dancers.mp4" [seconds] [out-folder]
//
// Needs Chrome. Set CHROME_PATH if it isn't in the usual macOS place. This runs
// Chrome with software WebGL, so the fps says little about the show laptop.

import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';

const route = process.argv[2] || '/?3d';
const seconds = Number(process.argv[3] || 25);
const outDir = process.argv[4] || 'browser-check';
const base = process.env.SHOW_URL || 'http://localhost:5173';
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 9333;

if (!existsSync(chrome)) {
  console.error(`Chrome not found at ${chrome}. Set CHROME_PATH.`);
  process.exit(1);
}
mkdirSync(outDir, {recursive: true});
const profile = mkdtempSync(join(tmpdir(), 'pose-animator-chrome-'));
const child = spawn(chrome, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--window-size=800,1600',
  '--autoplay-policy=no-user-gesture-required',
  '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--no-first-run', '--no-default-browser-check',
  'about:blank',
], {stdio: 'ignore'});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const logLines = [];
let ws;
let nextId = 1;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, {resolve, reject});
    ws.send(JSON.stringify({id, method, params}));
  });
}

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {
      // Chrome is still starting.
    }
    await sleep(200);
  }
  throw new Error('Could not reach Chrome');
}

try {
  ws = new WebSocket(await connect());
  await new Promise((resolve) => ws.on('open', resolve));
  ws.on('message', (data) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const {resolve, reject} = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    } else if (message.method === 'Runtime.consoleAPICalled') {
      const {type, args} = message.params;
      logLines.push(`[${type}] ${args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    } else if (message.method === 'Runtime.exceptionThrown') {
      const d = message.params.exceptionDetails;
      logLines.push(`[exception] ${(d.exception && d.exception.description) || d.text}`);
    } else if (message.method === 'Log.entryAdded') {
      const e = message.params.entry;
      logLines.push(`[${e.level}] ${e.text} ${e.url || ''}`);
    }
  });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', {url: base + route});
  await sleep(seconds * 1000);

  const shot = await send('Page.captureScreenshot', {format: 'png'});
  writeFileSync(join(outDir, 'screenshot.png'), Buffer.from(shot.data, 'base64'));
  const status = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({title: document.title, canvas: !!document.querySelector("canvas"),' +
        ' idle: document.getElementById("idle-prompt")?.className})',
    returnByValue: true,
  });
  logLines.push(`[page] ${status.result.value}`);
  // Optional JavaScript to run in the page at the end, e.g. to print the state.
  if (process.env.CHECK_JS) {
    const extra = await send('Runtime.evaluate', {expression: process.env.CHECK_JS, returnByValue: true});
    logLines.push(`[check] ${JSON.stringify(extra.result.value ?? extra.exceptionDetails ?? null)}`);
  }
} finally {
  writeFileSync(join(outDir, 'console.log'), logLines.join('\n') + '\n');
  if (ws) ws.close();
  child.kill();
  rmSync(profile, {recursive: true, force: true});
}
console.log(`Saved ${outDir}/screenshot.png and ${outDir}/console.log (${logLines.length} console lines)`);
