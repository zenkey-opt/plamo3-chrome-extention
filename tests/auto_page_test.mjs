// 「外国語のページを開いたとき」 in the test browser over CDP: the options switch and the content-script
// registration, the offer in the page pill, 「このサイトでは尋ねない」, automatic translation, background
// tabs, a notranslate page, Japanese text under a wrong lang attribute, the popup's per-site checkbox and
// 「何もしない」 again. Also times the language check (text sample + chrome.i18n.detectLanguage) per page.
// Needs: tests/launch-test-browser.sh running with the synced test copy (tests/sync-test-ext.sh), an http
// server on 18300 serving tests/fixtures, and a downloaded model in the test profile.
// usage: node tests/auto_page_test.mjs [screenshot-dir]
import { writeFileSync } from 'node:fs';

const BASE = `http://127.0.0.1:${process.env.CDP_PORT || 9333}`;
const FIX = 'http://127.0.0.1:18300/';
const ID = 'bhkpaambekhpdikhkccbfdappiogpgnc';
const EXT_NAME = 'PLaMo 3 Translate Local';
const SHOTS = process.argv[2] || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('ws error'));
  });
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
  return { send, on: (f) => listeners.push(f), close: () => ws.close() };
}

const list = async () => (await fetch(BASE + '/json/list')).json();
const unwrap = (r) => {
  if (r.exceptionDetails) throw new Error('JS exception: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
};

async function evaluate(t, expression) {
  const c = await connect(t.webSocketDebuggerUrl);
  try {
    return unwrap(await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }));
  } finally {
    c.close();
  }
}

// the content scripts' isolated world in the main frame (null when no content script runs there)
async function isoEval(t, expression) {
  const c = await connect(t.webSocketDebuggerUrl);
  try {
    const ctxs = [];
    c.on((m) => m.method === 'Runtime.executionContextCreated' && ctxs.push(m.params.context));
    const main = (await c.send('Page.getFrameTree')).frameTree.frame.id;
    await c.send('Runtime.enable');
    const find = () => ctxs.find((x) => x.auxData?.type === 'isolated' && x.name === EXT_NAME && x.auxData?.frameId === main);
    for (let i = 0; i < 20 && !find(); i++) await sleep(100); // contexts arrive as events after Runtime.enable
    const ctx = find();
    if (!ctx) return null;
    return unwrap(await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, contextId: ctx.id }));
  } finally {
    c.close();
  }
}

let browser;
async function openTab(url, background = false) {
  const { targetId } = await browser.send('Target.createTarget', { url, background });
  for (let i = 0; i < 40; i++) {
    const t = (await list()).find((x) => x.id === targetId);
    if (t?.webSocketDebuggerUrl) return t;
    await sleep(100);
  }
  throw new Error('tab did not appear: ' + url);
}
const closeTab = (t) => browser.send('Target.closeTarget', { targetId: t.id }).catch(() => {});
const front = (t) => browser.send('Target.activateTarget', { targetId: t.id });

async function waitFor(fn, ok, ms) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await fn().catch(() => undefined);
    if (ok(v)) return v;
    await sleep(300);
  }
  return null;
}

// a real mouse click (a user gesture) in the middle of the element the expression returns
async function click(t, elExpr) {
  const r = await evaluate(t, `(() => { const e = ${elExpr}; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  const c = await connect(t.webSocketDebuggerUrl);
  try {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
    await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  } finally {
    c.close();
  }
}

async function shot(t, file, scheme, w, h, clipExpr) {
  if (!SHOTS) return;
  const c = await connect(t.webSocketDebuggerUrl);
  try {
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    // w = 0: keep the window's own size (an action popup does not take a metrics override)
    if (w) await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    let clip;
    if (clipExpr) {
      const r = unwrap(await c.send('Runtime.evaluate', { expression: clipExpr, returnByValue: true }));
      clip = { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 };
    }
    const { data } = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!clip, ...(clip ? { clip } : {}) });
    writeFileSync(`${SHOTS}/${file}`, Buffer.from(data, 'base64'));
    await c.send('Emulation.setEmulatedMedia', { features: [] });
    if (w) await c.send('Emulation.clearDeviceMetricsOverride');
  } finally {
    c.close();
  }
}

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`);
}

// state of the page pill (null: none)
const PILL = `(() => {
  const r = [...document.querySelectorAll('plamo-ui')].map((h) => h.shadowRoot).find((x) => x?.querySelector('.pill'));
  if (!r) return null;
  const q = (s) => r.querySelector(s);
  const shown = (e) => !!e && !e.hidden;
  return { msg: q('.msg').textContent, go: shown(q('.go')) ? q('.go').textContent : null, never: shown(q('.never')),
    off: shown(q('.off')), min: q('.pill').classList.contains('min'), x: q('.x').getAttribute('aria-label'), role: q('.msg').getAttribute('role') };
})()`;
const IN_PILL = (sel) => `[...document.querySelectorAll('plamo-ui')].map((h) => h.shadowRoot?.querySelector('${sel}')).find(Boolean)`;
const PILL_RECT = `(() => { const p = ${IN_PILL('.pill')}; const r = p.getBoundingClientRect(); return { x: r.x - 24, y: r.y - 24, w: r.width + 48, h: r.height + 48 }; })()`;

