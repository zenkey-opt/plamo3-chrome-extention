// Model storage in the extension's Origin Private File System (OPFS).
//
// A model is stored as fixed-size part files plus a meta.json:
//   models/<file>/meta.json   { total, partSize, parts, complete, url, savedAt }
//   models/<file>/p00000 …
// Each part is written and committed on its own, so a download resumes part by part and
// never needs one 1.8 GB write. For inference the parts are joined into a single File
// (new File([...parts])), which references the files on disk without copying them.
//
// Do not ship a model inside the extension package: streaming a ~1.8 GB chrome-extension://
// resource crashes the browser process (observed on Brave 1.98 / Chromium 156).

export const PART_SIZE = 32 << 20;

export const partName = (i) => 'p' + String(i).padStart(5, '0');

async function modelsRoot(create) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle('models', { create });
}

export async function modelDir(m, create = false) {
  return (await modelsRoot(create)).getDirectoryHandle(m.file, { create });
}

export async function readMeta(m) {
  try {
    const f = await (await (await modelDir(m)).getFileHandle('meta.json')).getFile();
    return JSON.parse(await f.text());
  } catch {
    return null;
  }
}

export async function writeMeta(m, meta) {
  const fh = await (await modelDir(m, true)).getFileHandle('meta.json', { create: true });
  const ws = await fh.createWritable();
  await ws.write(JSON.stringify(meta));
  await ws.close();
}

/** { present, size?, partial?, done?, total? } — cheap: reads meta.json only. */
export async function modelStatus(m) {
  const meta = await readMeta(m);
  if (!meta) return { present: false };
  if (meta.complete) return { present: true, size: meta.total, savedAt: meta.savedAt };
  return { present: false, partial: true, total: meta.total };
}

/** The model as one File (parts joined by reference), or null if it is not fully downloaded. */
export async function openModel(m) {
  const meta = await readMeta(m);
  if (!meta?.complete) return null;
  const dir = await modelDir(m);
  const parts = [];
  for (let i = 0; i < meta.parts; i++) parts.push(await (await dir.getFileHandle(partName(i))).getFile());
  const file = new File(parts, m.file);
  return file.size === meta.total ? file : null;
}

export async function deleteModel(m) {
  try {
    await (await modelsRoot(false)).removeEntry(m.file, { recursive: true });
  } catch (e) {
    if (e?.name !== 'NotFoundError') throw e;
  }
}
