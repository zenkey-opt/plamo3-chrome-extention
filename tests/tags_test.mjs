// Tag repair in 置換: translations whose <xN> tags do not parse are repaired from the source's structure
// instead of falling back to 併記, and links are never lost.
// The page's port to the service worker is replaced with one that answers each source with a fixed output
// (the shapes PLaMo 3 Translate gave on an encyclopedia article), so no model runs.
// Checks per paragraph: replaced or 併記, every link kept with its href and the expected words, no link
// inside a link; stats (repaired / fallback); turning the page off restores the original HTML.
// node tags_test.mjs   (http.server on 18300 serving tests/fixtures, test browser on CDP 9333)
import { execFileSync } from 'node:child_process';

const cdp = (...a) => execFileSync('node', ['cdp.mjs', ...a], { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : ' ' + JSON.stringify(detail)}`);
  if (!cond) fails++;
};

// source as page.js serializes it -> what the "model" answers
const CASES = {
  open: {
    src: '<x0>Glowgate</x0> (named after <x1>Glow</x1> from the <x2><x3>Frost</x3></x2> series and the <x4><x5>-gate</x5> scandal suffix</x4>) is a dispute about clips on <x6>Tube</x6> that were labelled as safe.',
    out: '<x0>グローゲート</x0>（<x2><x3>フロスト</x3></x2>シリーズの<x1>グロー</x1>と、<x4><x5>ゲート</x5>スキャンダルの接尾辞に由来）とは、<x6>Tube</x6>で安全と表示されていた動画を巡る論争である。',
    links: { '/w/Glow': 'グロー', '/w/Frost': 'フロスト', '/w/Gate': 'ゲートスキャンダルの接尾辞に由来', '/w/Tube': 'Tube' },
    text: 'グローゲート（フロストシリーズのグローと、ゲートスキャンダルの接尾辞に由来）とは、Tubeで安全と表示されていた動画を巡る論争である。',
  },
  moved: {
    src: 'Doe, Jane (2017). <x0>Tube bans the odd channel</x0>. <x1>Daily</x1>. <x2>Archived</x2> from the original on 19 January 2018<x3>. Retrieved <x4>25 January</x4> 2018</x3>.',
    out: 'Doe, Jane (2017年). <x0>「Tube、奇妙なチャンネルを禁止」</x0>. <x1>Daily</x1>. 2018年1月19日に原文よりアーカイブ済み<x2><x3>. 2018年<x4>1月25日</x4>閲覧</x3>.',
    links: { 'https://archive.example/1': '2018年1月19日に原文よりアーカイブ済み' },
  },
  wrongclose: {
    src: 'Roe, Sam (2017-12-08). <x0>Inside the odd clip war</x0>. <x1>Verge</x1>. <x2>Archived</x2> from the original on 2018-04-13<x3>. Retrieved <x4/></x3>.',
    out: 'Roe, Sam (2017-12-08). <x0>「奇妙な動画戦争の内幕」</x0>. <x1>Verge</x1>. <x2>2018-04-13に原本よりアーカイブ済み</x3>. <x4/>閲覧済み</x3>.',
    links: { 'https://archive.example/2': '2018-04-13に原本よりアーカイブ済み' },
  },
  neverclosed: {
    src: 'Poe, Ben (9 November 2017). <x0>Tube says it will act</x0>. <x1>Verge</x1>. <x2>Archived</x2> from the original on 2017-11-16. <x3>In August, Tube said it would stop paying for such clips.</x3>',
    out: 'Poe, Ben (2017年11月9日). <x0>「Tube、対策を表明」</x0>. <x1>Verge</x1>. <x2>2017年11月16日に原文よりアーカイブ済み。<x3>8月、Tubeはこうした動画への支払いをやめると発表した。</x3>',
    links: { 'https://archive.example/3': '2017年11月16日に原文よりアーカイブ済み' },
  },
  twice: {
    src: 'Read the <x0>guide</x0> before you post, and keep the guide open while you edit.',
    out: '投稿する前に<x0>ガイド</x0>を読み、編集中も<x0>ガイド</x0>を開いておくこと。',
    links: { '/w/Guide': 'ガイド' },
    text: '投稿する前にガイドを読み、編集中もガイドを開いておくこと。',
  },
  unknown: {
    src: 'Ask on the <x0>forum</x0> if you are stuck.',
    out: '行き詰まったら<x0>フォーラム</x0>で<x5>質問</x5>してください。',
    links: { '/w/Forum': 'フォーラム' },
    text: '行き詰まったらフォーラムで質問してください。',
  },
  // the link opened with the number of the footnote before it, closed with its own
  wrongopen: {
    src: 'The tag spread on <x0>Twitter</x0>.<x1/> On <x2>Reddit</x2>, a <x3>board</x3> was made.',
    out: '<x0>Twitter</x0>でタグが広まった。<x1>Reddit</x2>では<x3>掲示板</x3>が作られた。',
    links: { '/w/Twitter': 'Twitter', '#n1': '[1]', '/w/Reddit': 'Reddit', '/w/Board': '掲示板' },
    text: 'Twitterでタグが広まった。[1]Redditでは掲示板が作られた。',
  },
  dropped: {
    src: 'See the <x0>rules</x0> for details.',
    out: '詳しくは規則を参照。',
    fallback: true,
  },
  valid: {
    src: 'The <x0><x1>Frost</x1></x0> films were a hit.',
    out: '<x1><x0>フロスト</x0></x1>の映画はヒットした。',
    links: { '/w/Frost': 'フロスト' },
    strict: true,
  },
};
const ANSWERS = Object.fromEntries(Object.values(CASES).map((c) => [c.src, c.out]));

const tabExpr = "(await chrome.tabs.query({})).find((t) => (t.url || '').includes('/tags.html'))";
for (let i = 0; i < 6; i++) {
  try {
    cdp('close', 'tags.html');
  } catch {
    break;
  }
}
cdp('open', 'http://127.0.0.1:18300/tags.html');
await sleep(1500);
cdp('sw', `(async () => { const tab = ${tabExpr}; await chrome.tabs.update(tab.id, { active: true }); return 1; })()`);
console.log('settings:', cdp('sw', "chrome.storage.local.set({ pageMode: 'replace' }).then(() => chrome.storage.local.get(['pageMode', 'pageGlow'])).then((s) => JSON.stringify(s))"));
const snapshot = () => JSON.parse(cdp('page', 'tags.html', "JSON.stringify(Object.fromEntries([...document.querySelectorAll('#cases [id]')].map((el) => [el.id, el.outerHTML])))"));
const before = snapshot();

// the content scripts' world: chrome.runtime.connect({ name: 'page' }) gets a port that answers from ANSWERS
console.log('port:', cdp('sw', `(async () => {
  const tab = ${tabExpr};
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [${JSON.stringify(ANSWERS)}], func: (answers) => {
    const real = chrome.runtime.connect.bind(chrome.runtime);
    window.__asked = [];
    const fake = (info) => {
      if (info?.name !== 'page') return real(info);
      const listeners = [];
      return {
        name: 'page',
        onMessage: { addListener: (f) => listeners.push(f), removeListener() {} },
        onDisconnect: { addListener() {}, removeListener() {} },
        disconnect() {},
        postMessage(msg) {
          if (msg.type !== 'tr') return;
          window.__asked.push(msg.text);
          const text = answers[msg.text] ?? msg.text;
          setTimeout(() => listeners.forEach((f) => f({ type: 'res', id: msg.id, text })), 20);
        },
      };
    };
    try { chrome.runtime.connect = fake; } catch {}
    if (chrome.runtime.connect !== fake) Object.defineProperty(chrome.runtime, 'connect', { value: fake, configurable: true });
    return chrome.runtime.connect === fake ? 'fake port in place' : 'could not replace connect';
  } });
  return r.result;
})()`));
console.log('start:', cdp('sw', `(async () => JSON.stringify(await self.__plamo.togglePage(${tabExpr}, 'on')))()`));

let st = null;
for (let i = 0; i < 60; i++) {
  await sleep(250);
  st = JSON.parse(cdp('iso', 'tags.html', 'JSON.stringify(window.__plamoPage.stats())'));
  if (st.done >= Object.keys(CASES).length && !st.busy) break;
}
const asked = JSON.parse(cdp('iso', 'tags.html', 'JSON.stringify(window.__asked || [])'));
const unexpected = asked.filter((s) => !(s in ANSWERS));
check('every paragraph was asked for with the expected source', unexpected.length === 0 && asked.length === Object.keys(CASES).length, { unexpected, asked: asked.length });
check('stats: 7 repaired, 1 in 併記', st.repaired === 7 && st.fallback === 1 && st.failed === 0, st);

const dom = JSON.parse(cdp('page', 'tags.html', `JSON.stringify(Object.fromEntries([...document.querySelectorAll('#cases [id]')].map((el) => [el.id, {
  text: [...el.childNodes].filter((n) => n.nodeName !== 'PLAMO-T').map((n) => n.textContent).join('').replace(/\\s+/g, ' ').trim(),
  wrap: el.querySelector('plamo-t')?.textContent ?? null,
  links: [...el.querySelectorAll('a')].filter((a) => !a.closest('plamo-t')).map((a) => [a.getAttribute('href'), a.textContent]),
  nested: el.querySelectorAll('a a').length,
}])))`));
for (const [id, c] of Object.entries(CASES)) {
  const d = dom[id];
  if (c.fallback) {
    check(`${id}: link missing from the translation -> 併記, original kept`, d.wrap === c.out && d.links.length === 1 && d.text.startsWith('See the rules'), d);
    continue;
  }
  check(`${id}: replaced`, d.wrap === null && !/[A-Za-z]{4,} (the|on|for|if|you)\b/.test(d.text), d);
  const links = d.links.map(([h, t]) => `${h} ${t}`).sort();
  const want = Object.entries(c.links).map(([h, t]) => `${h} ${t}`).sort();
  check(`${id}: every link kept with its words`, JSON.stringify(links) === JSON.stringify(want) && d.nested === 0, d.links);
  if (c.text) check(`${id}: text`, d.text === c.text, d.text);
}

console.log('stop:', cdp('sw', `(async () => JSON.stringify(await self.__plamo.togglePage(${tabExpr}, 'off')))()`));
await sleep(500);
const after = snapshot();
const changed = Object.keys(before).filter((id) => before[id] !== after[id]);
check('turning the page off restores the original HTML', changed.length === 0, changed.map((id) => ({ id, before: before[id], after: after[id] })));
cdp('close', 'tags.html');
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
