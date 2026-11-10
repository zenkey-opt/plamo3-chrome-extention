#!/usr/bin/env node
// Generate extension/licenses/THIRD-PARTY-NOTICES.txt for the vendored wllama build: lists every
// third-party component compiled into vendor/wllama (wllama.wasm, llama-worker.js, index.js) with its
// licence text, taken from the exact sources the build used (.work, created by tools/build-wllama.sh).
// Run it again whenever tools/build-wllama.sh changes a commit, emsdk or emdawnwebgpu.
//   node tools/gen-notices.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = join(ROOT, '.work');
const read = (p) => {
  if (!existsSync(p)) throw new Error(`missing ${p.slice(ROOT.length + 1)}: run tools/build-wllama.sh first`);
  return readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim();
};
const build = JSON.parse(read(join(ROOT, 'extension/vendor/wllama/VERSION.json'))).wasmBuild;
const short = (h) => h.slice(0, 7);

// licence block at the end of a single-header library (from its marker line to the closing comment)
function headerLicence(file, marker) {
  const s = read(file);
  const i = s.lastIndexOf(marker);
  if (i < 0) throw new Error(`no licence block in ${file}`);
  const end = s.indexOf('*/', i);
  return s.slice(i, end < 0 ? undefined : end).replace(/^-{20,}$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
const version = (file, re) => (read(file).match(re) || [])[1] || '?';

const LC = join(W, 'wsrc/llama.cpp');
const EM = join(W, 'emsdk/upstream/emscripten');
const nlohmannVer = version(join(LC, 'vendor/nlohmann/json.hpp'), /version (\d+\.\d+\.\d+)/);
const stbVer = version(join(LC, 'vendor/stb/stb_image.h'), /stb_image - (v[\d.]+)/);
const maVer = version(join(LC, 'vendor/miniaudio/miniaudio.h'), /miniaudio - (v[\d.]+)/);
const muslVer = version(join(EM, 'system/lib/libc/README.md'), /musl (v[\d.]+)/);

const parts = [
  {
    name: 'wllama',
    url: 'https://github.com/ngxson/wllama',
    what: `commit ${short(build.wllama)}`,
    licence: 'MIT License',
    text: read(join(ROOT, 'extension/vendor/wllama/LICENSE-wllama')),
  },
  {
    name: 'llama.cpp / ggml',
    url: 'https://github.com/ggml-org/llama.cpp',
    what: `commit ${short(build['llama.cpp'])}, with the patches in tools/wllama-patches/`,
    licence: 'MIT License',
    text: read(join(ROOT, 'extension/vendor/wllama/LICENSE-llama.cpp')),
  },
  {
    name: 'JSON for Modern C++ (nlohmann/json)',
    url: 'https://github.com/nlohmann/json',
    what: `${nlohmannVer}, vendored by llama.cpp`,
    licence: 'MIT License',
    text: read(join(LC, 'licenses/LICENSE-jsonhpp')),
  },
  {
    name: 'Emscripten (runtime, system libraries, emdawnwebgpu WebGPU bindings)',
    url: 'https://github.com/emscripten-core/emscripten',
    what: `emsdk ${build.emsdk}; emdawnwebgpu ${build.emdawnwebgpu}`,
    licence: 'MIT License / University of Illinois/NCSA Open Source License',
    text: read(join(EM, 'LICENSE')),
  },
  {
    name: 'musl libc',
    url: 'https://musl.libc.org/',
    what: `${muslVer}, as shipped with Emscripten`,
    licence: 'MIT License',
    text: read(join(EM, 'system/lib/libc/musl/COPYRIGHT')),
  },
  {
    name: 'Dawn (webgpu_cpp, part of emdawnwebgpu)',
    url: 'https://dawn.googlesource.com/dawn',
    what: `emdawnwebgpu ${build.emdawnwebgpu}`,
    licence: 'BSD 3-Clause License',
    text: read(join(W, 'wsrc/build/emdawn/emdawnwebgpu_pkg/webgpu_cpp/LICENSE')).replace(/^\/\/ ?/gm, ''),
  },
  {
    name: 'stb_image',
    url: 'https://github.com/nothings/stb',
    what: `${stbVer}, vendored by llama.cpp (multimodal helpers, unused here)`,
    licence: 'Public domain (Unlicense) or MIT License',
    text: headerLicence(join(LC, 'vendor/stb/stb_image.h'), 'This software is available under 2 licenses'),
  },
  {
    name: 'miniaudio',
    url: 'https://miniaud.io/',
    what: `${maVer}, vendored by llama.cpp (multimodal helpers, unused here)`,
    licence: 'Public domain (Unlicense) or MIT No Attribution',
    text: headerLicence(join(LC, 'vendor/miniaudio/miniaudio.h'), 'This software is available as a choice of the following licenses'),
  },
  {
    name: 'LLVM libc++, libc++abi and compiler-rt',
    url: 'https://llvm.org/',
    what: 'as shipped with Emscripten',
    licence: 'Apache License 2.0 with LLVM Exceptions',
    text:
      'Embedded in object form, which the LLVM exception exempts from the notice requirements:\n' +
      '"As an exception, if, as a result of your compiling your source code, portions of this Software are\n' +
      'embedded into an Object form of such source code, you may redistribute such embedded portions in such\n' +
      'Object form without complying with the conditions of Sections 4(a), 4(b) and 4(d) of the License."\n' +
      'Full text: https://llvm.org/LICENSE.txt',
  },
];

const rule = '='.repeat(78);
let out =
  'PLaMo 3 Translate Local — third-party notices\n' +
  'サードパーティ ソフトウェアの表示\n\n' +
  'The inference engine in vendor/wllama/ (wllama.wasm, llama-worker.js,\n' +
  'index.js) contains the software listed below, each under its own licence.\n' +
  '推論エンジン（vendor/wllama/）には、次のソフトウェアが含まれています。\n\n' +
  'The translation model (PLaMo 3 Translate by Preferred Networks, Inc.) is not\n' +
  'included: it is downloaded from Hugging Face (pfnet) on first use and is\n' +
  'licensed under the PLaMo Community License (PLaMo-Community-License-ja.txt /\n' +
  '-en.txt in this folder). Built with PLaMo.\n\n';
parts.forEach((p, i) => {
  out += `${String(i + 1).padStart(2)}. ${p.name}\n    ${p.licence}\n    ${p.what}\n    ${p.url}\n`;
});
for (const [i, p] of parts.entries()) {
  out += `\n${rule}\n${i + 1}. ${p.name}\n   ${p.licence}\n${rule}\n\n${p.text}\n`;
}
const dest = join(ROOT, 'extension/licenses/THIRD-PARTY-NOTICES.txt');
writeFileSync(dest, out);
console.log(`wrote extension/licenses/THIRD-PARTY-NOTICES.txt (${parts.length} components, ${out.length} chars)`);
