// Shader variants for shader-hook.js. rewrite(code) returns { name, code } to replace a module, or null.
// The experiment is chosen by shader-cfg.js (written by use-shader-hook.sh).
import CFG from './shader-cfg.js';

// K-quant MMVQ mat-vec (mul_mat_vec.wgsl + mul_mat_vec_q_acc.tmpl, K_QUANTS_HANDLING), as expanded by the
// host: 16 threads per 256-value block, OUTPUTS_PER_WG rows per workgroup, NUM_COLS columns.
function kquantMatVec(code) {
  if (!code.includes('fn accumulate_vec_q_dot') || !code.includes('let tid = thread_id % 16;')) return null;
  const wg = +code.match(/@workgroup_size\((\d+)\)/)[1];
  const [, rows, cols] = code.match(/-> array<array<f32, (\d+)>, (\d+)>/).map(Number);
  const type = /\* 144;/.test(code) ? 'q4_K' : /\* 210;/.test(code) ? 'q6_K' : 'other';
  return { wg, rows, cols, type };
}

// Change the workgroup size: every thread then loops over more (or fewer) blocks before the reduction.
function withWorkgroupSize(code, from, to) {
  const subs = [
    [`@workgroup_size(${from})`, `@workgroup_size(${to})`],
    [`block += ${from} / 16)`, `block += ${to} / 16)`],
    [`array<f32, 4 * ${from}>`, `array<f32, 4 * ${to}>`],
    [`return row * ${from} + thread;`, `return row * ${to} + thread;`],
  ];
  for (const [a, b] of subs) {
    if (code.split(a).length !== 2) throw new Error('anchor not unique: ' + a);
    code = code.replace(a, b);
  }
  return code;
}

