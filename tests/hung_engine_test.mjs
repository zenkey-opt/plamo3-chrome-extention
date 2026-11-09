// Hung engine: the engine stops answering RPCs (its thread stays free). The options page must say
// so instead of sitting at "確認中…", and "解放して VRAM を空ける" must recover.
// node hung_engine_test.mjs
import { execFileSync } from 'node:child_process';

const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 40000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OPT = 'chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html';
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const optState = () => cdp('page', 'options/options.html', "JSON.stringify({ label: document.querySelector('#st .label').textContent, msg: document.querySelector('#stMsg').textContent, unload: !document.querySelector('#btnUnload').disabled })");
const swRunning = () => cdp('targets').split('\n').some((l) => l.startsWith('service_worker'));
const close = (m) => { for (let i = 0; i < 6; i++) { try { cdp('close', m); } catch { break; } } };
let fails = 0;
const expect = (name, cond, detail) => { log((cond ? 'PASS ' : 'FAIL ') + name, detail || ''); if (!cond) fails++; };

log('load 2B ->', cdp('sw', "chrome.storage.local.set({ model: '2b-q4km' }).then(() => self.__plamo.engineCall('load', { modelId: '2b-q4km' })).then(s => s.state)"));
// The next port the service worker opens gets its RPC replies dropped (a busy main thread cannot
// be used to simulate this: every page of one extension shares one renderer main thread).
log(cdp('offscreen', "(chrome.runtime.onConnect.addListener((p) => { if (p.name !== 'engine') return; const orig = p.postMessage.bind(p); p.postMessage = (m) => { if (m && m.k === 'rpc') return; orig(m); }; }), 'hook installed')"));
close('options/options.html');
close('popup/popup.html');
log('waiting for the service worker to stop (its port to the engine goes with it)');
for (let i = 0; i < 24 && swRunning(); i++) await sleep(5000);
log('sw running:', swRunning());
cdp('open', OPT);
const tOpen = Date.now();
let s;
for (let i = 0; i < 15; i++) {
  await sleep(1000);
  s = JSON.parse(optState());
  if (s.label !== '確認中…') break;
}
expect(`options reports the unresponsive engine (${((Date.now() - tOpen) / 1000).toFixed(0)} s after opening)`, s.label === 'エラー' && /応答しません/.test(s.msg), JSON.stringify(s));
expect('解放 button is usable', s.unload);
log('click 解放 ->', cdp('page', 'options/options.html', "(document.querySelector('#btnUnload').click(), 'clicked')"));
for (let i = 0; i < 20; i++) {
  await sleep(1000);
  s = JSON.parse(optState());
  if (s.label.startsWith('待機中')) break;
}
expect('recovered after 解放', s.label.startsWith('待機中'), JSON.stringify(s));
log('translate after recovery ->', cdp('sw', "self.__plamo.translate({ text: 'Recovered.', target: 'ja', useCache: false }).then(r => 'ok ' + r.text, e => 'rejected ' + e.code + ' ' + e.message)"));
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
