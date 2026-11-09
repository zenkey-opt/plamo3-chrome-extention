// Options page when the service worker does not answer at all: it must say so, and the model rows
// must not offer ダウンロード / 削除 based on nothing. node options_unknown_test.mjs
import { execFileSync } from 'node:child_process';

const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 40000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OPT = 'chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html';
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const state = () => JSON.parse(cdp('page', 'options/options.html', "JSON.stringify({ label: document.querySelector('#st .label').textContent, msg: document.querySelector('#stMsg').textContent, rows: [...document.querySelectorAll('#models .model')].map(r => r.querySelector('.mstate').textContent + ' [' + [...r.querySelectorAll('.mbtns button')].filter(b => !b.hidden).map(b => b.textContent).join(',') + ']') })"));
const close = (m) => { for (let i = 0; i < 6; i++) { try { cdp('close', m); } catch { break; } } };
let fails = 0;
const expect = (name, cond, detail) => { log((cond ? 'PASS ' : 'FAIL ') + name, detail || ''); if (!cond) fails++; };

close('options/options.html');
cdp('open', OPT);
await sleep(2500);
let s = state();
expect('normal: rows show real states and matching buttons', s.rows.every((r) => !r.startsWith('—')) && s.rows.some((r) => /\[(削除|ダウンロード)\]/.test(r)), JSON.stringify(s));
log(cdp('page', 'options/options.html', "(chrome.runtime.sendMessage = () => new Promise(() => {}), 'sendMessage now never answers')"));
await sleep(13000);
s = state();
expect('no answer: error with the reason', s.label === 'エラー' && /応答しません/.test(s.msg), JSON.stringify(s));
expect('no answer: rows unknown, no buttons', s.rows.every((r) => r === '— []'), JSON.stringify(s.rows));
cdp('page', 'options/options.html', '(location.reload(), 1)');
await sleep(2500);
s = state();
expect('after reload: back to normal', s.rows.every((r) => !r.startsWith('—')), JSON.stringify(s));
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
