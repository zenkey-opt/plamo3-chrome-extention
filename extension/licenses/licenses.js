// Licence texts are plain files next to this page; load each one when its section is first opened.
for (const d of document.querySelectorAll('details[data-src]')) {
  d.addEventListener('toggle', async () => {
    const pre = d.querySelector('pre');
    if (!d.open || pre.dataset.loaded) return;
    pre.dataset.loaded = '1';
    try {
      const r = await fetch(d.dataset.src);
      pre.textContent = (await r.text()).replace(/\r\n/g, '\n').trim();
    } catch (e) {
      pre.textContent = `読み込めませんでした（${d.dataset.src}）: ${e.message || e}`;
    }
  });
}
// external links open in a new tab; the page itself stays
for (const a of document.querySelectorAll('a[href^="http"]')) {
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
}
