// tune194-replay.mjs — the try-out's JS detector + gate on the screen's
// tuning-194 noise clips (noise-detector try-out, 2026-10-20; information,
// not the confirmation).
//
// For every noise clip of the 2026-10-06 benchmark dumps with split "tune"
// (the screen's tuning-194: noise-only, 16 kHz), runs src/dsp/firered-vad.js
// (ORT-web WASM in Node, 400-sample hops as the pitch worker feeds it) and
// counts the dump's falsely painted hops (the current app's false pitch line:
// paint > 0 and lab 2, as offtheshelf/common.py) that the R1 h gate vetoes —
// the screen's objective, pooled over hops. Two inputs:
//   native   the clip's own 16 kHz samples (the screen's condition)
//   app48    the clip band-limited x3 to 48 kHz, then the app's linear
//            48 -> 16 kHz streaming resampler in 1200-sample chunks (what the
//            pitch worker hands the detector from a 48 kHz microphone)
// The screen reported 79.8 % (native; the detector uses the screen's frame
// timing, first_avail_ms 26, since the 2026-10-20 review).
//
//   node scripts/firered/tune194-replay.mjs --dumps=<voice-detector build>/vad/dumps/noise
//        --audio=<root holding <source>/<id>.wav> [--json=build/firered-tune194.json] [--limit=N]
// Needs the local model copy (build/models/firered/: node scripts/fetch-firered-model.mjs).
// Note 2026-10-21: branch voice-detector was deleted on 2026-10-21 by the owner's decision;
// its build/ dumps (--dumps) were not kept.

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createVoiceDetector, createFireRedRunner, parseKaldiCmvn } from "../../src/dsp/firered-vad.js";
import { LOCAL_MODEL_DIR } from "./local-model.mjs";
import { createStreamingResampler } from "../../src/ml/audio-utils.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const DUMPS = arg("dumps", "");
const AUDIO = arg("audio", "");
const OUT = arg("json", path.join(repo, "build", "firered-tune194.json"));
const LIMIT = Number(arg("limit", "0"));
if (!DUMPS || !AUDIO) { console.error("usage: --dumps=<.../vad/dumps/noise> --audio=<noise audio root>"); process.exit(2); }
const { upsample } = await import(pathToFileURL(path.join(repo, "scripts/resonance-lab/candidates/formant-vtl/extract_app.mjs")).href);

const DIST = path.join(repo, "node_modules/onnxruntime-web/dist");
const ort = await import(pathToFileURL(path.join(DIST, "ort.wasm.bundle.min.mjs")).href);
ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmBinary = readFileSync(path.join(DIST, "ort-wasm-simd-threaded.wasm"));
const MD = LOCAL_MODEL_DIR;
const session = await ort.InferenceSession.create(readFileSync(path.join(MD, "fireredvad_stream_vad_with_cache.onnx")), { executionProviders: ["wasm"] });
const cmvn = parseKaldiCmvn(readFileSync(path.join(MD, "cmvn.ark")));

function readWav(file) {
  const b = readFileSync(file);
  let o = 12, fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString("ascii", o, o + 4), s = b.readUInt32LE(o + 4);
    if (id === "fmt ") fmt = { tag: b.readUInt16LE(o + 8), ch: b.readUInt16LE(o + 10), sr: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === "data") {
      const w = fmt.bits / 8, n = Math.floor(s / w / fmt.ch), x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = fmt.tag === 3 ? b.readFloatLE(o + 8 + w * i * fmt.ch) : b.readInt16LE(o + 8 + w * i * fmt.ch) / 32768;
      return { x, sr: fmt.sr };
    }
    o += 8 + s + (s & 1);
  }
  throw new Error(`${file}: no data`);
}

// Decision per hop k (t = (k + 1) * 25 ms) for chunks of 25 ms.
async function decisions(chunks16) {
  const det = createVoiceDetector();
  det.setModel({ runner: createFireRedRunner(ort, session), cmvn });
  const out = new Uint8Array(chunks16.length);
  for (let k = 0; k < chunks16.length; k++) {
    det.pushAudio(chunks16[k]);
    out[k] = (await det.hop(((k + 1) * 400) / 16000)).voice ? 1 : 0;
  }
  return out;
}

const metas = readdirSync(DUMPS).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(DUMPS, f), "utf8")))
  .filter((m) => m.split === "tune").sort((a, b) => (a.id < b.id ? -1 : 1));
const todo = LIMIT ? metas.slice(0, LIMIT) : metas;
console.log(`${todo.length} tuning clips`);
const rows = [];
const tot = { painted: 0, native: 0, app48: 0 };
const byClass = {};
const t0 = Date.now();
for (const m of todo) {
  const wav = path.join(AUDIO, m.source, `${m.id}.wav`);
  if (!existsSync(wav)) { console.error(`missing audio ${m.source}/${m.id}`); process.exit(1); }
  const { x, sr } = readWav(wav);
  if (sr !== 16000) throw new Error(`${m.id}: sr ${sr}`);
  const seg = x.subarray(m.audio.start ?? 0, (m.audio.start ?? 0) + m.audio.len);
  const b = readFileSync(path.join(DUMPS, `${m.id}.f32`));
  const d = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  // column-major (lib/streams.py load_dump: reshape(cols, n)); FALSE hops =
  // painted and labelled 2 (offtheshelf/common.py selection_masks)
  const n = m.n, pi = m.cols.indexOf("paint"), li = m.cols.indexOf("lab");
  if (d.length !== m.cols.length * n) throw new Error(`${m.id}: dump size`);
  const native = [];
  for (let k = 0; k < m.n; k++) native.push(seg.subarray(k * 400, (k + 1) * 400));
  const up = Float32Array.from(upsample(seg));
  const rs = createStreamingResampler(48000, 16000);
  const app = [];
  for (let k = 0; k < m.n; k++) app.push(rs(up.subarray(k * 1200, (k + 1) * 1200)));
  const [vn, va] = [await decisions(native), await decisions(app)];
  let painted = 0, rn = 0, ra = 0;
  for (let k = 0; k < m.n; k++) {
    if (!(d[pi * n + k] > 0 && d[li * n + k] === 2)) continue;
    painted++;
    if (!vn[k]) rn++;
    if (!va[k]) ra++;
  }
  tot.painted += painted; tot.native += rn; tot.app48 += ra;
  const c = (byClass[m.label] ??= { painted: 0, native: 0, app48: 0 });
  c.painted += painted; c.native += rn; c.app48 += ra;
  rows.push({ id: m.id, label: m.label, painted, native: rn, app48: ra });
  if (rows.length % 20 === 0) console.log(`${rows.length}/${todo.length}  pooled native ${(100 * tot.native / tot.painted).toFixed(1)} %, app48 ${(100 * tot.app48 / tot.painted).toFixed(1)} %  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
}
const pct = (a, b) => (b ? +(100 * a / b).toFixed(2) : null);
const res = {
  what: "FireRedVAD R1 h (w5, p >= 0.55, 2 s) through src/dsp/firered-vad.js on the tuning-194 noise clips: share of the dump's painted hops vetoed",
  clips: rows.length, paintedHops: tot.painted,
  removedNative: pct(tot.native, tot.painted), removedApp48: pct(tot.app48, tot.painted),
  byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, { painted: v.painted, native: pct(v.native, v.painted), app48: pct(v.app48, v.painted) }])),
  rows,
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ clips: res.clips, paintedHops: res.paintedHops, removedNative: res.removedNative, removedApp48: res.removedApp48, byClass: res.byClass }));
