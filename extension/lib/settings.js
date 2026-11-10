// Settings shared by the service worker, popup and options page.
// Everything lives in chrome.storage.local and is shown on the options page.

export const DEFAULTS = Object.freeze({
  model: '2b-q4km',         // key of MODELS in lib/models.js
  idleUnloadMin: 10,        // unload the model (free VRAM) after this many idle minutes; 0 = keep it loaded
  targetLang: 'ja',         // main target language
  altTargetLang: 'en',      // used when the source is already in targetLang
  form: '',                 // '' (model decides) | 'plain' (だ・である) | 'polite' (です・ます); Japanese only
  pageMode: 'replace',      // 'replace' | 'bilingual'
  pageGlow: true,           // 置換: frosted glass and a passing light over the paragraphs being translated
  concurrency: 8,           // parallel requests (the engine has 8 slots)
  useTitleContext: true,    // pass the page title as translation context
  glossary: '',             // one "source = target" per line
  autoPage: 'off',          // pages in another language: 'off' | 'ask' (offer page translation) | 'auto' (start it)
  autoPageSkip: '',         // sites autoPage leaves alone: one host per line, subdomains included
});

// autoPage needs the optional access to every site (content/detect.js runs on each page)
export const AUTO_ORIGINS = ['http://*/*', 'https://*/*'];

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

// autoPageSkip text -> hosts. Accepts a bare host or a pasted URL ("https://example.com/path" -> example.com).
export function parseSites(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let h = raw.trim().toLowerCase();
    if (!h || h.startsWith('#')) continue;
    h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^\*\./, '').replace(/\.$/, '');
    if (h) out.push(h);
  }
  return out;
}

const coveredBy = (host, site) => host === site || host.endsWith('.' + site);

export function siteSkipped(host, text) {
  const h = String(host || '').toLowerCase();
  return !!h && parseSites(text).some((site) => coveredBy(h, site));
}

// add the host to the list, or drop every line that covers it
export function toggleSite(text, host, skip) {
  const h = String(host || '').toLowerCase();
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (skip) return siteSkipped(h, text) ? lines.join('\n') : [...lines, h].join('\n');
  return lines.filter((l) => !parseSites(l).some((site) => coveredBy(h, site))).join('\n');
}