// v1: the K-quant kernels rewritten for few threads per workgroup (WG = one subgroup on most GPUs):
// every thread walks many blocks, so the per-(col,row) subgroup reduction is paid once per many blocks;
// one barrier in total; d/dmin and q8_1 d/s each read as one word; q6_K's 2-byte-aligned runs are read
// as 5 words + funnel shifts instead of 4 x (2 words + shifts). Same per-element math and association.
const V1_SETUP = {
  q4_K: `
    let iq4 = tid / 4u;
    let phase = tid % 2u;
    let qs_shift = 4u * ((tid >> 1u) % 2u);
    let sub = tid / 2u;          // the 32-value sub-block of this thread's 16 values
    let sj = 8u * (sub & 3u);
    let hi = sub >= 4u;`,
  q6_K: `
    let phase = tid % 2u;
    let sub = (tid % 8u) / 2u;
    let ql_off = 64u * (tid / 8u) + 32u * (sub & 1u) + 16u * phase;
    let qh_off = 128u + 32u * (tid / 8u) + 16u * phase;
    let ql_shift = 4u * (sub >> 1u);
    let qh_shift = 2u * sub;`,
};
const V1_ROW = {
  q4_K: `
                let wb = (src0_batch_offset + output_row * params.stride_01 + block) * 36u;
                let dm = unpack2x16float(src0[wb]);
                let s0 = (src0[wb + 1u] >> sj) & 0xFFu;
                let s1 = (src0[wb + 2u] >> sj) & 0xFFu;
                let s2 = (src0[wb + 3u] >> sj) & 0xFFu;
                let scale = f32(select(s0 & 0x3Fu, (s2 & 0x0Fu) | ((s0 & 0xC0u) >> 2u), hi));
                let mn = f32(select(s1 & 0x3Fu, (s2 >> 4u) | ((s1 & 0xC0u) >> 2u), hi));
                let q = wb + 4u + 8u * iq4 + 4u * phase;
                let a0 = (src0[q] >> qs_shift) & 0x0F0F0F0Fu;
                let a1 = (src0[q + 1u] >> qs_shift) & 0x0F0F0F0Fu;
                let a2 = (src0[q + 2u] >> qs_shift) & 0x0F0F0F0Fu;
                let a3 = (src0[q + 3u] >> qs_shift) & 0x0F0F0F0Fu;
                for (var col = 0u; col < NUM_COLS; col++) {
                    let b = bq[col];
                    let row_sum = dot4I8Packed(a0, b.x) + dot4I8Packed(a1, b.y) + dot4I8Packed(a2, b.z) + dot4I8Packed(a3, b.w);
                    acc[col][row] += bd[col].x * dm.x * scale * f32(row_sum) - dm.y * mn * (bd[col].y / 2.0);
                }`,
  q6_K: `
                let base = (src0_batch_offset + output_row * params.stride_01 + block) * 210u;
                let al = (base & 2u) == 0u;
                let wl = (base + ql_off) / 4u;
                let wh = (base + qh_off) / 4u;
                let l0 = src0[wl]; let l1 = src0[wl + 1u]; let l2 = src0[wl + 2u]; let l3 = src0[wl + 3u]; let l4 = src0[wl + 4u];
                let h0 = src0[wh]; let h1 = src0[wh + 1u]; let h2 = src0[wh + 2u]; let h3 = src0[wh + 3u]; let h4 = src0[wh + 4u];
                let a0 = q6_pack(funnel(l0, l1, al), funnel(h0, h1, al), ql_shift, qh_shift);
                let a1 = q6_pack(funnel(l1, l2, al), funnel(h1, h2, al), ql_shift, qh_shift);
                let a2 = q6_pack(funnel(l2, l3, al), funnel(h2, h3, al), ql_shift, qh_shift);
                let a3 = q6_pack(funnel(l3, l4, al), funnel(h3, h4, al), ql_shift, qh_shift);
                let dpos = base + 208u;
                let dm = unpack2x16float(src0[dpos / 4u] >> ((dpos & 2u) * 8u)).x;
                let spos = base + 192u + tid;
                let sraw = i32((src0[spos / 4u] >> ((spos & 3u) * 8u)) & 0xFFu);
                let scale = f32(select(sraw, sraw - 256, sraw >= 128));
                for (var col = 0u; col < NUM_COLS; col++) {
                    let b = bq[col];
                    let row_sum = dot4I8Packed(a0, b.x) + dot4I8Packed(a1, b.y) + dot4I8Packed(a2, b.z) + dot4I8Packed(a3, b.w);
                    acc[col][row] += bd[col].x * dm * scale * f32(row_sum);
                }`,
};
const V1_HELPERS = {
  q4_K: '',
  q6_K: `
// the u32 at a 2-byte-aligned position: halves of two consecutive words
fn funnel(a: u32, b: u32, aligned: bool) -> u32 {
    return select((a >> 16u) | (b << 16u), a, aligned);
}
// 4 q6_K values (4 low bits from ql, 2 high bits from qh) minus 32, as packed i8
fn q6_pack(ql: u32, qh: u32, ql_shift: u32, qh_shift: u32) -> u32 {
    let v = ((ql >> ql_shift) & 0x0F0F0F0Fu) | (((qh >> qh_shift) & 0x03030303u) << 4u);
    return (v + (0x80u - 32u) * 0x01010101u) ^ 0x80808080u;
}
`,
};

