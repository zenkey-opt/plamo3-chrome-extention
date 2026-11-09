// Reproduce: switch the model on the options page to one that is not downloaded while another is loaded.
// node model_switch_test.mjs
import { execFileSync } from 'node:child_process';

const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 30000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OPT = 'chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html';
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const label = () => cdp('page', 'options/options.html', "document.querySelector('#st .label').textContent + ' | ' + [...document.querySelectorAll('#models .mstate')].map(e => e.textContent).join(' / ') + ' | msg=' + document.querySelector('#stMsg').textContent");
const sw = (js) => cdp('sw', js);

for (let i = 0; i < 6; i++) { try { cdp('close', 'options/options.html'); } catch { break; } }
log('settings model ->', sw("chrome.storage.local.get('model').then(r => JSON.stringify(r))"));
log('ensure 2B selected & loaded ->', sw("(async () => { await chrome.storage.local.set({ model: '2b-q4km' }); await new Promise(r => setTimeout(r, 300)); const s = await self.__plamo.engineCall('load', { modelId: '2b-q4km' }); return s.state + ' ' + s.modelId; })()"));
log('delete 0.8B ->', sw("self.__plamo.engineCall('delete', { modelId: '0.8b-q4km' }).then(s => 'ok ' + s.state)"));
cdp('open', OPT);
await sleep(2500);
log('before switch:', label());
log(cdp('page', 'options/options.html', "(() => { document.querySelector('#models input[value=\"0.8b-q4km\"]').click(); return 'clicked 0.8B'; })()"));
for (let i = 0; i < 10; i++) {
  await sleep(1000);
  log('after switch:', label());
}
cdp('page', 'options/options.html', 'location.reload(), 1');
await sleep(3000);
log('after reload:', label());
log('sw status (5s timeout) ->', sw("Promise.race([self.__plamo.getStatus().then(s => JSON.stringify({ state: s.state, modelId: s.modelId, dl: s.dl, eng: s.loadedModel })), new Promise(r => setTimeout(() => r('TIMEOUT'), 5000))])"));
log('engine status (5s timeout) ->', sw("Promise.race([self.__plamo.engineCall('status').then(s => JSON.stringify({ state: s.state, modelId: s.modelId, active: s.active })), new Promise(r => setTimeout(() => r('TIMEOUT'), 5000))])"));
