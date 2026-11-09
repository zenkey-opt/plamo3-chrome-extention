// PFML3 prompt builder for PLaMo 3 Translate.
// Mirrors the official chat_template.jinja shipped with the GGUF models; the raw PFML prompt
// goes straight to llama.cpp's completion (the model card recommends this for apps).

export const STOP = ['<|plamo:tag|>', '<|plamo:bos|>'];

// Source text must never contain reserved PFML tokens: llama.cpp parses special tokens
// in the prompt, so a web page could otherwise inject structure. Break them with a ZWSP.
export function sanitize(s) {
  return String(s ?? '').replace(/<\|plamo:/g, '<\u200b|plamo:');
}

/**
 * @param {object} o
 * @param {string} o.text            source text
 * @param {string} o.target          target language code (e.g. 'ja', 'en', 'zh-hans', 'ja(easy)')
 * @param {string} [o.source]        source language code (omit to let the model detect it)
 * @param {string} [o.form]          'plain' | 'polite' (only for target 'ja')
 * @param {string} [o.context]       reference context (page title, situation, ...)
 * @param {{source:string,target:string}[]} [o.glossary]
 * @param {{source:string,target:string}[]} [o.history]  previous source/translation pairs
 */
export function buildPrompt({ text, target, source, form, context, glossary, history }) {
  const tgt = target || 'ja';
  const srcAttr = source ? `<|plamo:key|>lang<|plamo:val|>${source}` : '';
  let p = '<|plamo:tag|>dataset<|plamo:msg|>translation';
  if (context && context.trim()) p += `<|plamo:tag|>context<|plamo:msg|>${sanitize(context)}`;
  for (const h of history || []) {
    p += `<|plamo:tag|>input${srcAttr}<|plamo:msg|>${sanitize(h.source)}`;
    p += `<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>${tgt}<|plamo:msg|>${sanitize(h.target)}`;
  }
  if (glossary && glossary.length) {
    p += '<|plamo:tag|>glossary';
    for (const g of glossary) p += `<|plamo:index|>${sanitize(g.source)}<|plamo:item|>${sanitize(g.target)}`;
  }
  p += `<|plamo:tag|>input${srcAttr}<|plamo:msg|>${sanitize(text)}`;
  p += `<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>${tgt}`;
  if (form && tgt === 'ja') p += `<|plamo:key|>form<|plamo:val|>${form}`;
  p += '<|plamo:msg|>';
  return p;
}

// Keep only glossary entries that actually occur in the text (saves prompt tokens).
export function relevantGlossary(glossary, text) {
  if (!glossary || !glossary.length) return [];
  const lower = text.toLowerCase();
  return glossary.filter((g) => lower.includes(g.source.toLowerCase())).slice(0, 40);
}

// Strip anything the model might leave behind.
export function cleanOutput(s) {
  return String(s || '').replace(/<\|plamo:[a-z]+\|>/g, '').replace(/\s+$/, '');
}
