// The engine says nothing to the service worker while it loads a model (or decodes without streaming),
// and a worker without events stops after 30 s. The pages waiting on it must still get their answers.
// Here the model files stay out of reach for 45 s (OPFS calls in the offscreen document are held back),
// then a page translation starts. Pass: the worker keeps running and every paragraph is translated.
// node sw_idle_test.mjs   (http.server on 18300 serving tests/fixtures, test browser on CDP 9333)
import { execFileSync } from 'node:child_process';

const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 60000 }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const swRunning = async () => (await (await fetch('http://127.0.0.1:9333/json/list')).json()).some((t) => t.type === 'service_worker' && t.url.includes('background.js'));
const close = (m) => { for (let i = 0; i < 6; i++) { try { cdp('close', m); } catch { break; } } };
const HOLD_MS = 45000;
let fails = 0;
const expect = (name, cond, detail) => { log((cond ? 'PASS ' : 'FAIL ') + name, detail ? JSON.stringify(detail) : ''); if (!cond) fails++; };

close('article.html');
cdp('open', 'http://127.0.0.1:18300/article.html');
await sleep(1500);
cdp('activate', 'article.html');
log('unload:', cdp('sw', "self.__plamo.cache.clear(), self.__plamo.engineCall('unload').then(() => 'unloaded')"));
log('hold OPFS:', cdp('offscreen', `(() => {
  const sm = navigator.storage;
  const orig = sm.getDirectory.bind(sm);
  const until = Date.now() + ${HOLD_MS};
  sm.getDirectory = () => new Promise((r) => setTimeout(r, Math.max(0, until - Date.now()))).then(orig);
  setTimeout(() => delete sm.getDirectory, ${HOLD_MS} + 1000);
  return 'held for ${HOLD_MS / 1000} s';
})()`));
log('start:', cdp('sw', "(async () => { const tab = (await chrome.tabs.query({})).find((t) => (t.url || '').includes('article.html')); return JSON.stringify(await self.__plamo.togglePage(tab, 'on')); })()"));
close('options/options.html');
close('popup/popup.html');

let stopped = null;
let st = null;
let last = '';
while (Date.now() - t0 < 170000) {
  await sleep(2000);
  if (!stopped && !(await swRunning())) stopped = ((Date.now() - t0) / 1000).toFixed(0) + ' s';
  st = JSON.parse(cdp('iso', 'article.html', 'JSON.stringify({ inflight: window.__plamoPage.state.inflight.size, waiting: window.__plamoPage.state.waiting.length, ...window.__plamoPage.stats() })'));
  const line = JSON.stringify({ inflight: st.inflight, done: st.done, failed: st.failed, sw: !stopped });
  if (line !== last) log(line);
  last = line;
  if (st.inflight === 0 && st.waiting === 0 && st.done + st.failed > 0) break;
}
expect('the service worker kept running through the silent load', !stopped, { stoppedAt: stopped });
expect('every paragraph was translated', st && st.inflight === 0 && st.waiting === 0 && st.failed === 0 && st.done === st.total, st);

cdp('open', 'chrome-extension://bhkpaambekhpdikhkccbfdappiogpgnc/options/options.html');
await sleep(1500);
try { cdp('sw', "(async () => { const tab = (await chrome.tabs.query({})).find((t) => (t.url || '').includes('article.html')); return JSON.stringify(await self.__plamo.togglePage(tab, 'off')); })()"); } catch {}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
