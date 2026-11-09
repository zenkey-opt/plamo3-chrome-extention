// Time until the article paragraphs in the first screen are translated (page translation, replace mode).
// node first_screen_test.mjs <url-match> <url> [maxSec]
import { execFileSync } from 'node:child_process';

const [match, url, maxArg] = process.argv.slice(2);
const maxSec = Number(maxArg || 120);
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

cdp('sw', 'self.__plamo.cache.clear(), 1');
// close stale tabs of the same site, open a fresh one and make it the active (visible) tab
for (let i = 0; i < 5; i++) { try { cdp('close', match); } catch { break; } }
cdp('open', url);
await sleep(4000);
cdp('activate', match);
cdp('sw', `(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => (t.url || '').includes(${JSON.stringify(match)})); return self.__plamo.togglePage(tab); })()`);
const t0 = Date.now();
const PROBE = `JSON.stringify((() => {
  const units = window.__plamoPage.state.units;
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const body = units.filter(u => { const el = u.parent.nodeType === 1 ? u.parent : null; return el && el.closest('p') && el.closest('main, article, [role=main], #content') && inView(el); });
  const done = body.filter(u => u.state === 'done' || u.state === 'fallback' || u.translation).length;
  return { body: body.length, done, stats: window.__plamoPage.stats() };
})())`;
let last;
const marks = [];
while ((Date.now() - t0) / 1000 < maxSec) {
  last = JSON.parse(cdp('iso', match, PROBE));
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  if (!marks.length || marks[marks.length - 1].done !== last.done) marks.push({ sec, done: last.done, of: last.body, all: `${last.stats.done}/${last.stats.visibleTotal}` });
  if (last.body && last.done === last.body) break;
  await sleep(1000);
}
console.log(JSON.stringify(marks));
console.log('final:', JSON.stringify(last));
