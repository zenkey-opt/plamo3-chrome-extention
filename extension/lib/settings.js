// Settings shared by the service worker, popup and options page.
// Everything lives in chrome.storage.local and is shown on the options page.

export const DEFAULTS = Object.freeze({
  model: '2b-q4km',         // key of MODELS in lib/models.js
  idleUnloadMin: 10,        // unload the model (free VRAM) after this many idle minutes; 0 = keep it loaded
  targetLang: 'ja',         // main target language
  altTargetLang: 'en',      // used when the source is already in targetLang
  form: '',                 // '' (model decides) | 'plain' (だ・である) | 'polite' (です・ます); Japanese only
  pageMode: 'replace',      // 'replace' | 'bilingual'
  concurrency: 8,           // parallel requests (the engine has 8 slots)
  useTitleContext: true,    // pass the page title as translation context
  glossary: '',             // one "source = target" per line
});

// keys used by the old local-server version (0.1.x); removed on update
export const OBSOLETE_KEYS = ['serverUrl', 'autoStart'];

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

export function onSettingsChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (!Object.keys(changes).some((k) => k in DEFAULTS)) return;
    getSettings().then((s) => cb(s, changes));
  });
}

// "source = target" lines -> [{source, target}]. Accepts "=", "=>", "→" or a tab.
export function parseGlossary(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(.+?)\s*(?:=>|→|=|\t)\s*(.+)$/);
    if (m && m[1].trim() && m[2].trim()) out.push({ source: m[1].trim(), target: m[2].trim() });
  }
  return out;
}