// the language check content/detect.js does, timed in the content-script world of the page
const DETECT_COST = `(async () => {
  const SKIP = 'script,style,noscript,template,textarea,pre,code,kbd,samp,svg,math,[translate="no"],.notranslate';
  const t0 = performance.now();
  let out = document.title + '\\n';
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n && out.length < 3000; n = w.nextNode()) {
    const t = n.nodeValue.trim();
    if (t.length < 2 || n.parentElement?.closest(SKIP)) continue;
    out += t + '\\n';
  }
  const t1 = performance.now();
  const r = await chrome.i18n.detectLanguage(out);
  const t2 = performance.now();
  return { sampleMs: +(t1 - t0).toFixed(2), detectMs: +(t2 - t1).toFixed(2), chars: out.length, lang: r.languages[0]?.language, pct: r.languages[0]?.percentage, reliable: r.isReliable };
})()`;

browser = await connect((await (await fetch(BASE + '/json/version')).json()).webSocketDebuggerUrl);
for (const t of await list()) if (/options\/options\.html|popup\/popup\.html|127\.0\.0\.1:18300/.test(t.url)) await closeTab(t);
const opt = await openTab(`chrome-extension://${ID}/options/options.html`);
await sleep(1500);
await evaluate(opt, `chrome.storage.local.set({ autoPage: 'off', autoPageSkip: '' }).then(() => 1)`);
await sleep(800);

const optState = () =>
  evaluate(opt, `(async () => ({ seg: document.querySelector('#autoPage [aria-pressed="true"]')?.dataset.v,
    more: !document.querySelector('#autoPageMore').hidden,
    warn: document.querySelector('#autoPageWarn').hidden ? '' : document.querySelector('#autoPageWarn').textContent,
    stored: (await chrome.storage.local.get('autoPage')).autoPage,
    scripts: (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id) }))()`);
async function setMode(v) {
  await front(opt);
  await click(opt, `document.querySelector('#autoPage [data-v="${v}"]')`);
  return waitFor(optState, (s) => s && s.stored === v && (v === 'off') !== s.scripts.includes('plamo-detect'), 5000).then((s) => s || optState());
}

// 1) 尋ねる
let s = await setMode('ask');
check('尋ねる: saved, detect script registered, site list shown, no warning', s.seg === 'ask' && s.stored === 'ask' && s.scripts.includes('plamo-detect') && s.more && !s.warn, JSON.stringify(s));
await shot(opt, 'options_light.png', 'light', 900, 2400, `(() => { scrollTo(0, 0); const r = document.querySelector('#autoPage').closest('section').getBoundingClientRect(); return { x: r.x - 16, y: r.y - 16, w: r.width + 32, h: r.height + 32 }; })()`);
await shot(opt, 'options_dark.png', 'dark', 900, 2400, `(() => { scrollTo(0, 0); const r = document.querySelector('#autoPage').closest('section').getBoundingClientRect(); return { x: r.x - 16, y: r.y - 16, w: r.width + 32, h: r.height + 32 }; })()`);

// 2) an English page: the offer
let t0 = Date.now();
let art = await openTab(FIX + 'article.html');
let p = await waitFor(() => evaluate(art, PILL), (v) => v?.go, 15000);
check('English page: offer in the pill', p?.go === '日本語に翻訳' && p.msg === '英語のページ' && p.never && !p.off && p.x === '閉じる' && p.role === 'status', `${JSON.stringify(p)}, ${Date.now() - t0} ms after opening`);
await shot(art, 'offer_light.png', 'light', 1100, 760, PILL_RECT);
await shot(art, 'offer_dark.png', 'dark', 1100, 760, PILL_RECT);
console.log('     language check cost (article.html):', JSON.stringify(await isoEval(art, DETECT_COST)));

// 3) 日本語に翻訳
p = await evaluate(art, PILL);
if (p?.min) await click(art, IN_PILL('.badge'));
await click(art, IN_PILL('.go'));
p = await waitFor(() => evaluate(art, PILL), (v) => /翻訳済み/.test(v?.msg || ''), 90000);
const translated = await evaluate(art, `/[ぁ-んァ-ン]/.test(document.querySelector('p').textContent)`);
check('翻訳 button: page translated', !!p && p.off && translated, JSON.stringify(p));
await closeTab(art);

// 4) Japanese text under lang="en"
let tab = await openTab(FIX + 'ja.html');
await sleep(5000);
let pill = await evaluate(tab, PILL);
let ran = await isoEval(tab, 'window.__plamoDetect === true');
check('Japanese page with lang="en": no offer, the check ran', !pill && ran === true, JSON.stringify({ pill, ran }));
console.log('     language check cost (ja.html):', JSON.stringify(await isoEval(tab, DETECT_COST)));
await closeTab(tab);

