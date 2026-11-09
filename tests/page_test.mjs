// End-to-end page translation timing (replace mode): open the page, start the page translator and poll
// until nothing visible is left to translate. Prints when the first-screen body paragraphs were done and
// when everything visible was done; saves the translations so runs can be compared.
// node page_test.mjs <url-match> <url> [label] [out.json] [maxSec]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [match, url, label = 'run', out, maxArg] = process.argv.slice(2);
const maxSec = Number(maxArg || 120);
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

cdp('sw', 'self.__plamo.cache.clear(), 1');
for (let i = 0; i < 5; i++) {
  try {
    cdp('close', match);
  } catch {
    break;
  }
}
cdp('open', url);
await sleep(4000);
cdp('activate', match);
// the model is loaded before the clock starts
cdp('sw', "chrome.storage.local.get('model').then(r => self.__plamo.engineCall('load', { modelId: r.model })).then(s => s.state)");
cdp('sw', `(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => (t.url || '').includes(${JSON.stringify(match)})); return self.__plamo.togglePage(tab); })()`);
const t0 = Date.now();
const PROBE = `JSON.stringify((() => {
  const units = window.__plamoPage.state.units;
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const body = units.filter(u => { const el = u.parent.nodeType === 1 ? u.parent : null; return el && el.closest('p') && el.closest('main, article, [role=main], #content') && inView(el); });
  return { body: body.length, bodyDone: body.filter(u => u.translation != null).length, stats: window.__plamoPage.stats() };
})())`;
let last;
let bodyAt = null;
let allAt = null;
const marks = [];
while ((Date.now() - t0) / 1000 < maxSec) {
  last = JSON.parse(cdp('iso', match, PROBE));
  const sec = +((Date.now() - t0) / 1000).toFixed(1);
  const s = last.stats;
  if (!marks.length || marks[marks.length - 1].done !== s.done) marks.push({ sec, done: s.done, of: s.visibleTotal });
  if (bodyAt === null && last.body && last.bodyDone === last.body) bodyAt = sec;
  if (s.done > 0 && s.busy === 0) {
    allAt = sec;
    break;
  }
  await sleep(250);
}
const texts = JSON.parse(cdp('iso', match, 'JSON.stringify(window.__plamoPage.state.units.filter(u => u.translation != null).map(u => u.translation))'));
const s = last.stats;
console.log(`${label}: first-screen paragraphs ${last.body} done at ${bodyAt ?? '-'} s; all ${s.done}/${s.visibleTotal} visible units (failed ${s.failed}, fallback ${s.fallback}) done at ${allAt ?? 'not finished'} s`);
if (out) writeFileSync(out, JSON.stringify({ label, url, bodyAt, allAt, stats: s, marks, texts }, null, 1));
