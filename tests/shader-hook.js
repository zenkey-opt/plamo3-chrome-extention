// Dev-only (never shipped): imported at the top of the TEST copy's llama-worker.js by use-shader-hook.sh.
// Captures every WGSL module the engine creates and lets shader-variants.js replace one, so shader
// experiments can be A/B-timed without rebuilding the wasm (the host side - bindings, dispatch
// geometry, params - stays as built, so a variant must keep the same contract).
import { rewrite } from './shader-variants.js';

const captured = [];
self.__shaders = captured;
const orig = GPUDevice.prototype.createShaderModule;
GPUDevice.prototype.createShaderModule = function (desc) {
  let out = null;
  try {
    out = rewrite(desc.code);
  } catch (e) {
    captured.push({ error: String(e && e.stack || e) });
  }
  captured.push({ code: desc.code, variant: out ? out.name : null });
  return orig.call(this, out ? { ...desc, code: out.code } : desc);
};
