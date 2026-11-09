// Languages supported by PLaMo 3 Translate (53 languages; codes as the model expects).
// Order: frequently used first, the rest in Japanese 50-on order.

export const LANGS = [
  ['ja', '日本語'],
  ['en', '英語'],
  ['zh-hans', '中国語（簡体字）'],
  ['zh-hant', '中国語（繁体字）'],
  ['ko', '韓国語'],
  ['fr', 'フランス語'],
  ['de', 'ドイツ語'],
  ['es', 'スペイン語'],
  ['it', 'イタリア語'],
  ['ru', 'ロシア語'],
  ['az', 'アゼルバイジャン語'],
  ['ar', 'アラビア語'],
  ['hy', 'アルメニア語'],
  ['id', 'インドネシア語'],
  ['uz', 'ウズベク語'],
  ['ur', 'ウルドゥー語'],
  ['et', 'エストニア語'],
  ['nl', 'オランダ語'],
  ['kk', 'カザフ語'],
  ['ca', 'カタルーニャ語'],
  ['gu', 'グジャラート語'],
  ['km', 'クメール語'],
  ['hr', 'クロアチア語'],
  ['jv', 'ジャワ語'],
  ['ka', 'ジョージア語'],
  ['si', 'シンハラ語'],
  ['sk', 'スロバキア語'],
  ['sl', 'スロベニア語'],
  ['sw', 'スワヒリ語'],
  ['ceb', 'セブアノ語'],
  ['sr', 'セルビア語'],
  ['th', 'タイ語'],
  ['tl', 'タガログ語'],
  ['ta', 'タミル語'],
  ['te', 'テルグ語'],
  ['ne', 'ネパール語'],
  ['eu', 'バスク語'],
  ['hu', 'ハンガリー語'],
  ['pa', 'パンジャーブ語'],
  ['my', 'ビルマ語'],
  ['hi', 'ヒンディー語'],
  ['bg', 'ブルガリア語'],
  ['vi', 'ベトナム語'],
  ['he', 'ヘブライ語'],
  ['be', 'ベラルーシ語'],
  ['fa', 'ペルシア語'],
  ['bn', 'ベンガル語'],
  ['pl', 'ポーランド語'],
  ['mr', 'マラーティー語'],
  ['ml', 'マラヤーラム語'],
  ['ms', 'マレー語'],
  ['lv', 'ラトビア語'],
  ['lt', 'リトアニア語'],
  ['ja(easy)', 'やさしい日本語（実験的）'],
];

export const LANG_NAME = Object.fromEntries(LANGS);

export function langName(code) {
  return LANG_NAME[code] || code;
}

export function isJapaneseTarget(code) {
  return code === 'ja' || code === 'ja(easy)';
}

// Map a BCP-47-ish code (chrome.i18n.detectLanguage / <html lang>) to a model code.
// Returns null when the language is not one the model knows.
export function normalizeLang(code) {
  if (!code) return null;
  const c = String(code).toLowerCase().replace(/_/g, '-');
  if (c === 'zh' || c.startsWith('zh-cn') || c.startsWith('zh-sg') || c.startsWith('zh-hans')) return 'zh-hans';
  if (c.startsWith('zh-tw') || c.startsWith('zh-hk') || c.startsWith('zh-mo') || c.startsWith('zh-hant')) return 'zh-hant';
  const alias = { iw: 'he', fil: 'tl', jw: 'jv', in: 'id' };
  const base = alias[c.split('-')[0]] || c.split('-')[0];
  return LANG_NAME[base] ? base : null;
}

// Cheap script-based check: is this text (mostly) Japanese?
// Kana is the decisive signal; Chinese has Han characters but no kana.
export function looksJapanese(text) {
  let kana = 0, han = 0, other = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xff66 && cp <= 0xff9f)) kana++;
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) han++;
    else if (/\p{L}/u.test(ch)) other++;
  }
  if (kana === 0) return false;
  return (kana + han) / (kana + han + other) >= 0.25;
}
