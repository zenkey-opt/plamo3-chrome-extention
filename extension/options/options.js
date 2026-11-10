import { LANGS } from '../lib/langs.js';
import { DEFAULTS, AUTO_ORIGINS, getSettings, saveSettings, parseGlossary, parseSites } from '../lib/settings.js';
import { MODELS, fmtBytes, licenseConsent, acceptLicense } from '../lib/models.js';
import { internalPage } from '../lib/browser.js';

const $ = (s) => document.querySelector(s);
let settings;
let savedTimer = 0;
let last = null; // last status
let busy = false; // an action button is running
let consentFor = ''; // model whose download waits for the licence agreement

// a downloaded model: a check and its size (the check keeps the words for screen readers)
const CHECK = '<svg role="img" aria-label="ダウンロード済み" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';

const STATUS_TEXT = {
  checking: '確認中…',
  ready: '準備完了',
  idle: '待機中',
  loading: 'モデル読み込み中…',
  downloading: 'ダウンロード中…',
  nomodel: 'モデル未ダウンロード',
  error: 'エラー',
};

init();

async function init() {
  settings = await getSettings();
  const opts = LANGS.map(([c, n]) => `<option value="${c}">${n}</option>`).join('');
  $('#targetLang').innerHTML = opts;
  $('#altTargetLang').innerHTML = opts;
  $('#targetLang').value = settings.targetLang;
  $('#altTargetLang').value = settings.altTargetLang;
  $('#concurrency').value = settings.concurrency;
  fillIdle();
  $('#useTitleContext').checked = !!settings.useTitleContext;
  $('#pageGlow').checked = settings.pageGlow !== false;
  $('#glossary').value = settings.glossary;
  setSeg('#form', settings.form);
  setSeg('#pageMode', settings.pageMode);
  setSeg('#autoPage', settings.autoPage);
  $('#autoPageSkip').value = settings.autoPageSkip;
  renderAutoPage();
  renderModels();

  $('#targetLang').addEventListener('change', (e) => save({ targetLang: e.target.value }));
  $('#altTargetLang').addEventListener('change', (e) => save({ altTargetLang: e.target.value }));
  $('#useTitleContext').addEventListener('change', (e) => save({ useTitleContext: e.target.checked }));
  $('#pageGlow').addEventListener('change', (e) => save({ pageGlow: e.target.checked }));
  $('#concurrency').addEventListener('change', (e) => {
    const n = Math.max(1, Math.min(8, Math.round(Number(e.target.value) || DEFAULTS.concurrency)));
    e.target.value = n;
    save({ concurrency: n });
  });
  $('#idleUnloadMin').addEventListener('change', (e) => save({ idleUnloadMin: Number(e.target.value) }));
  let gTimer = 0;
  $('#glossary').addEventListener('input', (e) => {
    clearTimeout(gTimer);
    gTimer = setTimeout(() => {
      const n = parseGlossary(e.target.value).length;
      save({ glossary: e.target.value }, `${n} 語の用語集を保存しました`);
    }, 500);
  });
  bindSeg('#form', (v) => save({ form: v }));
  bindSeg('#pageMode', (v) => save({ pageMode: v }));
  bindSeg('#autoPage', setAutoPage);
  $('#autoPageGrant').addEventListener('click', async () => {
    const granted = await chrome.permissions.request({ origins: AUTO_ORIGINS }).catch(() => false);
    renderAutoPage(granted ? '' : 'サイトへのアクセスが許可されませんでした。');
  });
  let sTimer = 0;
  $('#autoPageSkip').addEventListener('input', (e) => {
    clearTimeout(sTimer);
    sTimer = setTimeout(() => {
      save({ autoPageSkip: e.target.value }, `対象外のサイトを ${parseSites(e.target.value).length} 件保存しました`);
    }, 500);
  });

  $('#btnLoad').addEventListener('click', () =>
    act('モデルを読み込んでいます…', { type: 'loadModel' }, (s) => (s.info ? `${(s.info.loadMs / 1000).toFixed(1)} 秒で読み込みました` : '')),
  );
  $('#btnUnload').addEventListener('click', () => act('解放しています…', { type: 'unloadModel' }, () => '解放しました'));
  $('#dlCancel').addEventListener('click', () => act('', { type: 'cancelDownload' }, () => 'ダウンロードを中止しました'));
  $('#consentOk').addEventListener('click', async () => {
    const id = consentFor;
    closeConsent();
    await acceptLicense();
    showConsent();
    act('', { type: 'downloadModel', modelId: id }, () => '');
  });
  $('#consentCancel').addEventListener('click', closeConsent);
  showConsent();
  $('#btnShortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

  const cmds = await chrome.commands.getAll();
  const sc = (name) => cmds.find((c) => c.name === name)?.shortcut || '未設定';
  $('#scSel').textContent = sc('translate-selection');
  $('#scPage').textContent = sc('translate-page');

  refresh();
  setInterval(refresh, 1000);
}

// ---------------------------------------------------------------------------
// Models

function renderModels() {
  $('#models').innerHTML = Object.values(MODELS)
    .map(
      (m) => `
    <div class="model" data-id="${m.id}">
      <label class="mpick">
        <input type="radio" name="model" value="${m.id}" />
        <span class="mname">${m.label}</span>
      </label>
      <span class="mstate fig">—</span>
      <span class="mbtns">
        <button class="ghost small" data-act="download" hidden>ダウンロード</button>
        <button class="ghost small" data-act="delete" hidden>削除</button>
      </span>
    </div>`,
    )
    .join('');
  for (const r of document.querySelectorAll('#models input[type=radio]')) {
    r.checked = r.value === settings.model;
    r.addEventListener('change', () => {
      save({ model: r.value }, 'モデルを切り替えました');
      refresh();
    });
  }
  for (const b of document.querySelectorAll('#models button')) {
    b.addEventListener('click', () => {
      const id = b.closest('.model').dataset.id;
      if (b.dataset.act === 'download') {
        startDownload(id);
      } else if (confirm(`PLaMo 3 Translate ${MODELS[id].label} を削除しますか？`)) {
        act('削除しています…', { type: 'deleteModel', modelId: id }, () => '削除しました');
      }
    });
  }
}

// Download needs the licence agreement once (per licence revision); the panel asks for it in place.
async function startDownload(id) {
  if (await licenseConsent()) return act('', { type: 'downloadModel', modelId: id }, () => '');
  consentFor = id;
  $('#consentModel').textContent = `PLaMo 3 Translate ${MODELS[id].label} `;
  $('#consent').hidden = false;
  $('#consentOk').focus();
}

function closeConsent() {
  $('#consent').hidden = true;
  consentFor = '';
}

async function showConsent() {
  const c = await licenseConsent();
  const day = c ? new Date(c.at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  const line = $('#consentState');
  line.hidden = !c;
  line.innerHTML = c ? `${day}に <a href="../licenses/index.html" target="_blank">PLaMo コミュニティライセンス契約</a>に同意しました。` : '';
}

function showModels(s) {
  for (const row of document.querySelectorAll('#models .model')) {
    const id = row.dataset.id;
    const m = MODELS[id];
    const ms = s.models?.[id] || {};
    const dl = s.dl?.id === id && s.dl.state === 'downloading';
    row.dataset.selected = String(id === settings.model);
    row.querySelector('input').checked = id === settings.model;
    const stEl = row.querySelector('.mstate');
    // downloaded: a check and the size; not yet: the size next to the download button
    if (dl) stEl.textContent = 'ダウンロード中';
    else if (ms.present) stEl.innerHTML = `${CHECK}${fmtBytes(ms.size)}`;
    else if (ms.partial) stEl.textContent = '途中まで';
    else stEl.textContent = fmtBytes(m.approxBytes);
    const bDl = row.querySelector('[data-act=download]');
    const bDel = row.querySelector('[data-act=delete]');
    bDl.hidden = !!ms.present || dl;
    bDl.textContent = ms.partial ? '再開' : 'ダウンロード';
    bDl.disabled = busy || s.dl?.state === 'downloading';
    bDel.hidden = !(ms.present || ms.partial) || dl;
    bDel.disabled = busy;
  }
}

function showDownload(s) {
  const box = $('#dl');
  const d = s.dl;
  if (!d || d.state === 'done' || d.state === 'canceled') {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const name = MODELS[d.id]?.label || d.id;
  if (d.state === 'error') {
    $('#dlBar').style.transform = 'scaleX(0)';
    $('#dlText').innerHTML = `<span class="bad">${escapeHtml(name)} のダウンロードに失敗しました: ${escapeHtml(d.error?.message || '')}</span>`;
    $('#dlCancel').hidden = true;
    return;
  }
  const pct = d.total ? (d.done / d.total) * 100 : 0;
  $('#dlBar').style.transform = `scaleX(${(pct / 100).toFixed(4)})`;
  const parts = [`${fmtBytes(d.done)} / ${fmtBytes(d.total)}`];
  if (d.bps > 0) {
    parts.push(`${(d.bps / 1048576).toFixed(1)} MB/s`);
    const rest = (d.total - d.done) / d.bps;
    if (Number.isFinite(rest)) parts.push(`残り約 ${rest >= 60 ? Math.ceil(rest / 60) + ' 分' : Math.ceil(rest) + ' 秒'}`);
  }
  $('#dlText').textContent = parts.join(' · ');
  $('#dlCancel').hidden = false;
}

// ---------------------------------------------------------------------------
// Status

function showStatus(s) {
  last = s;
  const st = $('#st');
  st.dataset.state = s.state || 'error';
  st.querySelector('.label').textContent = STATUS_TEXT[s.state] || s.state;
  const known = !!s.models; // false: the status request itself failed, nothing below is known
  if (s.info) {
    $('#stBackend').textContent = [s.info.backend, s.info.gpu, s.info.offloaded ? `GPU に ${s.info.offloaded} 層` : ''].filter(Boolean).join(' · ');
    $('#stBuild').textContent = `${s.info.libllama} · コンテキスト ${s.info.nCtx} · ${s.info.slots} 並列 · 読み込み ${(s.info.loadMs / 1000).toFixed(1)} 秒`;
  } else {
    $('#stBackend').textContent = !known ? '—' : s.webgpu ? 'WebGPU' : `WebGPU が使えないため、CPU で実行します。${internalPage('gpu')} で確認できます。`;
    $('#stBuild').textContent = '—';
  }
  $('#stStorage').textContent = s.storageUsed != null ? fmtBytes(s.storageUsed) : '—';
  const err = s.engineError || s.error;
  if (s.state === 'error' && err) $('#stMsg').textContent = err.message;
  else if ($('#stMsg').dataset.sticky !== '1') $('#stMsg').textContent = '';
  $('#btnLoad').disabled = busy || !['idle', 'error'].includes(s.state);
  $('#btnUnload').disabled = busy || !['ready', 'error'].includes(s.state);
  if (!known) {
    // nothing is known about the models: no stale states, no buttons to act on them
    for (const row of document.querySelectorAll('#models .model')) {
      row.querySelector('.mstate').textContent = '—';
      for (const b of row.querySelectorAll('.mbtns button')) b.hidden = true;
    }
    return;
  }
  showModels(s);
  showDownload(s);
}

// sendMessage never settles if the worker does not answer: bound it, so the page never sits at
// "確認中…" without saying why
function ask(msg, ms) {
  return Promise.race([
    chrome.runtime.sendMessage(msg),
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { timeout: true })), ms)),
  ]);
}

