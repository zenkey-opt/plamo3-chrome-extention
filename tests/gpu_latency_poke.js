// Does nudging the GPU process shorten the "GPU work finished -> promise resolved" latency?
// copy -> submit -> await onSubmittedWorkDone, while a MessageChannel loop keeps issuing a cheap
// WebGPU call (several kinds) until the wait resolves. Paste-able expression body for CDP evaluate.
(async () => {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const N = 150;
  const src = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE });
  const dst = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const tiny = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST });
  const zeros = new Uint8Array(16);
  const copy = () => {
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, dst, 0, 256);
    device.queue.submit([enc.finish()]);
  };
  const ch = new MessageChannel();
  const pokes = {
    none: null,
    emptySubmit: () => device.queue.submit([]),
    workDone: () => { device.queue.onSubmittedWorkDone(); },
    writeBuffer: () => device.queue.writeBuffer(tiny, 0, zeros),
  };
  const out = {};
  for (const [name, poke] of Object.entries(pokes)) {
    const lat = [];
    let calls = 0;
    for (let i = 0; i < N; i++) {
      let done = false;
      if (poke) {
        ch.port1.onmessage = () => {
          if (done) return;
          poke();
          calls++;
          ch.port2.postMessage(0);
        };
      }
      const t = performance.now();
      copy();
      const p = device.queue.onSubmittedWorkDone().then(() => { done = true; });
      if (poke) ch.port2.postMessage(0);
      await p;
      lat.push(performance.now() - t);
    }
    const s = [...lat].sort((a, b) => a - b);
    out[name] = `p10 ${s[Math.floor(N * 0.1)].toFixed(2)} p50 ${s[Math.floor(N * 0.5)].toFixed(2)} p90 ${s[Math.floor(N * 0.9)].toFixed(2)} pokes/wait ${(calls / N).toFixed(0)}`;
  }
  device.destroy();
  return JSON.stringify(out);
})()
