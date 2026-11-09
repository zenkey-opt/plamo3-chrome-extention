// WebGPU round-trip latency probe: submit -> onSubmittedWorkDone, and copy -> mapAsync.
// Paste-able expression body for CDP evaluate (returns a promise).
(async () => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const N = 300;
  const src = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE });
  const dst = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const done = [], map = [];
  const T0 = performance.now();
  for (let i = 0; i < N; i++) {
    let t = performance.now();
    device.queue.submit([]);
    await device.queue.onSubmittedWorkDone();
    done.push(performance.now() - t);
    t = performance.now();
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, dst, 0, 256);
    device.queue.submit([enc.finish()]);
    await dst.mapAsync(GPUMapMode.READ);
    dst.unmap();
    map.push(performance.now() - t);
  }
  const total = performance.now() - T0;
  device.destroy();
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  const stat = (a) => ({ p50: q(a, 0.5), p90: q(a, 0.9), p99: q(a, 0.99), max: +Math.max(...a).toFixed(1), over100ms: a.filter((x) => x > 100).length });
  return { where: location.pathname, visibility: document.visibilityState, totalMs: Math.round(total), workDone: stat(done), mapAsync: stat(map) };
})()