let polling = false;
async function refresh() {
  if (polling) return; // one status request at a time (the poll runs every second)
  polling = true;
  try {
    const s = await ask({ type: 'status' }, 8000);
    if (typeof s?.state === 'string') showStatus(s);
    else showStatus({ state: 'error', error: { message: '状態を取得できませんでした: ' + (s?.error?.message || '応答が空です') } });
  } catch (e) {
    let message = String(e?.message || e);
    if (e?.timeout) {
      // is the service worker itself alive? (unknown message types are answered right away)
      const alive = await ask({ type: 'ping' }, 3000).then(() => true, () => false);
      message = alive
        ? '翻訳エンジンが応答しません。'
        : `拡張機能のバックグラウンド処理が応答しません。${internalPage('extensions')} でこの拡張機能を再読み込みしてください。`;
    }
    showStatus({ state: 'error', error: { message } });
  } finally {
    polling = false;
  }
}

async function act(pendingMsg, msg, okMsg) {
  busy = true;
  const m = $('#stMsg');
  m.dataset.sticky = '1';
  m.textContent = pendingMsg;
  if (last) showStatus(last);
  try {
    const r = await chrome.runtime.sendMessage(msg);
    if (r?.error && typeof r.state !== 'string') m.textContent = r.error.message;
    else {
      m.textContent = okMsg(r) || '';
      if (r) showStatus(r);
    }
  } catch (e) {
    m.textContent = String(e?.message || e);
  } finally {
    busy = false;
    setTimeout(() => (m.dataset.sticky = ''), 4000);
    refresh();
  }
}

