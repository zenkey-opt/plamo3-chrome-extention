// The glass over paragraphs in flight (置換 only), on tests/fixtures/glow.html in the test browser.
// The engine is unloaded before each start, so the requests stay in flight while the model loads (~5 s).
// Checks: which paragraphs get glass, where it sits, the light per background, no scroll bar added,
// background pixels untouched (with and without the light), 併記 and the setting, cleanup.
// node glow_test.mjs [out-dir]   (http.server on 18300 serving tests/fixtures, test browser on CDP 9333;
// after tests/sync-test-ext.sh the browser must be running, or the old service worker keeps answering)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || path.resolve('../.work/glow');
fs.mkdirSync(OUT, { recursive: true });
const URL_ = 'http://127.0.0.1:18300/glow.html';
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 60000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, info = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? `  (${typeof info === 'string' ? info : JSON.stringify(info)})` : ''}`);
};

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res) => (ws.onopen = res));
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, events, close: () => ws.close() };
}

const set = (o) => cdp('sw', `chrome.storage.local.set(${JSON.stringify(o)}).then(() => 'ok')`);
const toggle = (force) => cdp('sw', `(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => (t.url || '').includes('glow.html')); return JSON.stringify(await self.__plamo.togglePage(tab, '${force}')); })()`);
// a cold engine and an empty cache keep the requests in flight while the model loads
const unload = () => cdp('sw', "self.__plamo.cache.clear(), self.__plamo.engineCall('unload').then(() => 'unloaded', (e) => 'unload: ' + e.message)");

// ---------------------------------------------------------------- page
set({ pageGlow: true, pageMode: 'replace' });
for (let i = 0; i < 4; i++) { try { cdp('close', 'glow.html'); } catch { break; } }
cdp('open', URL_);
await sleep(2000);
cdp('activate', 'glow.html');
const target = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find((t) => t.type === 'page' && t.url.includes('glow.html'));
const page = await connect(target.webSocketDebuggerUrl);
await page.send('Runtime.enable');
await page.send('Log.enable');
const ev = async (expression) => {
  const r = await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description;
};
await ev('scrollTo(0, 200), 1');
await sleep(300);
check('fixture: the scroll box really scrolls', JSON.parse(await ev(`(() => { const s = document.querySelector('.scroll'); return JSON.stringify(s.scrollHeight > s.clientHeight + 1); })()`)));

const ISO = `JSON.stringify((() => {
  const P = window.__plamoPage;
  const r = document.createRange();
  const units = [...P.state.inflight.values()].map((u) => {
    const el = u.parent.nodeType === 1 ? u.parent : u.parent.host;
    const id = u.nodes.find((n) => n.id)?.id || el.id || el.closest('[id]')?.id || el.tagName;
    r.setStartBefore(u.nodes[0]); r.setEndAfter(u.nodes[u.nodes.length - 1]);
    const b = r.getBoundingClientRect();
    return { id, rect: [b.left, b.top, b.right, b.bottom].map(Math.round) };
  });
  return { units, glow: P.glow.size, done: P.stats().done, mode: P.state.mode };
})())`;
const FX = `JSON.stringify((() => {
  const h = document.querySelector('plamo-fx');
  const box = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); };
  const fx = !h ? [] : [...h.shadowRoot.querySelectorAll('.fx')].filter((f) => f.style.display !== 'none').map((f) => {
    const b = f.getBoundingClientRect();
    const l = f.querySelector('.layer')?.getBoundingClientRect();
    return { rect: [b.left, b.top, b.right, b.bottom].map(Math.round), on: f.classList.contains('on'), light: f.style.getPropertyValue('--light'),
      layer: l ? [l.left, l.top, l.width, l.height].map(Math.round) : null };
  });
  return { host: !!h, fx, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    header: box('header'), hero: box('.hero'), scroll: box('.scroll'), ellip: box('.ellip') };
})())`;
const iso = () => JSON.parse(cdp('iso', 'glow.html', ISO));
const fxNow = async () => JSON.parse(await ev(FX));
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const near = (a, b, tol = 2) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

// ---------------------------------------------------------------- 置換, setting on
console.log('unload:', unload());
console.log('start:', toggle('on'));
await sleep(900);
let st = iso();
let fx = await fxNow();
const EXCLUDED = ['u-header', 'u-hero', 'u-scroll'];
const eligible = st.units.filter((u) => !EXCLUDED.includes(u.id));
check('requests in flight while the model loads', st.units.length >= 6 && st.done === 0, { inflight: st.units.map((u) => u.id), done: st.done });
check('glass on every paragraph in flight except header, gradient and scroll box', st.glow === eligible.length && fx.fx.length === eligible.length,
  { glow: st.glow, shown: fx.fx.length, eligible: eligible.map((u) => u.id) });
check('no glass over the sticky header, the gradient or the scroll box',
  !fx.fx.some((f) => overlap(f.rect, fx.header) || overlap(f.rect, fx.hero) || overlap(f.rect, fx.scroll)));
// 10 px left/right and 6 px above/below for the faded edge, none on a side something cuts off
const want = (u) => {
  let [l, t, r, b] = u.rect;
  let mr = 10;
  let mt = 6;
  if (u.id === 'u-ellip' && fx.ellip[2] < r) [r, mr] = [fx.ellip[2], 0];
  if (fx.header[3] > t) [t, mt] = [fx.header[3], 0]; // the sticky header covers the top of the first paragraph
  return [Math.max(0, l - 10), t - mt, Math.min(r + mr, fx.cw), b + 6];
};
const placed = eligible.map((u) => ({ id: u.id, want: want(u), got: fx.fx.find((f) => near(f.rect, want(u), 3))?.rect || null }));
check('each glass sits on its text and stops at the header and the ellipsis box', placed.every((p) => p.got), placed.filter((p) => !p.got));
check('the glass adds no horizontal scroll bar', fx.sw <= fx.cw, { scrollWidth: fx.sw, clientWidth: fx.cw });
const layers = [...new Set(fx.fx.map((f) => JSON.stringify(f.layer)))];
check('one light: every paragraph shows a slice of the same band', layers.length === 1 && layers[0] !== 'null', layers);
const lights = Object.fromEntries(eligible.map((u) => [u.id, fx.fx.find((f) => near(f.rect, want(u), 3))?.light]));
check('light per background: white, grey box, dark section',
  /^contrast\(0\.45\) brightness\(1\.379\)$/.test(lights['u-p1']) && /^contrast\(0\.45\) brightness\(1\.3[0-9]+\)$/.test(lights['u-note']) && /^brightness\(.+\) contrast\(1\.0[0-9]+\)$/.test(lights['u-dark']),
  lights);

// background pixels: with the light (A), the light hidden (B), no glass (C), frozen at one moment
const SHADOW = `document.querySelector('plamo-fx').shadowRoot`;
await ev(`${SHADOW}.querySelectorAll('.band').forEach((b) => b.getAnimations().forEach((a) => { a.pause(); a.currentTime = 700; })), 1`);
await sleep(150);
const shot = async (name) => {
  const r = await page.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.result.data, 'base64'));
};
await shot('A.png');
await ev(`${SHADOW}.querySelectorAll('.band').forEach((b) => (b.style.visibility = 'hidden')), 1`);
await sleep(150);
await shot('B.png');
await ev(`(() => { const s = document.createElement('style'); s.id = 'test-off'; s.textContent = '.fx { display: none !important; }'; ${SHADOW}.append(s); return 1; })()`);
await sleep(150);
await shot('C.png');
const still = iso();
await ev(`(() => { const r = ${SHADOW}; r.getElementById('test-off').remove(); r.querySelectorAll('.band').forEach((b) => { b.style.visibility = ''; b.getAnimations().forEach((a) => a.play()); }); return 1; })()`);
check('the three captures show the same untranslated text', still.done === 0, { done: still.done });
const px = JSON.parse(execFileSync('python', ['glow_pixels.py', OUT], { encoding: 'utf8' }));
check('the glass leaves the background as it is (max 2 levels)', px.glassMax <= 2, px);
check('the light leaves the background as it is (max 2 levels)', px.lightMax <= 2, px);
check('the light changes the letters', px.textChanged > 50, px);

// translated: the glass goes
let t0 = Date.now();
while (Date.now() - t0 < 170000 && iso().units.length) await sleep(1000);
await sleep(600);
fx = await fxNow();
st = iso();
check('all done: no glass left', st.units.length === 0 && st.glow === 0 && fx.fx.length === 0, { inflight: st.units.length, glow: st.glow, fx: fx.fx.length });
console.log('stop:', toggle('off'));
await sleep(300);
check('back to the original: the glass layer is gone', !(await fxNow()).host);

// ---------------------------------------------------------------- 併記: no glass
set({ pageMode: 'bilingual' });
unload();
toggle('on');
await sleep(900);
st = iso();
fx = await fxNow();
check('併記: requests in flight, no glass', st.units.length > 0 && st.glow === 0 && fx.fx.length === 0, { inflight: st.units.length, glow: st.glow, fx: fx.fx.length, mode: st.mode });
toggle('off');
set({ pageMode: 'replace' });
await sleep(300);

// ---------------------------------------------------------------- the setting, and switching mode while in flight
set({ pageGlow: false });
unload();
toggle('on');
await sleep(900);
st = iso();
fx = await fxNow();
check('setting off: no glass', st.units.length > 0 && st.glow === 0 && fx.fx.length === 0, { inflight: st.units.length, glow: st.glow });
set({ pageGlow: true });
await sleep(400);
st = iso();
const on = st.units.filter((u) => !EXCLUDED.includes(u.id)).length;
check('setting turned on while translating: glass appears', st.units.length > 0 && st.glow === on && on > 0, { glow: st.glow, eligible: on });
cdp('iso', 'glow.html', "window.__plamoPage.setMode('bilingual'), 1");
await sleep(100);
check('switched to 併記 while translating: glass goes at once', iso().glow === 0 && (await fxNow()).fx.length === 0);
cdp('iso', 'glow.html', "window.__plamoPage.setMode('replace'), 1");
await sleep(400);
st = iso();
check('back to 置換: glass on what is still in flight', st.units.length === 0 || st.glow > 0, { inflight: st.units.length, glow: st.glow });
toggle('off');
await sleep(300);
check('stopped: the glass layer is gone', !(await fxNow()).host);
set({ pageGlow: true, pageMode: 'replace' });

const errors = page.events.filter((e) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'));
check('no errors on the page', errors.length === 0, errors.map((e) => JSON.stringify(e.params).slice(0, 200)).join(' | '));
page.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
