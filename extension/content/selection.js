// PLaMo 3 Translate Local — selection card (injected on demand).
(() => {
  if (window.__plamoSel) return;
  window.__plamoSel = true;

  const ICON = {
    copy: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.25" y="5.25" width="8" height="8" rx="1.75"/><path d="M10.75 5.25V3.5A1.75 1.75 0 0 0 9 1.75H3.5A1.75 1.75 0 0 0 1.75 3.5V9A1.75 1.75 0 0 0 3.5 10.75h1.75"/></svg>',
    check: '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.2 3L13 4.5"/></svg>',
    close: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    arrow: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>',
  };

  const CSS = `
    :host { all: initial; }
    :host { --bg:#ffffff; --fg:#1f2328; --muted:#656d76; --border:rgba(31,35,40,.12); --hover:rgba(31,35,40,.06);
      --accent:#4f46e5; --accent-soft:rgba(79,70,229,.10); --danger:#cf222e; --shadow:0 16px 40px rgba(15,23,42,.18), 0 2px 8px rgba(15,23,42,.08); }
    @media (prefers-color-scheme: dark) {
      :host { --bg:#23242a; --fg:#e8e8ea; --muted:#a0a4ab; --border:rgba(255,255,255,.12); --hover:rgba(255,255,255,.07);
        --accent:#818cf8; --accent-soft:rgba(129,140,248,.14); --danger:#ff7b72; --shadow:0 16px 40px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3); }
    }
    .card { position: fixed; z-index: 2147483647; box-sizing: border-box; width: min(460px, calc(100vw - 24px));
      max-height: min(62vh, 560px); display: flex; flex-direction: column; overflow: hidden;
      background: var(--bg); color: var(--fg); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow);
      font: 14px/1.75 system-ui, "Segoe UI", "Yu Gothic UI", "Hiragino Sans", "Meiryo", sans-serif;
      animation: pop .14s cubic-bezier(.2,.8,.3,1); }
    @keyframes pop { from { opacity: 0; transform: translateY(4px) scale(.985); } }
    .head { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 12px; border-bottom: 1px solid var(--border);
      cursor: grab; user-select: none; }
    .head:active { cursor: grabbing; }
    .brand { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .01em; }
    .logo { width: 18px; height: 18px; border-radius: 5px; background: var(--accent); color: #fff; display: grid; place-items: center;
      font-size: 10.5px; font-weight: 700; }
    .dir { display: flex; align-items: center; gap: 4px; margin-left: 4px; font-size: 12px; color: var(--muted); }
    select { all: unset; cursor: pointer; font-size: 12px; color: var(--fg); padding: 2px 18px 2px 7px; border-radius: 6px;
      background: var(--hover) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 5px center; }
    select:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    option { color: #1f2328; background: #fff; }
    .sp { flex: 1; }
    button { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 7px; display: grid; place-items: center; color: var(--muted); }
    button:hover { background: var(--hover); color: var(--fg); }
    button.ok { color: #1a7f37; }
    .body { padding: 11px 14px 12px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; cursor: text; }
    .body.streaming::after { content: ""; display: inline-block; width: 7px; height: 1.05em; margin-left: 2px; vertical-align: -2px;
      background: var(--accent); border-radius: 1px; animation: blink 1s steps(2) infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    .sk { display: grid; gap: 8px; padding: 4px 0 2px; }
    .sk i { display: block; height: 10px; border-radius: 5px; background: linear-gradient(90deg, var(--hover) 25%, var(--accent-soft) 50%, var(--hover) 75%);
      background-size: 300% 100%; animation: sh 1.2s ease-in-out infinite; }
    .sk i:nth-child(2) { width: 82%; } .sk i:nth-child(3) { width: 58%; }
    .sk-note { font-size: 12px; color: var(--muted); margin-top: 2px; }
    @keyframes sh { from { background-position: 100% 0; } to { background-position: 0 0; } }
    .err { color: var(--danger); white-space: normal; }
    .err a { color: var(--accent); cursor: pointer; text-decoration: underline; margin-left: 6px; }
    .foot { display: flex; gap: 10px; padding: 5px 12px 6px; border-top: 1px solid var(--border); font-size: 11px; color: var(--muted); }
    .foot:empty { display: none; }
  `;

  let host = null;
  let ui = null;
  let port = null;
  let reqId = 0;
  let langs = [];
  let state = { text: '', target: 'auto', result: '' };

  function langLabel(code) {
    const f = langs.find((l) => l[0] === code);
    return f ? f[1] : code;
  }

  function build() {
    host = document.createElement('plamo-ui');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="card" role="dialog" aria-label="PLaMo 翻訳">
        <div class="head">
          <span class="brand"><span class="logo">訳</span>PLaMo</span>
          <span class="dir">${ICON.arrow}<select class="tgt" title="翻訳先の言語"></select></span>
          <span class="sp"></span>
          <button class="copy" title="訳文をコピー" aria-label="訳文をコピー">${ICON.copy}</button>
          <button class="close" title="閉じる (Esc)" aria-label="閉じる">${ICON.close}</button>
        </div>
        <div class="body"></div>
        <div class="foot"></div>
      </div>`;
    ui = {
      root,
      card: root.querySelector('.card'),
      head: root.querySelector('.head'),
      tgt: root.querySelector('.tgt'),
      body: root.querySelector('.body'),
      foot: root.querySelector('.foot'),
      copy: root.querySelector('.copy'),
      close: root.querySelector('.close'),
    };
    ui.tgt.innerHTML = langs.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
    ui.tgt.addEventListener('change', () => run(ui.tgt.value));
    ui.close.addEventListener('click', close);
    ui.copy.addEventListener('click', copy);
    // drag by the header
    ui.head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button,select')) return;
      const r = ui.card.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      ui.head.setPointerCapture(e.pointerId);
      const move = (ev) => {
        ui.card.style.left = Math.max(4, Math.min(innerWidth - r.width - 4, ev.clientX - dx)) + 'px';
        ui.card.style.top = Math.max(4, Math.min(innerHeight - 40, ev.clientY - dy)) + 'px';
      };
      const up = () => {
        ui.head.removeEventListener('pointermove', move);
        ui.head.removeEventListener('pointerup', up);
      };
      ui.head.addEventListener('pointermove', move);
      ui.head.addEventListener('pointerup', up);
    });
    document.documentElement.appendChild(host);
    addEventListener('keydown', onKey, true);
    addEventListener('pointerdown', onOutside, true);
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  function onOutside(e) {
    if (host && !e.composedPath().includes(host)) close();
  }

  function close() {
    try {
      port?.disconnect();
    } catch {}
    port = null;
    removeEventListener('keydown', onKey, true);
    removeEventListener('pointerdown', onOutside, true);
    host?.remove();
    host = null;
    ui = null;
  }

  function place(rect) {
    const card = ui.card;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    let left;
    let top;
    if (rect && (rect.width || rect.height)) {
      left = Math.min(Math.max(8, rect.left), innerWidth - w - 8);
      top = rect.bottom + 8;
      if (top + h > innerHeight - 8 && rect.top - 8 - h > 8) top = rect.top - 8 - h;
      top = Math.max(8, Math.min(top, innerHeight - h - 8));
    } else {
      left = innerWidth - w - 16;
      top = 16;
    }
    card.style.left = left + 'px';
    card.style.top = top + 'px';
  }

  // keep the card inside the viewport while the translation grows
  function refit() {
    if (!ui) return;
    const r = ui.card.getBoundingClientRect();
    if (r.bottom > innerHeight - 8) ui.card.style.top = Math.max(8, innerHeight - r.height - 8) + 'px';
  }

  function showSkeleton() {
    ui.body.className = 'body';
    ui.body.innerHTML = '<div class="sk"><i></i><i></i><i></i></div>';
    ui.foot.textContent = '';
  }

  function getPort() {
    if (port) return port;
    port = chrome.runtime.connect({ name: 'stream' });
    port.onDisconnect.addListener(() => {
      port = null;
    });
    port.onMessage.addListener((m) => {
      if (!ui) return;
      if (m.type === 'engine') {
        const sk = ui.body.querySelector('.sk');
        if (sk && m.state === 'loading' && !sk.querySelector('.sk-note')) {
          const n = document.createElement('div');
          n.className = 'sk-note';
          n.textContent = '翻訳モデルを読み込んでいます（数秒）…';
          sk.appendChild(n);
        }
        return;
      }
      if (m.reqId !== reqId) return;
      if (m.type === 'start') {
        state.target = m.target;
        ui.tgt.value = m.target;
      } else if (m.type === 'delta') {
        ui.body.className = 'body streaming';
        ui.body.textContent = m.text;
        refit();
      } else if (m.type === 'done') {
        state.result = m.text;
        ui.body.className = 'body';
        ui.body.textContent = m.text || '（訳文が空でした）';
        const secs = m.ms != null ? (m.ms / 1000).toFixed(2) + ' 秒' : '';
        ui.foot.textContent = [
          'PLaMo 3 Translate',
          m.cached ? 'キャッシュ' : secs,
          !m.cached && m.tokPerSec ? m.tokPerSec + ' tok/s' : '',
        ].filter(Boolean).join(' · ');
        refit();
      } else if (m.type === 'error') {
        ui.body.className = 'body err';
        ui.body.textContent = m.message;
        const a = document.createElement('a');
        a.textContent = '設定を開く';
        a.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openOptions' }));
        ui.body.appendChild(a);
      }
    });
    return port;
  }

  function run(target) {
    if (!ui) return;
    state.target = target || 'auto';
    state.result = '';
    showSkeleton();
    reqId++;
    getPort().postMessage({ type: 'translate', reqId, text: state.text, target: state.target });
  }

  async function copy() {
    const t = state.result || ui.body.textContent;
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = t;
      ui.root.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    ui.copy.innerHTML = ICON.check;
    ui.copy.classList.add('ok');
    setTimeout(() => {
      if (!ui) return;
      ui.copy.innerHTML = ICON.copy;
      ui.copy.classList.remove('ok');
    }, 1200);
  }

  function currentSelection() {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && /^(text|search|url|email)?$/i.test(ae.type)))) {
      const t = ae.value.slice(ae.selectionStart ?? 0, ae.selectionEnd ?? 0);
      if (t.trim()) return { text: t, rect: ae.getBoundingClientRect() };
    }
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return { text: '', rect: null };
    const range = sel.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      const rs = range.getClientRects();
      rect = rs[rs.length - 1] || null;
    }
    return { text: sel.toString(), rect };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== 'plamo:showSelection') return;
    const { text, rect } = currentSelection();
    const t = (text && text.trim()) || (msg.fallbackText || '').trim();
    if (!t) {
      sendResponse({ empty: true });
      return;
    }
    langs = msg.langs || langs;
    if (!ui) build();
    state.text = t.length > 20000 ? t.slice(0, 20000) : t;
    showSkeleton();
    place(rect);
    run('auto');
    sendResponse({ ok: true });
  });
})();
