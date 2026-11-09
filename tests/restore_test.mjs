// Restore test: translate (replace), switch to bilingual and back, restore, and compare the DOM
// with the snapshot taken before translation. Run: node restore_test.mjs <page-match> [waitMs]
import { execFileSync } from 'node:child_process';

const match = process.argv[2] || 'article';
const wait = Number(process.argv[3] || 9000);
const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SNAP = `(() => {
  const ser = (n) => n.nodeType === 3 ? 'T:' + n.nodeValue
    : n.nodeType === 8 ? 'C:' + n.nodeValue
    : n.nodeType === 1 ? '<' + n.tagName + [...n.attributes].map(a => ' ' + a.name + '=' + a.value).join('') + '>' + [...n.childNodes].filter(c => !(c.nodeType === 1 && c.tagName === 'PLAMO-UI')).map(ser).join('|') + '</>'
    : '';
  return ser(document.body);
})()`;

cdp('activate', match); // a background tab is hidden: nothing would count as visible
await sleep(500);
const before = cdp('page', match, SNAP);
const tog = cdp('sw', `(async () => { const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => (t.url || "").includes(${JSON.stringify(match)})); return self.__plamo.togglePage(tab); })()`);
console.log('toggle on:', tog.replace(/\s+/g, ' '));
await sleep(wait);
console.log('stats:', cdp('iso', match, 'JSON.stringify(window.__plamoPage.stats())'));
const translated = cdp('page', match, SNAP);
cdp('iso', match, "window.__plamoPage.setMode('bilingual'), 1");
await sleep(300);
cdp('iso', match, "window.__plamoPage.setMode('replace'), 1");
await sleep(300);
cdp('iso', match, 'window.__plamoPage.stop(), 1');
await sleep(300);
const after = cdp('page', match, SNAP);
console.log('changed by translation:', before !== translated);
console.log('restored exactly      :', before === after);
if (before !== after) {
  let i = 0;
  while (i < before.length && before[i] === after[i]) i++;
  console.log('first diff at', i);
  console.log('before:', JSON.stringify(before.slice(Math.max(0, i - 120), i + 160)));
  console.log('after :', JSON.stringify(after.slice(Math.max(0, i - 120), i + 160)));
}
