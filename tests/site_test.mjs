// Real-site smoke test: open URL, translate, wait, report stats + page errors + timing.
// node site_test.mjs <url> <shotfile> [waitMs]
import { execFileSync } from 'node:child_process';

const [url, shot, waitArg] = process.argv.slice(2);
const wait = Number(waitArg || 15000);
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const host = new URL(url).host;

cdp('open', url);
await sleep(5000);
// collect page errors from now on
cdp('page', host, `window.__errs = []; addEventListener('error', e => window.__errs.push(String(e.message))); addEventListener('unhandledrejection', e => window.__errs.push('rej: ' + String(e.reason))); 1`);
const t0 = Date.now();
const tog = cdp('sw', `(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => (t.url || "").includes(${JSON.stringify(host)})); return self.__plamo.togglePage(tab); })()`);
console.log('toggle:', tog.replace(/\s+/g, ' '));
let st;
for (let i = 0; i < wait / 500; i++) {
  await sleep(500);
  st = JSON.parse(cdp('iso', host, 'JSON.stringify(window.__plamoPage.stats())'));
  if (i > 2 && st.busy === 0) break;
}
console.log(`stats after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify(st));
console.log('page errors:', cdp('page', host, 'JSON.stringify(window.__errs)'));
const sample = cdp('iso', host, `JSON.stringify(window.__plamoPage.state.units.filter(u => u.fallback).slice(0, 4).map(u => ({src: u.src.slice(0, 200), out: (u.translation || '').slice(0, 200)})))`);
console.log('fallback samples:', sample);
if (shot) console.log(cdp('shot', host, shot, '1280', '900'));
