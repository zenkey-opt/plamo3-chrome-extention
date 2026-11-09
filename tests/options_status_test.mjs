// Options-page status after the service worker went idle (no CDP session keeps it alive here).
// node options_status_test.mjs [idleWaitSec]
import { execFileSync } from 'node:child_process';

const idleWait = Number(process.argv[2] || 45);
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OPT = 'chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html';
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const swRunning = () => cdp('targets').split('\n').some((l) => l.startsWith('service_worker'));
const label = () => cdp('page', 'options/options.html', "document.querySelector('#st .label').textContent + ' | ' + document.querySelector('#st').dataset.state");

async function watchLabel(what, sec = 6) {
  let l = '';
  for (let i = 0; i < sec * 2; i++) {
    l = label();
    if (!l.startsWith('確認中')) break;
    await sleep(500);
  }
  log(what, '->', l);
  return l;
}

for (let i = 0; i < 6; i++) { try { cdp('close', 'options/options.html'); } catch { break; } }
for (let i = 0; i < 6; i++) { try { cdp('close', 'popup/popup.html'); } catch { break; } }
log('sw running at start:', swRunning());
cdp('open', OPT);
await sleep(1500);
await watchLabel('fresh options page');
log(cdp('page', 'options/options.html', "(() => { const b = document.querySelector('#btnLoad'); if (!b.disabled) b.click(); return 'load clicked=' + !b.disabled; })()"));
for (let i = 0; i < 30; i++) {
  const l = label();
  if (l.startsWith('準備完了')) { log('loaded ->', l); break; }
  await sleep(1000);
}
// close the options page so nothing polls the worker, then let the worker go idle
cdp('close', 'options/options.html');
log(`waiting ${idleWait}s with no extension page open`);
for (let s = 0; s < idleWait; s += 5) {
  await sleep(5000);
}
log('sw running after idle wait:', swRunning());
cdp('open', OPT);
await sleep(1500);
await watchLabel('options page after idle', 10);
log('targets:', cdp('targets').split('\n').filter((l) => /bhkpaam/.test(l)).join(' ; '));