// 5) notranslate
tab = await openTab(FIX + 'notranslate.html');
await sleep(4000);
pill = await evaluate(tab, PILL);
ran = await isoEval(tab, 'window.__plamoDetect === true');
check('<meta name="google" content="notranslate">: no offer', !pill && ran === true, JSON.stringify({ pill, ran }));
await closeTab(tab);

// 6) このサイトでは尋ねない
art = await openTab(FIX + 'article.html');
p = await waitFor(() => evaluate(art, PILL), (v) => v?.go, 15000);
await click(art, IN_PILL('.never'));
p = await waitFor(() => evaluate(art, PILL), (v) => /今後尋ねません/.test(v?.msg || ''), 3000);
await sleep(2600);
const gone = !(await evaluate(art, PILL));
let skip = (await evaluate(opt, `chrome.storage.local.get('autoPageSkip').then((s) => s.autoPageSkip)`)) || '';
check('このサイトでは尋ねない: note, saved, pill closes', !!p && skip.split('\n').includes('127.0.0.1') && gone, JSON.stringify({ msg: p?.msg, skip }));
check('options: the site appears in 対象外のサイト', (await evaluate(opt, `document.querySelector('#autoPageSkip').value`)).includes('127.0.0.1'));
await evaluate(art, 'location.reload()').catch(() => {});
await sleep(5000);
check('excluded site: no offer after a reload', !(await evaluate(art, PILL)));
await closeTab(art);
await evaluate(opt, `chrome.storage.local.set({ autoPageSkip: '' }).then(() => 1)`);

// 7) 自動で翻訳する
s = await setMode('auto');
check('自動で翻訳する: saved, still registered', s.stored === 'auto' && s.scripts.includes('plamo-detect'), JSON.stringify(s));
t0 = Date.now();
art = await openTab(FIX + 'article.html');
p = await waitFor(() => evaluate(art, PILL), (v) => /翻訳済み/.test(v?.msg || ''), 90000);
check('auto: translated without a click', !!p && !p.go && (await evaluate(art, `/[ぁ-んァ-ン]/.test(document.querySelector('p').textContent)`)), `${JSON.stringify(p)}, ${Date.now() - t0} ms`);

// 8) a tab opened in the background
const bg = await openTab(FIX + 'article.html?bg', true);
await sleep(5000);
const bgState = await evaluate(bg, `({ vis: document.visibilityState, pill: !!document.querySelector('plamo-ui') })`);
check('background tab: nothing while hidden', bgState.vis === 'hidden' && !bgState.pill, JSON.stringify(bgState));
await front(bg);
p = await waitFor(() => evaluate(bg, PILL), (v) => /翻訳(中|済み)/.test(v?.msg || ''), 30000);
check('background tab: translates once shown', !!p, JSON.stringify(p));
await closeTab(bg);

// 9) the popup's checkbox (opened for the article tab)
await front(art);
await sleep(500);
const sw = (await list()).find((t) => t.type === 'service_worker' && t.url.includes(ID));
const opened = sw ? await evaluate(sw, `chrome.action.openPopup().then(() => 'opened', (e) => 'error: ' + e.message)`) : 'no service worker target';
const pop = opened === 'opened' ? await waitFor(async () => (await list()).find((t) => t.url.includes('popup/popup.html')), Boolean, 5000) : null;
if (pop) {
  await sleep(1200);
  const row = await evaluate(pop, `({ shown: !document.querySelector('#siteRow').hidden, text: document.querySelector('#siteSkipText').textContent, checked: document.querySelector('#siteSkip').checked })`);
  check('popup: per-site checkbox for this site', row.shown && row.text === 'このサイトでは自動で翻訳しない' && !row.checked, JSON.stringify(row));
  await shot(pop, 'popup_light.png', 'light', 0, 0);
  await shot(pop, 'popup_dark.png', 'dark', 0, 0);
  await click(pop, `document.querySelector('#siteSkip')`);
  skip = await waitFor(() => evaluate(opt, `chrome.storage.local.get('autoPageSkip').then((s) => s.autoPageSkip || '')`), (v) => v?.includes('127.0.0.1'), 3000);
  check('popup: checking it excludes the site', !!skip, JSON.stringify(skip));
  await closeTab(pop);
  await evaluate(opt, `chrome.storage.local.set({ autoPageSkip: '' }).then(() => 1)`);
} else {
  console.log(`skip popup checkbox: ${opened}`);
}
await closeTab(art);

// 10) 何もしない
s = await setMode('off');
check('何もしない: saved, unregistered, site list hidden', s.stored === 'off' && !s.scripts.includes('plamo-detect') && !s.more, JSON.stringify(s));
tab = await openTab(FIX + 'article.html?off');
await sleep(4000);
check('何もしない: an English page is left alone', !(await evaluate(tab, PILL)) && (await isoEval(tab, '1')) === null);
await closeTab(tab);

await evaluate(opt, `chrome.storage.local.set({ autoPage: 'off', autoPageSkip: '' }).then(() => 1)`);
const failed = results.filter((r) => !r).length;
console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`);
browser.close();
process.exit(failed ? 1 : 0);
