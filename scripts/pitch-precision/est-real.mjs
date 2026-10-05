// est-real.mjs — oracle-candidate precision on real corpora: production
// resampler -> 16 kHz, frames of N samples every H samples, the AC peak
// nearest the reference (within 5 %) refined by several methods. Isolates
// peak precision + window/hop resolution from candidate choice / voicing.
// Output: build/prec/er/<corpus>_<N>_<H>.json {track: {t:[], par:[], ...}}
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { makeAC, peaks, refineParabolic, refineLogParabolic, refineSinc, refineSpectral } from "./lib.mjs";
import { frames16k } from "./est.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? "1"]; }));
const DATA = "build/pb/data";
const corpus = args.corpus, N = +(args.N ?? 1280), H = +(args.H ?? 400);
const index = JSON.parse(readFileSync(`${DATA}/index.json`, "utf8")).filter((t) => t.corpus === corpus);
const A = makeAC(16000, N);
const out = {};
for (const tr of index) {
  const b = readFileSync(`${DATA}/${corpus}/${tr.trackId}.f32`);
  const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const rb = readFileSync(`${DATA}/${corpus}/${tr.trackId}.ref.f32`);
  const ref = new Float32Array(rb.buffer.slice(rb.byteOffset, rb.byteOffset + rb.byteLength));
  const y = frames16k({ x, sr: tr.sr });
  const rt = (i) => i * tr.refHopMs / 1000 + tr.refOffsetMs / 1000;
  const refAt = (t) => { const i = Math.round((t - tr.refOffsetMs / 1000) / (tr.refHopMs / 1000)); return i >= 0 && i < ref.length ? ref[i] : 0; };
  const o = { t: [], par: [], logpar: [], sinc: [], spec: [] };
  for (let s = N; s <= y.length; s += H) {
    const tc = (s - N / 2) / 16000;
    const fr = refAt(tc);
    if (!(fr >= 50)) continue;
    const { r, pow } = A.frame(y.subarray(s - N, s));
    let best = null;
    for (const p of peaks(r, A, 0.0)) if (Math.abs(p.freq / fr - 1) < 0.05 && (!best || Math.abs(p.freq / fr - 1) < Math.abs(best.freq / fr - 1))) best = p;
    if (!best) continue;
    o.t.push(+tc.toFixed(5));
    o.par.push(16000 / refineParabolic(r, best.t));
    o.logpar.push(16000 / refineLogParabolic(r, best.t));
    const sl = refineSinc(r, best.t, 70);
    o.sinc.push(16000 / sl);
    o.spec.push(refineSpectral(pow, A.fftSize, 16000, 16000 / sl));
  }
  out[tr.trackId] = o;
}
mkdirSync("build/prec/er", { recursive: true });
writeFileSync(`build/prec/er/${corpus}_${N}_${H}.json`, JSON.stringify(out));
console.log(`done ${corpus} ${N} ${H}`);
