// Pages in another language. The service worker registers this script only while
// 「外国語のページを開いたとき」 is not 「何もしない」 (it needs the optional access to all sites).
// Once per document, top frame only: find the page language on this PC (chrome.i18n.detectLanguage)
// and, when it is not the target language, tell the service worker, which offers or starts page
// translation. A page in the target language costs one attribute check or one detection call.
(() => {
  if (window.top !== window || window.__plamoDetect) return;
  window.__plamoDetect = true;

  const root = document.documentElement;
  // the page asks not to be translated (the signals the browser's own translation honours)
  if (root.getAttribute('translate') === 'no' || root.classList.contains('notranslate') ||
      document.querySelector('meta[name="google" i][content="notranslate" i]')) return;

  const base = (c) => String(c || '').toLowerCase().split(/[-_(]/)[0];
  const SKIP = 'script,style,noscript,template,textarea,pre,code,kbd,samp,svg,math,[translate="no"],.notranslate';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // title + text nodes, without code blocks and the like (reads the DOM only: no layout)
  function sample(max = 3000) {
    let out = document.title + '\n';
    if (!document.body) return out;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n && out.length < max; n = w.nextNode()) {
      const t = n.nodeValue.trim();
      if (t.length < 2 || n.parentElement?.closest(SKIP)) continue;
      out += t + '\n';
    }
    return out;
  }

  // a tab opened in the background waits until it is shown (no GPU work for tabs nobody looks at)
  const shown = () =>
    new Promise((resolve) => {
      if (document.visibilityState === 'visible') return resolve();
      const f = () => {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', f);
        resolve();
      };
      document.addEventListener('visibilitychange', f);
    });

  (async () => {
    const { targetLang = 'ja' } = await chrome.storage.local.get('targetLang');
    const want = base(targetLang);
    if (base(root.lang) === want) return; // declared to be in the target language
    await shown();
    let text = sample();
    for (let i = 0; i < 2 && text.length < 300; i++) {
      await sleep(1500); // pages that fill in their text after load
      text = sample();
    }
    if (text.replace(/\s+/g, '').length < 100) return;
    const r = await chrome.i18n.detectLanguage(text);
    const top = r?.languages?.[0];
    if (!top || !(r.isReliable || top.percentage >= 70) || base(top.language) === want) return;
    await chrome.runtime.sendMessage({ type: 'autoPage', lang: top.language });
  })().catch(() => {});
})();