// ---------------------------------------------------------------------------

// Pages in another language. The click on the segment is the user gesture chrome.permissions.request
// needs, so the request comes before any await.
async function setAutoPage(v) {
  if (v !== 'off') {
    const granted = await chrome.permissions.request({ origins: AUTO_ORIGINS }).catch(() => false);
    if (!granted) {
      setSeg('#autoPage', settings.autoPage);
      renderAutoPage('サイトへのアクセスが許可されませんでした。');
      return;
    }
  }
  await save({ autoPage: v });
  // back to off: give the access back (a test copy that requires it keeps it)
  if (v === 'off') await chrome.permissions.remove({ origins: AUTO_ORIGINS }).catch(() => {});
  renderAutoPage();
}

async function renderAutoPage(note = '') {
  const on = settings.autoPage === 'ask' || settings.autoPage === 'auto';
  $('#autoPageMore').hidden = !on;
  // the setting is on but the access is gone (revoked on the extensions page): say so, offer to ask again
  const missing = !note && on && !(await chrome.permissions.contains({ origins: AUTO_ORIGINS }).catch(() => false));
  const warn = note || (missing ? 'サイトへのアクセスが許可されていません。' : '');
  $('#autoPageWarnText').textContent = warn;
  $('#autoPageGrant').hidden = !missing;
  $('#autoPageWarn').hidden = !warn;
}

