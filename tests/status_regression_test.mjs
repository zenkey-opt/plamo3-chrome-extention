// Regression test for the options page stuck at "確認中…" — the selected model is not downloaded
// and a translation was attempted (NO_MODEL). The unresponsive-engine case is hung_engine_test.mjs,
// the no-answer-at-all case options_unknown_test.mjs.
// Deletes the 0.8B model of the test profile. node status_regression_test.mjs
import { execFileSync } from 'node:child_process';

const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 40000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OPT = 'chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html';
const POP = 'chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/popup/popup.html';
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const optState = () => cdp('page', 'options/options.html', "JSON.stringify({ label: document.querySelector('#st .label').textContent, msg: document.querySelector('#stMsg').textContent, rows: [...document.querySelectorAll('#models .model')].map(r => r.querySelector('.mstate').textContent + ' [' + [...r.querySelectorAll('.mbtns button')].filter(b => !b.hidden).map(b => b.textContent).join(',') + ']') })");
const close = (m) => { for (let i = 0; i < 6; i++) { try { cdp('close', m); } catch { break; } } };
let fails = 0;
const expect = (name, cond, detail) => { log((cond ? 'PASS ' : 'FAIL ') + name, detail || ''); if (!cond) fails++; };

close('options/options.html');
close('popup/popup.html');
cdp('open', OPT);
await sleep(2000);
log('delete 0.8B ->', cdp('page', 'options/options.html', "chrome.runtime.sendMessage({ type: 'deleteModel', modelId: '0.8b-q4km' }).then(s => s.state + ' present=' + s.models['0.8b-q4km'].present)"));
log('select 0.8B ->', cdp('sw', "chrome.storage.local.set({ model: '0.8b-q4km' }).then(() => 'ok')"));
log('translate with it ->', cdp('sw', "self.__plamo.translate({ text: 'Hello there.', target: 'ja' }).then(r => 'ok ' + r.text, e => 'rejected ' + e.code)"));
cdp('page', 'options/options.html', '(location.reload(), 1)');
await sleep(3000);
const s = JSON.parse(optState());
expect('options shows the real state after a NO_MODEL failure', s.label === 'モデル未ダウンロード', JSON.stringify(s));
expect('0.8B row offers a download', s.rows[1]?.includes('[ダウンロード]'), s.rows[1]);
cdp('open', POP);
await sleep(2500);
const pill = cdp('page', 'popup/popup.html', "document.getElementById('status').innerText");
expect('popup pill shows the state', /未取得|未ダウンロード/.test(pill), pill);
close('popup/popup.html');
log('back to 2B ->', cdp('sw', "chrome.storage.local.set({ model: '2b-q4km' }).then(() => 'ok')"));
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
