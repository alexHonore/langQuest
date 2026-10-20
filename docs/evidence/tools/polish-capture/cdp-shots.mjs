// Headless-Chrome screenshot + text-density driver over the DevTools protocol (no browser pane).
// usage: node cdp-shots.mjs config.json
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.mkdirSync(cfg.outDir, { recursive: true });
const profile = fs.mkdtempSync(path.join(cfg.tmpDir, 'chrome-'));

const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  `--window-size=${cfg.width},${cfg.height}`, '--hide-scrollbars', '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', '--mute-audio', '--lang=' + (cfg.lang ?? 'en-US'), 'about:blank',
]);
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  chrome.on('exit', (c) => reject(new Error('chrome exited ' + c)));
});
const ws = new WebSocket(wsUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let nextId = 1; const pending = new Map(); const listeners = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
  else if (msg.method) for (const l of listeners) l(msg);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params, sessionId })); });
const waitEvent = (method, sessionId, timeout = 15000) => new Promise((resolve) => {
  const t = setTimeout(() => { listeners.splice(listeners.indexOf(l), 1); resolve(null); }, timeout);
  const l = (msg) => { if (msg.method === method && msg.sessionId === sessionId) { clearTimeout(t); listeners.splice(listeners.indexOf(l), 1); resolve(msg.params); } };
  listeners.push(l);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const AUDIT_FN = `(() => {
  const text = document.body.innerText || '';
  const words = text.split(/\\s+/).filter((w) => /[\\p{L}\\p{N}]/u.test(w));
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = (sel) => Array.from(document.querySelectorAll(sel)).filter(vis);
  const headings = q('[role="heading"],h1,h2,h3,h4');
  const buttons = q('[role="button"],button,a[href]');
  const inViewport = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; };
  const textEls = Array.from(document.querySelectorAll('div[dir="auto"],span,p,h1,h2,h3,h4,li,td,th,label')).filter((el) => vis(el) && el.children.length === 0 && el.textContent.trim().length > 0);
  const viewportWords = textEls.filter(inViewport).map((el) => el.textContent.trim()).join(' ').split(/\\s+/).filter((w) => /[\\p{L}\\p{N}]/u.test(w)).length;
  return { words: words.length, viewportWords, chars: text.replace(/\\s+/g, ' ').trim().length, headings: headings.length, headingText: headings.slice(0, 4).map((h) => h.textContent.trim().slice(0, 80)), buttons: buttons.length, textBlocks: textEls.length, docHeight: document.documentElement.scrollHeight, title: document.title, href: location.pathname, sample: text.replace(/\\s+/g, ' ').trim().slice(0, 400) };
})()`;

const results = [];
for (const sc of cfg.scenarios) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => send(m, p, sessionId);
  try {
    await s('Page.enable'); await s('Runtime.enable'); await s('Network.enable');
    const logs = [];
    const logListener = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 600));
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) logs.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    };
    listeners.push(logListener);
    await s('Emulation.setDeviceMetricsOverride', { width: cfg.width, height: cfg.height, deviceScaleFactor: cfg.dsf ?? 2, mobile: cfg.mobile ?? true });
    if (sc.colorScheme) await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: sc.colorScheme }] });
    if (sc.cookies?.length) await s('Network.setCookies', { cookies: sc.cookies });
    const origin = new URL(sc.url).origin;
    if (sc.localStorage) {
      await s('Page.navigate', { url: origin + (sc.primeUrl ?? '/favicon.ico') });
      await waitEvent('Page.loadEventFired', sessionId, 10000);
      const script = Object.entries(sc.localStorage).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(typeof v === 'string' ? v : JSON.stringify(v))});`).join('');
      await s('Runtime.evaluate', { expression: `localStorage.clear(); ${script} localStorage.length` });
    }
    await s('Page.navigate', { url: sc.url });
    await waitEvent('Page.loadEventFired', sessionId, 15000);
    // Settle: wait until the rendered text is stable and no loading marker remains.
    let last = ''; let stable = 0; const started = Date.now();
    while (Date.now() - started < (sc.maxWaitMs ?? 15000)) {
      await sleep(400);
      const { result } = await s('Runtime.evaluate', { expression: 'document.body.innerText', returnByValue: true });
      const txt = result.value ?? '';
      const loading = sc.loadingMarkers?.some((m) => txt.includes(m));
      if (txt === last && !loading && txt.length > 0) { if (++stable >= 2) break; } else stable = 0;
      last = txt;
    }
    await sleep(sc.settleMs ?? cfg.settleMs ?? 900);
    if (sc.beforeShot) { await s('Runtime.evaluate', { expression: sc.beforeShot, awaitPromise: true }); await sleep(600); }
    const audit = (await s('Runtime.evaluate', { expression: AUDIT_FN, returnByValue: true })).result.value;
    const shot = await s('Page.captureScreenshot', { format: 'png' });
    const file = path.join(cfg.outDir, `${cfg.prefix ?? ''}${sc.name}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    let fullFile = null;
    if (sc.fullPage !== false && audit.docHeight > cfg.height + 40) {
      const full = await s('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: cfg.width, height: Math.min(audit.docHeight, 6000), scale: 1 } });
      fullFile = path.join(cfg.outDir, `${cfg.prefix ?? ''}${sc.name}-full.png`);
      fs.writeFileSync(fullFile, Buffer.from(full.data, 'base64'));
    }
    listeners.splice(listeners.indexOf(logListener), 1);
    results.push({ name: sc.name, url: sc.url, file, fullFile, ...audit, logs: logs.slice(0, 12) });
    if (logs.length) console.log('  logs: ' + logs.slice(0, 5).join('\n  logs: '));
    console.log(`${sc.name}: words=${audit.words} viewportWords=${audit.viewportWords} headings=${audit.headings} buttons=${audit.buttons} height=${audit.docHeight} -> ${path.basename(file)}`);
  } catch (e) {
    results.push({ name: sc.name, url: sc.url, error: String(e) });
    console.log(`${sc.name}: ERROR ${e}`);
  } finally {
    await send('Target.closeTarget', { targetId }).catch(() => undefined);
  }
}
fs.writeFileSync(cfg.auditPath ?? path.join(cfg.outDir, (cfg.prefix ?? '') + 'audit.json'), JSON.stringify(results, null, 2));
ws.close(); chrome.kill();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch {}
