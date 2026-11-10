// Download a model from the options page (button click) and translate with it.
// node download_test.mjs [modelId]
import { execFileSync } from 'node:child_process';

const id = process.argv[2] || '0.8b-q4km';
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 40000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OPT = 'chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html';
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const row = `#models .model[data-id="${id}"]`;
const st = () => JSON.parse(cdp('page', 'options/options.html', `JSON.stringify({ label: document.querySelector('#st .label').textContent, row: document.querySelector('${row} .mstate').textContent, present: !!document.querySelector('${row} .mstate svg[aria-label]'), dl: document.querySelector('#dl').hidden ? '' : document.querySelector('#dlText').textContent })`));
const close = (m) => { for (let i = 0; i < 6; i++) { try { cdp('close', m); } catch { break; } } };

close('options/options.html');
log('select', id, '->', cdp('sw', `chrome.storage.local.set({ model: '${id}' }).then(() => 'ok')`));
cdp('open', OPT);
await sleep(2500);
log('before:', JSON.stringify(st()));
log(cdp('page', 'options/options.html', `(() => { const b = document.querySelector('${row} [data-act=download]'); const r = 'hidden=' + b.hidden + ' disabled=' + b.disabled + ' text=' + b.textContent; b.click(); return r; })()`));
let s;
let lastDl = '';
for (let i = 0; i < 300; i++) {
  await sleep(2000);
  s = st();
  if (s.dl && s.dl.slice(0, 40) !== lastDl.slice(0, 40) && i % 5 === 0) log('progress:', s.dl);
  lastDl = s.dl;
  if (s.present || /失敗/.test(s.dl)) break;
}
log('after:', JSON.stringify(s));
log('translate ->', cdp('sw', "self.__plamo.translate({ text: 'The download finished and the smaller model is ready.', target: 'ja', useCache: false }).then(r => 'ok ' + r.text + ' (' + r.ms + ' ms)', e => 'rejected ' + e.code + ' ' + e.message)"));
log('options:', JSON.stringify(st()));
