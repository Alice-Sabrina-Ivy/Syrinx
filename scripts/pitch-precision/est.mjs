// est.mjs — estimator-level precision on synthetic held vowels.
// Oracle candidate selection (peak nearest truth within 5 %) isolates the
// peak-position estimator from candidate choice. Methods: par (production
// parabolic), logpar, sinc70, spec. Truth: smooth F0 at the frame centre
// (ctr) and the Hann^2-weighted mean instantaneous F0 over the frame (win).
import { synth, makeAC, peaks, refineParabolic, refineLogParabolic, refineSinc, refineSpectral, cents, wander } from "./lib.mjs";
import { createBoersmaAC } from "../../src/dsp/boersma-ac.js";
import { createStreamingResampler } from "../../src/ml/audio-utils.js";

const SR = 16000, N = 1280, HOP = 400;
const A = makeAC(SR, N);
const prod = createBoersmaAC(SR, N);

export function frames16k(sig) {
  const rs = createStreamingResampler(sig.sr, SR);
  const C = Math.round(sig.sr * 0.025);
  const parts = [];
  for (let k = 0; k + C <= sig.x.length; k += C) parts.push(rs(sig.x.subarray(k, k + C)));
  const tot = parts.reduce((s, p) => s + p.length, 0);
  const y = new Float32Array(tot); let o = 0; for (const p of parts) { y.set(p, o); o += p.length; }
  return y;
}

const METHODS = {
  par: (r, t) => refineParabolic(r, t),
  logpar: (r, t) => refineLogParabolic(r, t),
  sinc70: (r, t) => refineSinc(r, t, 70),
};

export function analyse(sig, { skip = 0.15, checkProd = false } = {}) {
  const y = frames16k(sig);
  const rows = [];
  const step = sig.sr / SR;
  for (let s = N; s <= y.length; s += HOP) {
    const tc = (s - N / 2) / SR; // centre (input seconds)
    if (tc < skip || tc > y.length / SR - 0.05) continue;
    const buf = y.subarray(s - N, s);
    const { r, pow } = A.frame(buf);
    const ic = Math.round(tc * sig.sr);
    const fTrue = sig.fSmooth[ic];
    // Hann^2 weighted inst freq over the frame
    let num = 0, den = 0;
    for (let i = 0; i < N; i++) { const ii = Math.round((s - N + i) * step); const w = A.w[i] * A.w[i]; num += w * sig.fInst[Math.min(ii, sig.fInst.length - 1)]; den += w; }
    const fWin = num / den;
    const pk = peaks(r, A);
    let best = null;
    for (const p of pk) if (Math.abs(p.freq / fTrue - 1) < 0.05 && (!best || Math.abs(p.freq / fTrue - 1) < Math.abs(best.freq / fTrue - 1))) best = p;
    if (!best) { rows.push({ tc, fTrue, fWin, miss: true }); continue; }
    const est = {};
    for (const [m, fn] of Object.entries(METHODS)) est[m] = SR / fn(r, best.t);
    est.spec = refineSpectral(pow, A.fftSize, SR, est.sinc70);
    if (checkProd) {
      const pc = prod.candidates(buf).voiced;
      const hit = pc.find((c) => Math.abs(c.freq - best.freq) < 1e-9);
      if (!hit) throw new Error(`prod mismatch at ${tc}: ${best.freq} vs ${pc.map((c) => c.freq).join(",")}`);
    }
    rows.push({ tc, fTrue, fWin, est });
  }
  return rows;
}

function stats(errs) {
  const n = errs.length; if (!n) return { n: 0 };
  const m = errs.reduce((a, b) => a + b, 0) / n;
  const rms = Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / n);
  const sd = Math.sqrt(errs.reduce((a, b) => a + (b - m) ** 2, 0) / n);
  const s = [...errs].map(Math.abs).sort((a, b) => a - b);
  return { n, mean: m, sd, rms, p95: s[Math.floor(0.95 * (n - 1))], max: s[n - 1] };
}
export { stats };

if (process.argv[1] && process.argv[1].endsWith("est.mjs")) {
  const exp = process.argv[2] ?? "static";
  const bands = [[75, 110], [110, 160], [160, 260], [260, 400]];
  const res = {};
  const conds = {
    static16: { sr: 16000 },
    static48: { sr: 48000 },
    static441: { sr: 44100 },
    jit48: { sr: 48000, jitter: 0.005, shimmer: 0.03, snrDb: 30 },
    jitnoisy48: { sr: 48000, jitter: 0.01, shimmer: 0.06, snrDb: 15 },
    vib48: { sr: 48000, jitter: 0.005, shimmer: 0.03, snrDb: 30, vib: [5.5, 50] },
    wander48: { sr: 48000, jitter: 0.005, shimmer: 0.03, snrDb: 30, wander: 40 },
  };
  const list = exp === "all" ? Object.keys(conds) : exp.split(",");
  for (const cn of list) {
    const c = conds[cn];
    const acc = {};
    let seed = 1;
    for (let lf = Math.log2(78); lf < Math.log2(395); lf += 0.02) { // ~24-cent grid
      const f0 = Math.pow(2, lf);
      seed++;
      const vib = c.vib; const wd = c.wander ? wander(seed * 7, c.wander) : null;
      const contour = vib ? (t) => vib[1] * Math.sin(2 * Math.PI * vib[0] * t) : wd ? wd : () => 0;
      const vowel = "aieu"[seed % 4];
      const sig = synth({ sr: c.sr, dur: vib || wd ? 1.2 : 0.45, f0, contour, jitter: c.jitter ?? 0, shimmer: c.shimmer ?? 0, snrDb: c.snrDb ?? Infinity, vowel, seed });
      const rows = analyse(sig, { checkProd: cn === "static16" });
      const bi = bands.findIndex(([lo, hi]) => f0 >= lo && f0 < hi);
      for (const rw of rows) {
        const key = bi < 0 ? "x" : `${bands[bi][0]}-${bands[bi][1]}`;
        acc[key] ??= { miss: 0 };
        if (rw.miss) { acc[key].miss++; continue; }
        for (const [m, f] of Object.entries(rw.est)) {
          (acc[key][`${m}|ctr`] ??= []).push(cents(f, rw.fTrue));
          (acc[key][`${m}|win`] ??= []).push(cents(f, rw.fWin));
        }
      }
    }
    res[cn] = {};
    for (const [k, v] of Object.entries(acc)) {
      res[cn][k] = { miss: v.miss };
      for (const [m, e] of Object.entries(v)) if (m !== "miss") res[cn][k][m] = stats(e);
    }
    console.log(`\n== ${cn}`);
    for (const [k, v] of Object.entries(res[cn])) {
      const line = Object.entries(v).filter(([m]) => m !== "miss" && m.endsWith(cn.startsWith("static") ? "|ctr" : "|win"))
        .map(([m, s]) => `${m.split("|")[0]} bias ${s.mean.toFixed(2)} sd ${s.sd.toFixed(2)} p95 ${s.p95.toFixed(2)}`).join(" ; ");
      console.log(`${k} n=${v["par|ctr"]?.n} miss=${v.miss}: ${line}`);
      if (!cn.startsWith("static")) console.log(`   vs ctr: ` + Object.entries(v).filter(([m]) => m.endsWith("|ctr")).map(([m, s]) => `${m.split("|")[0]} rms ${s.rms.toFixed(2)}`).join(" ; "));
    }
  }
  if (process.argv[3]) (await import("node:fs")).writeFileSync(process.argv[3], JSON.stringify(res, null, 1));
}