function kquantV1(type, cols, wg, rows = 4) {
  return `enable subgroups;
enable f16;
requires packed_4x8_integer_dot_product;
${V1_HELPERS[type]}
struct MulMatParams {
    offset_src0: u32, offset_src1: u32, offset_dst: u32, m: u32, n: u32, k: u32,
    stride_01: u32, stride_11: u32, stride_02: u32, stride_12: u32, stride_03: u32, stride_13: u32,
    bs02: u32, bs03: u32, broadcast2: u32, broadcast3: u32
};

@group(0) @binding(0) var<storage, read_write> src0: array<u32>;
@group(0) @binding(1) var<storage, read_write> src1q: array<u32>; // q8_1: 9 words (d | s << 16, qs[8])
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;
@group(0) @binding(3) var<uniform> params: MulMatParams;

const NUM_COLS = ${cols}u;
const ROWS = ${rows}u; // > 4: the extra workgroups the host dispatches (it assumes 4) exit at once
const WG = ${wg}u;
const MAX_SG = ${Math.max(1, wg / 4)}u; // subgroups are at least 4 wide
var<workgroup> partial: array<f32, ${cols * rows * Math.max(1, wg / 4)}>;

@compute @workgroup_size(${wg})
fn main(@builtin(local_invocation_id) lid: vec3<u32>,
        @builtin(workgroup_id) wg_id: vec3<u32>,
        @builtin(num_workgroups) num_wg: vec3<u32>,
        @builtin(subgroup_id) sg_id: u32,
        @builtin(subgroup_invocation_id) sg_lane: u32,
        @builtin(num_subgroups) num_sg: u32) {
    let thread_id = lid.x;
    let total_batches = params.bs02 * params.broadcast2 * params.bs03 * params.broadcast3;
    let wg_linear = wg_id.y * num_wg.x + wg_id.x;
    let output_groups = (params.m + ROWS - 1u) / ROWS;
    let batch_idx = wg_linear / output_groups;
    if (batch_idx >= total_batches) {
        return;
    }
    let row_base = (wg_linear % output_groups) * ROWS;
    let dst2_idx = batch_idx % (params.bs02 * params.broadcast2);
    let dst3_idx = batch_idx / (params.bs02 * params.broadcast2);
    let dst2_stride = params.m * params.n;
    let dst3_stride = dst2_stride * params.bs02 * params.broadcast2;
    let src03_idx = dst3_idx / params.broadcast3;
    let src02_idx = dst2_idx / params.broadcast2;
    let src0_batch_offset = params.offset_src0 + src03_idx * params.stride_03 + src02_idx * params.stride_02;
    let dst_idx_base = params.offset_dst + dst3_idx * dst3_stride + dst2_idx * dst2_stride + row_base;
    let src1q_idx_base = (dst3_idx * params.bs02 * params.broadcast2 + dst2_idx) * params.n * (params.k / 32u);

    let tid = thread_id % 16u;${V1_SETUP[type]}
    let nb = params.k / 256u;
    let kq = params.k / 32u;

    var acc: array<array<f32, ROWS>, NUM_COLS>;
    for (var block = thread_id / 16u; block < nb; block += WG / 16u) {
        var bq: array<vec4<u32>, NUM_COLS>;
        var bd: array<vec2<f32>, NUM_COLS>;
        for (var col = 0u; col < NUM_COLS; col++) {
            let w = (src1q_idx_base + col * kq + block * 8u + tid / 2u) * 9u;
            bd[col] = unpack2x16float(src1q[w]);
            let q = w + 1u + 4u * phase;
            bq[col] = vec4<u32>(src1q[q], src1q[q + 1u], src1q[q + 2u], src1q[q + 3u]);
        }
        for (var row = 0u; row < ROWS; row++) {
            let output_row = row_base + row;
            if (output_row < params.m) {${V1_ROW[type]}
            }
        }
    }

    for (var col = 0u; col < NUM_COLS; col++) {
        for (var row = 0u; row < ROWS; row++) {
            let t = subgroupAdd(acc[col][row]);
            if (sg_lane == 0u) {
                partial[(col * ROWS + row) * MAX_SG + sg_id] = t;
            }
        }
    }
    workgroupBarrier();
    for (var i = thread_id; i < NUM_COLS * ROWS; i += WG) {
        let row = i % ROWS;
        if (row_base + row < params.m) {
            var s = 0.0;
            for (var g = 0u; g < num_sg; g++) {
                s += partial[i * MAX_SG + g];
            }
            dst[dst_idx_base + (i / ROWS) * params.m + row] = s;
        }
    }
}
`;
}

export function rewrite(code) {
  const mv = kquantMatVec(code);
  if (!mv) return null;
  if (CFG.v1 && (CFG.v1.types || ['q4_K']).includes(mv.type) && mv.rows === 4 && (!CFG.v1.cols || CFG.v1.cols.includes(mv.cols))) {
    const wg = (CFG.v1.wg && CFG.v1.wg[mv.wg]) || 32;
    const rows = CFG.v1.rows || 4;
    return { name: `v1_${mv.type}_c${mv.cols}_wg${mv.wg}->${wg}_r${rows}`, code: kquantV1(mv.type, mv.cols, wg, rows) };
  }
  const table = CFG.wg && (CFG.wg[mv.cols] || CFG.wg.all);
  const to = table && table[mv.wg];
  if (to && to !== mv.wg) {
    return { name: `${mv.type}_c${mv.cols}_wg${mv.wg}->${to}`, code: withWorkgroupSize(code, mv.wg, to) };
  }
  return null;
}