// presets; a value saved by an older version stays selectable
function fillIdle() {
  const v = Number(settings.idleUnloadMin);
  const mins = [5, 10, 30, 60];
  if (v > 0 && !mins.includes(v)) mins.push(v);
  mins.sort((a, b) => a - b);
  $('#idleUnloadMin').innerHTML = mins.map((n) => `<option value="${n}">${n} 分</option>`).join('') + '<option value="0">解放しない</option>';
  $('#idleUnloadMin').value = String(Number.isFinite(v) ? v : DEFAULTS.idleUnloadMin);
}

function setSeg(sel, v) {
  for (const b of document.querySelectorAll(`${sel} button`)) b.setAttribute('aria-pressed', String(b.dataset.v === v));
}
function bindSeg(sel, cb) {
  for (const b of document.querySelectorAll(`${sel} button`)) {
    b.addEventListener('click', () => {
      setSeg(sel, b.dataset.v);
      cb(b.dataset.v);
    });
  }
}

async function save(patch, msg = '保存しました') {
  await saveSettings(patch);
  Object.assign(settings, patch);
  const s = $('#saved');
  s.textContent = msg;
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => (s.textContent = ''), 2200);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// the page-mode toggle also lives in the popup / page pill; the consent can be given in another options tab
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === 'local' && ch.pageMode) setSeg('#pageMode', ch.pageMode.newValue);
  if (area === 'local' && ch.licenseConsent) showConsent();
  if (area === 'local' && ch.autoPage) {
    settings.autoPage = ch.autoPage.newValue || 'off';
    setSeg('#autoPage', settings.autoPage);
    renderAutoPage();
  }
  // the popup and the page's pill add sites too
  if (area === 'local' && ch.autoPageSkip) {
    settings.autoPageSkip = ch.autoPageSkip.newValue || '';
    if (document.activeElement !== $('#autoPageSkip')) $('#autoPageSkip').value = settings.autoPageSkip;
  }
});
chrome.permissions.onAdded.addListener(() => renderAutoPage());
chrome.permissions.onRemoved.addListener(() => renderAutoPage());
