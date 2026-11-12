#!/usr/bin/env node
// Chrome Web Store screenshots (1280x800), taken on store/demo/article.html in the isolated test browser.
//
// Needs the test browser on CDP 9333 with the synced test copy and the 2B model downloaded in that profile:
//   bash tests/launch-test-browser.sh "$(cygpath -am .work/ext-test)"    (as a background process)
//   bash tests/sync-test-ext.sh
// usage: node tools/store-shots.mjs [out-dir]    (default: store/images)
//
// Writes 1-selection.png, 2-page.png, 3-bilingual.png, 4-popup.png and 5-options.png. The toolbar popup is a
// window of its own, so 4-popup.png lays the popup's capture over the page's, at the top right.
// The settings the script changes are put back at the end.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] || join(ROOT, 'store', 'images'));
const BASE = `http://127.0.0.1:${process.env.CDP_PORT || 9333}`;
const ID = 'bhkpaambekhpdikhkccbfdappiogpgnc'; // the test copy keeps the manifest key
const EXT_NAME = 'PLaMo 3 Translate Local';
const W = 1280;
const H = 800;
const POPUP_TEXT = 'Could you send me the recipe for the bread you baked last weekend? I would love to try it at home.';
const KEYS = ['model', 'pageMode', 'pageGlow', 'autoPage', 'targetLang', 'altTargetLang', 'form', 'useTitleContext', 'glossary', 'licenseConsent'];
const SHOT_SETTINGS = { model: '2b-q4km', pageMode: 'replace', pageGlow: false, autoPage: 'off', targetLang: 'ja', altTargetLang: 'en', form: '', useTitleContext: true, glossary: '' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const list = async () => (await fetch(BASE + '/json/list')).json();
const openTab = async (url) => (await fetch(BASE + '/json/new?' + encodeURI(url), { method: 'PUT' })).json();
const closeTab = (t) => fetch(BASE + '/json/close/' + t.id).catch(() => {});

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    } else listeners.forEach((l) => l(m));
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  return new Promise((res, rej) => {
    ws.onopen = () => res({ send, on: (f) => listeners.push(f), close: () => ws.close() });
    ws.onerror = () => rej(new Error('ws error ' + wsUrl));
  });
}

function unwrap(r) {
  if (r.exceptionDetails) throw new Error('JS exception: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}

const evaluate = async (c, expression, contextId) =>
  unwrap(await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) }));

async function waitFor(fn, ok, ms, what) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    try {
      v = await fn();
      if (ok(v)) return v;
    } catch {}
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}; last value ${JSON.stringify(v)}`);
}

// the service worker, woken from the options page when it has stopped
async function sw(expression) {
  let t = (await list()).find((x) => x.type === 'service_worker' && x.url.includes(ID + '/background.js'));
  if (!t) {
    const opt = (await list()).find((x) => x.type === 'page' && x.url.startsWith(`chrome-extension://${ID}/`));
    if (!opt) throw new Error('the service worker is stopped and no extension page is open');
    const c = await connect(opt.webSocketDebuggerUrl);
    await evaluate(c, "chrome.runtime.sendMessage({ type: 'status' }).then(() => 1, () => 0)").catch(() => {});
    c.close();
    t = await waitFor(async () => (await list()).find((x) => x.type === 'service_worker' && x.url.includes(ID + '/background.js')), Boolean, 10000, 'the service worker');
  }
  const c = await connect(t.webSocketDebuggerUrl);
  try {
    return await evaluate(c, expression);
  } finally {
    c.close();
  }
}

