// lab-worker.js — resonance lab worker (only spawned with ?resonance=lab).
//
// An extra capture consumer: receives the same 25 ms chunks as the
// production workers on its own MessagePort and runs the four finalists
// (lab-engine.js) side by side. The pnml finalist runs the DEPLOYED
// perceived-voice model (same Hub file the gender worker downloads; read
// from the transformers.js browser cache when the production worker has
// already fetched it) with its graph patched in memory (onnx-patch.js) so
// one inference yields both the original logits and the 192-d embedding the
// resonance head reads. The DSP finalists keep working if the model fails.
//
// Protocol:
//   main -> worker: { type: "init", sampleRate, assetBase }
//                   { type: "audioPort", port }
//                   { type: "reset" }                     clear the readouts
//   worker -> main: { type: "status", part: "dsp"|"pnml", status, message?, progress? }
//                   { type: "state", snapshot, perf }     ~5 Hz

import { createLabEngine } from "./lab-engine.js";
import { concatIntoOutput } from "./onnx-patch.js";

const MODEL_ID = "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2";
const POST_EVERY_MS = 200;

let engine = null;
let model = null;
let Tensor = null;
let pnmlState = "off";
let busy = false;
let lastPost = 0;
const inferMs = [];
let chunkMsTotal = 0;
let audioSTotal = 0;

function status(part, s, extra = {}) {
  self.postMessage({ type: "status", part, status: s, ...extra });
}

async function loadJson(base, name) {
  const r = await fetch(`${base}resonance-lab/${name}`);
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}

async function loadPnml() {
  pnmlState = "loading";
  status("pnml", "loading");
  try {
    const T = await import("@huggingface/transformers");
    Tensor = T.Tensor;
    T.env.allowLocalModels = false;
    T.env.allowRemoteModels = true;
    // The lab must never write a PATCHED model into the cache the production
    // gender worker reads, so transformers.js's own caching is off here and
    // the model bytes are only READ from that cache (or fetched).
    T.env.useBrowserCache = false;
    const baseFetch = T.env.fetch ?? fetch;
    T.env.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input?.url ?? String(input);
      if (url.includes(MODEL_ID) && /\/onnx\/model_quantized\.onnx(\?|$)/.test(url)) {
        let resp = null;
        try { resp = await (await caches.open("transformers-cache")).match(url); } catch { /* no cache API */ }
        if (!resp) resp = await baseFetch(input, init);
        if (!resp.ok) return resp;
        const patched = concatIntoOutput(new Uint8Array(await resp.arrayBuffer()));
        return new Response(patched, {
          status: 200,
          headers: { "Content-Type": "application/octet-stream", "Content-Length": String(patched.length) },
        });
      }
      return baseFetch(input, init);
    };
    model = await T.AutoModelForAudioClassification.from_pretrained(MODEL_ID, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (p) => {
        if (p.status === "progress" && p.file?.endsWith(".onnx")) status("pnml", "loading", { progress: p.progress });
      },
    });
    pnmlState = "ready";
    status("pnml", "ready");
  } catch (err) {
    pnmlState = "error";
    model = null;
    status("pnml", "error", { message: String(err?.message || err) });
  }
}

async function servePnml() {
  if (busy || !engine) return;
  busy = true;
  try {
    for (let r = engine.takePnmlRequest(); r; r = engine.takePnmlRequest()) {
      if (!model) { engine.pnmlDone(r.k, null); continue; } // not loaded (yet): window skipped
      const t0 = performance.now();
      let out = null;
      try {
        const res = await model({ input_values: new Tensor("float32", r.win, [1, r.win.length]) });
        out = res.logits.data;
      } catch (err) {
        status("pnml", "warn", { message: String(err?.message || err) });
      }
      inferMs.push(performance.now() - t0);
      if (inferMs.length > 100) inferMs.shift();
      engine.pnmlDone(r.k, out);
    }
  } finally {
    busy = false;
  }
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[s.length >> 1];
}

function onChunk(msg) {
  if (!engine || !msg?.buffer) return;
  const x = new Float32Array(msg.buffer);
  const t0 = performance.now();
  engine.pushChunk(x);
  chunkMsTotal += performance.now() - t0;
  audioSTotal += x.length / engine.sampleRate;
  servePnml();
  const now = performance.now();
  if (now - lastPost >= POST_EVERY_MS) {
    lastPost = now;
    self.postMessage({
      type: "state",
      snapshot: engine.snapshot(),
      perf: {
        dspMsPerAudioS: audioSTotal > 0 ? chunkMsTotal / audioSTotal : null,
        pnmlInferMsMedian: median(inferMs),
        pnmlState,
      },
    });
  }
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (!msg?.type) return;
  if (msg.type === "init") {
    try {
      const base = msg.assetBase ?? "/";
      const [le, vtln, fv, pnmlHead, reference] = await Promise.all(
        ["le_ens_h64.json", "vtln_warp.json", "fv_model.json", "pnml_head.json", "reference.json"].map((n) => loadJson(base, n)),
      );
      engine = createLabEngine({ sampleRate: msg.sampleRate, models: { le, vtln, fv, pnmlHead }, reference, pnmlMaxPending: 2 });
      status("dsp", "ready", { reference });
      loadPnml();
    } catch (err) {
      status("dsp", "error", { message: String(err?.message || err) });
    }
  } else if (msg.type === "audioPort") {
    msg.port.onmessage = (ev) => {
      try { onChunk(ev.data); } catch (err) { status("dsp", "error", { message: String(err?.message || err) }); }
    };
  } else if (msg.type === "reset") {
    engine?.resetReadouts();
  }
};
