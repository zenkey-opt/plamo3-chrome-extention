// WebGPU round-trip latency probe (paste-able expression body for CDP evaluate, returns a promise):
//   empty submit -> onSubmittedWorkDone, copy -> onSubmittedWorkDone, copy -> mapAsync,
//   copy -> onSubmittedWorkDone then mapAsync of the finished copy.
(async () => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const N = 200;
  const src = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE });
  const dst = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const r = { emptyDone: [], copyDone: [], copyMap: [], doneThenMap: [], mapAfterDone: [] };
  const copy = () => {
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, dst, 0, 256);
    device.queue.submit([enc.finish()]);
  };
  const T0 = performance.now();
  for (let i = 0; i < N; i++) {
    let t = performance.now();
    device.queue.submit([]);
    await device.queue.onSubmittedWorkDone();
    r.emptyDone.push(performance.now() - t);

    t = performance.now();
    copy();
    await device.queue.onSubmittedWorkDone();
    r.copyDone.push(performance.now() - t);

    t = performance.now();
    copy();
    await dst.mapAsync(GPUMapMode.READ);
    dst.unmap();
    r.copyMap.push(performance.now() - t);

    t = performance.now();
    copy();
    await device.queue.onSubmittedWorkDone();
    const t2 = performance.now();
    await dst.mapAsync(GPUMapMode.READ);
    dst.unmap();
    r.doneThenMap.push(performance.now() - t);
    r.mapAfterDone.push(performance.now() - t2);
  }
  const total = performance.now() - T0;
  device.destroy();
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); };
  const stat = (a) => `p10 ${q(a, 0.1)} p50 ${q(a, 0.5)} p90 ${q(a, 0.9)} max ${Math.max(...a).toFixed(1)}`;
  return JSON.stringify({ where: location.pathname, totalMs: Math.round(total), ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, stat(v)])) });
})()
