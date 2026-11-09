// PLaMo 3 Translate GGUF models the extension can download from Hugging Face (official PFN repos).
// VRAM figures were measured with WebGPU on an RTX 2080 SUPER (n_ctx 8192, 4 slots).

export const MODELS = Object.freeze({
  '2b-q4km': {
    id: '2b-q4km',
    label: '2B · Q4_K_M',
    repo: 'pfnet/plamo-3-translate-2b-GGUF',
    file: 'plamo-3-translate-2b-Q4_K_M.gguf',
    approxBytes: 1807199392,
    note: '標準。品質重視（VRAM 約 2.1 GB）',
  },
  '0.8b-q4km': {
    id: '0.8b-q4km',
    label: '0.8B · Q4_K_M',
    repo: 'pfnet/plamo-3-translate-0.8b-GGUF',
    file: 'plamo-3-translate-0.8b-Q4_K_M.gguf',
    approxBytes: 573123200,
    note: '軽量・高速。VRAM 約 0.6 GB（タグ位置などの精度は 2B に劣る）',
  },
});

export const DEFAULT_MODEL = '2b-q4km';

export const modelUrl = (m) => `https://huggingface.co/${m.repo}/resolve/main/${m.file}`;
export const modelPage = (m) => `https://huggingface.co/${m.repo}`;

// decimal units, as on Hugging Face (1.81 GB)
export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(0) + ' MB';
  return Math.round(n / 1e3) + ' KB';
}
