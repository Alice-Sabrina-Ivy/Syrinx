// spot-wasm.mjs — judge's check of the WebRTC candidate through its browser
// port (voice-detector benchmark, 2026-10-06): @echogarden/fvad-wasm 0.2.0
// on the int16 input spot.py --det=webrtc wrote, mode 2, 30 ms frames,
// p = share of speech over the last 3 frames, compared with the candidate's
// .f32 files.
//
//   FVAD_WASM_JS=<scratch>/node_modules/@echogarden/fvad-wasm/fvad.js \
//   node scripts/voice-detector/judge/spot-wasm.mjs [--i16=build/vad/judge/i16]
//        [--cand=build/vad/webrtc/cand/webrtc-m2-f30-w90k1-h1250]
// The package is installed in a scratch directory, never into node_modules.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const A = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "1"]; }));
const I16 = A.i16 ?? "build/vad/judge/i16";
const CDIR = A.cand ?? "build/vad/webrtc/cand/webrtc-m2-f30-w90k1-h1250";
const FVAD = process.env.FVAD_WASM_JS;
if (!FVAD || !existsSync(FVAD)) throw new Error("set FVAD_WASM_JS to the fvad.js of @echogarden/fvad-wasm 0.2.0");
const M = await (await import(pathToFileURL(FVAD).href)).default();
let worst = 0, nstreams = 0, nframes = 0;
for (const set of readdirSync(I16)) {
  for (const f of readdirSync(join(I16, set))) {
    const id = f.replace(/\.i16$/, "");
    const b = readFileSync(join(I16, set, f));
    const pcm = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
    const h = M._fvad_new();
    if (M._fvad_set_mode(h, 2) !== 0 || M._fvad_set_sample_rate(h, 16000) !== 0) throw new Error("fvad setup");
    const buf = M._malloc(480 * 2);
    const n = Math.floor(pcm.length / 480);
    const d = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      M.HEAP16.set(pcm.subarray(i * 480, (i + 1) * 480), buf >> 1);
      d[i] = M._fvad_process(h, buf, 480);
    }
    M._free(buf);
    M._fvad_free(h);
    const fb = readFileSync(join(CDIR, set, id + ".f32"));
    const P = new Float32Array(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.length));
    let md = 0;
    for (let i = 0; i < Math.min(n, P.length); i++) {
      const p = Math.fround((d[i] + (i >= 1 ? d[i - 1] : 0) + (i >= 2 ? d[i - 2] : 0)) / 3);
      md = Math.max(md, Math.abs(p - P[i]));
    }
    worst = Math.max(worst, md);
    nstreams++;
    nframes += n;
    console.log(`${set} ${id} frames ${n}/${P.length} max|dp| ${md}`);
  }
}
console.log(`WASM port: ${nstreams} streams, ${nframes} frames, worst max|dp| ${worst}`);
