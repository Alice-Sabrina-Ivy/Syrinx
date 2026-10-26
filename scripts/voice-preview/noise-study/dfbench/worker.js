import * as ort from "./ort/ort.wasm.min.mjs";
import { createDfn3 } from "./dfn3.js";
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL("./ort/", import.meta.url).href;
self.onmessage = async () => {
  const r = {};
  try {
    let t = performance.now();
    const [enc, erb, df, clip] = await Promise.all(["enc", "erb_dec", "df_dec"].map((m) => fetch(`models/${m}.onnx`).then((x) => x.arrayBuffer())).concat([fetch("clip.f32").then((x) => x.arrayBuffer())]));
    r.fetchMs = performance.now() - t;
    t = performance.now();
    const S = (b) => ort.InferenceSession.create(new Uint8Array(b), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    const sessions = { enc: await S(enc), erbDec: await S(erb), dfDec: await S(df) };
    r.sessionMs = performance.now() - t;
    const dfn = createDfn3(ort, sessions);
    const x = new Float32Array(clip);
    r.seconds = x.length / 48000;
    r.runs = [];
    let y;
    for (let i = 0; i < 3; i++) { const o = await dfn.denoise48(x); y = o.y; r.runs.push({ total: o.ms.total, net: o.ms.net, features: o.ms.features }); }
    let s = 0; for (const v of y) s += v * v;
    r.outRms = Math.sqrt(s / y.length);
    r.ua = navigator.userAgent;
    r.cores = navigator.hardwareConcurrency;
  } catch (e) { r.error = String(e && (e.stack || e)); }
  self.postMessage(r);
};