// the content scripts' world in the main frame (the one with chrome.runtime)
async function isoEval(target, expression) {
  const c = await connect(target.webSocketDebuggerUrl);
  try {
    const ctxs = [];
    c.on((m) => m.method === 'Runtime.executionContextCreated' && ctxs.push(m.params.context));
    const { frameTree } = await c.send('Page.getFrameTree');
    await c.send('Runtime.enable');
    await sleep(200);
    for (const x of ctxs.filter((x) => x.auxData?.type === 'isolated' && x.name === EXT_NAME && x.auxData?.frameId === frameTree.frame.id)) {
      if ((await evaluate(c, '!!globalThis.chrome?.runtime?.id', x.id)) === true) return await evaluate(c, expression, x.id);
    }
    return undefined;
  } finally {
    c.close();
  }
}

async function frame(c) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
}

async function shoot(c, name) {
  const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(data, 'base64');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== W || h !== H) throw new Error(`${name} is ${w}x${h}, not ${W}x${H}`);
  writeFileSync(join(OUT, name), buf);
  console.log(`wrote ${name}`);
}

const server = createServer((req, res) => {
  if (new URL(req.url, 'http://x').pathname !== '/article.html') return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(readFileSync(join(ROOT, 'store', 'demo', 'article.html')));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/article.html`;
const TAB = `(await chrome.tabs.query({})).find((t) => (t.url || '').startsWith(${JSON.stringify(PAGE)}))`;
const opened = [];
let saved = null;

async function pageDone(target) {
  return waitFor(
    () => isoEval(target, 'window.__plamoPage?.stats?.()'),
    (s) => s && s.visibleTotal > 0 && s.busy === 0 && s.done + s.failed >= s.visibleTotal,
    180000,
    'the page translation',
  );
}

async function toggleOff(pc) {
  await sw(`(async () => (await self.__plamo.togglePage(${TAB})).active)()`);
  await waitFor(() => evaluate(pc, `document.getElementById('p1').textContent.startsWith('Inside the jar')`), Boolean, 10000, 'the original page');
}

try {
  mkdirSync(OUT, { recursive: true });
  // an extension page keeps a way to wake the service worker
  const opt = await openTab(`chrome-extension://${ID}/options/options.html`);
  opened.push(opt);
  await sleep(1500);
  saved = await sw(`chrome.storage.local.get(${JSON.stringify(KEYS)})`);
  await sw(`chrome.storage.local.set(${JSON.stringify(SHOT_SETTINGS)}).then(() => 1)`);
  // load the model before the first shot
  await sw(`self.__plamo.translate({ text: 'Good morning.', useCache: false }).then((r) => r.text)`);

  const page = await openTab(PAGE);
  opened.push(page);
  const pc = await connect(page.webSocketDebuggerUrl);
  await frame(pc);
  await pc.send('Page.bringToFront');
  await waitFor(() => evaluate(pc, 'document.readyState'), (v) => v === 'complete', 10000, 'the demo page');
  await sleep(500);

  // 1) a selected paragraph and its card
  await sw('self.__plamo.cache.clear()');
  await evaluate(pc, `(() => {
    scrollTo(0, 0);
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('p1'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    return getSelection().toString().length;
  })()`);
  await sw(`(async () => { await self.__plamo.showSelection(${TAB}); return 1; })()`);
  const CARD = `[...document.querySelectorAll('plamo-ui')].map((e) => e.shadowRoot).find((r) => r?.querySelector('[role=dialog]'))`;
  await waitFor(() => evaluate(pc, `${CARD}?.querySelector('.foot')?.textContent || ''`), (v) => /秒/.test(v), 120000, 'the selection card');
  await sleep(600);
  await shoot(pc, '1-selection.png');
  await evaluate(pc, `(() => { ${CARD}?.querySelector('.close')?.click(); getSelection().removeAllRanges(); return 1; })()`);

  // 2) the page in Japanese, 3) both languages
  for (const [mode, name] of [['replace', '2-page.png'], ['bilingual', '3-bilingual.png']]) {
    await sw(`chrome.storage.local.set({ pageMode: '${mode}' }).then(() => self.__plamo.cache.clear())`);
    await evaluate(pc, 'scrollTo(0, 0)');
    await sleep(300);
    const r = await sw(`(async () => self.__plamo.togglePage(${TAB}))()`);
    if (!r?.active) throw new Error('page translation did not start: ' + JSON.stringify(r));
    await pageDone(page);
    await evaluate(pc, 'scrollTo(0, 0)');
    await sleep(1500);
    await shoot(pc, name);
    await toggleOff(pc);
  }
  await sw(`chrome.storage.local.set({ pageMode: 'replace' }).then(() => 1)`);

  // 4) the toolbar popup with typed text, over the page
  await evaluate(pc, 'scrollTo(0, 0)');
  await sleep(500);
  const pageShot = (await pc.send('Page.captureScreenshot', { format: 'png' })).data;
  const res = await sw(`chrome.action.openPopup().then(() => 'opened', (e) => 'error: ' + e.message)`);
  if (res !== 'opened') throw new Error('popup: ' + res);
  const popT = await waitFor(async () => (await list()).find((t) => t.url.includes(ID + '/popup/popup.html')), Boolean, 5000, 'the popup');
  const pop = await connect(popT.webSocketDebuggerUrl);
  await pop.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await sleep(800);
  await evaluate(pop, `(() => {
    const i = document.querySelector('#input');
    i.value = ${JSON.stringify(POPUP_TEXT)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return 1;
  })()`);
  await waitFor(() => evaluate(pop, `document.querySelector('#meta').textContent`), (v) => /秒/.test(v), 120000, 'the popup translation');
  await sleep(500);
  const popShot = (await pop.send('Page.captureScreenshot', { format: 'png' })).data;
  const size = await evaluate(pop, '({ w: innerWidth, h: innerHeight })');
  await evaluate(pop, 'window.close()').catch(() => {});
  pop.close();
  const comp = await openTab('about:blank');
  opened.push(comp);
  const cc = await connect(comp.webSocketDebuggerUrl);
  await frame(cc);
  const { frameTree } = await cc.send('Page.getFrameTree');
  await cc.send('Page.setDocumentContent', {
    frameId: frameTree.frame.id,
    html: `<!doctype html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;position:relative">
      <img src="data:image/png;base64,${pageShot}" style="position:absolute;left:0;top:0;width:${W}px;height:${H}px">
      <img src="data:image/png;base64,${popShot}" style="position:absolute;right:16px;top:12px;width:${size.w}px;height:${size.h}px;border-radius:8px;box-shadow:0 0 0 1px rgba(0,0,0,.1),0 10px 32px rgba(0,0,0,.2)">
    </body>`,
  });
  await sleep(500);
  await shoot(cc, '4-popup.png');
  cc.close();

  // 5) the options page asking for the licence before a download: the agreement is taken away for the shot
  // (KEYS puts it back) and the first model not downloaded yet gets its download button pressed
  const oc = await connect(opt.webSocketDebuggerUrl);
  await frame(oc);
  await oc.send('Page.bringToFront');
  await sw(`chrome.storage.local.remove('licenseConsent').then(() => 1)`);
  await oc.send('Page.reload');
  await sleep(3000);
  const asked = await evaluate(oc, `(() => {
    const b = [...document.querySelectorAll('#models button')].find((x) => x.dataset.act === 'download' && !x.hidden);
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!asked) throw new Error('every model is downloaded: nothing to show the licence for');
  await waitFor(() => evaluate(oc, `!document.querySelector('#consent').hidden`), Boolean, 5000, 'the licence summary');
  await sleep(500);
  await shoot(oc, '5-options.png');
  await evaluate(oc, `document.querySelector('#consentCancel').click()`);
  oc.close();
  pc.close();
} finally {
  if (saved) {
    const drop = KEYS.filter((k) => !(k in saved));
    await sw(`chrome.storage.local.set(${JSON.stringify(saved)}).then(() => chrome.storage.local.remove(${JSON.stringify(drop)})).then(() => 1)`).catch((e) => console.error('could not restore the settings: ' + e.message));
  }
  for (const t of opened) await closeTab(t);
  server.close();
}
