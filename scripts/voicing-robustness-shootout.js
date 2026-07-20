// voicing-robustness-shootout.js — Head-to-head test of the voicing /
// noise-rejection mechanisms used by the major published pitch
// detectors, evaluated as add-on voicing criteria over the existing
// Boersma-AC estimator (2026-07-20).
//
// Motivation: field failure — "white noise" video content shaped
// through the upper pitch band paints sustained 290-380 Hz pitch with
// HNR ~0.2 dB. Rather than a bespoke fix, test what the literature
// uses:
//
//   yinA    — YIN's cumulative-mean-normalized difference function
//             (de Cheveigné & Kawahara 2002): d'(tau) at the decoded
//             period. True periodicity -> deep dip (d' << 1); a broad
//             noise AC bump -> shallow (d' near 1). Veto when
//             d'(tau*) > threshold.
//   harm    — SWIPE-flavored harmonic-structure check (Camacho 2008,
//             simplified): count spectral peaks at k*F0 (k=1..4) that
//             clear the local noise floor; a lone resonance has 1,
//             voiced speech has several. Veto when count < 2.
//   rawHnr  — Praat-style HNR from the UN-window-corrected AC (the
//             same measure dsp-worker already computes and the
//             dashboard displays): 10*log10(r/(1-r)) at the band max.
//             Veto when below threshold.
//   vt045   — Praat's stock voicingThreshold (0.45) as a reference
//             cell (the 2026-07-19 retune lowered production to 0.35
//             on clean corpora).
//
// All criteria are evaluated POST-HOC on the same single decode pass
// (production chain: notch + Boersma-AC + L=2 tracker + ghost veto),
// so one run scores every criterion at every threshold. vt045 needs
// its own decode pass (it changes the detector) and is run separately.
//
// Speech side (must not regress): FDA + vocadito corpus accuracy vs
// refs, per criterion/threshold — vocadito is the guard for breathy
// singing, the voicing-quality metrics' most at-risk real signal.
// Noise side: noise-only voiced/painted rates at ambient scale for
// every generator in noise-synth (incl. the resonant class).
//
// Usage: node scripts/voicing-robustness-shootout.js [--corpus=fda,vocadito]

import { loadAllCorpora } from "../tests/dsp/data/corpora.js";
import { resampleLinear } from "../tests/dsp/swift-f0-adapter.js";
import { createBoersmaAC, createPathTracker, BOERSMA_FRAME_LENGTH_16K as N, harmonicStructureCount } from "../src/dsp/boersma-ac.js";
import { createNoiseNotch, isNearNotch } from "../src/dsp/noise-notch.js";
import { pushAndMedianPitch, PITCH_SMOOTH_LEN } from "../src/audio/pitchSmoothing.js";
import { createPaintGate } from "../src/audio/pitchPaintGate.js";
import {
  SR, NOISE_TYPES, babble,
} from "./noise-synth.js";

const HOP = 400;
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] ?? "true"] : [a, "true"];
}));

// ---------------------------------------------------------------- metrics

// In-place FFT (shared shape with the production modules).
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

const FFTN = 4096;
const _re = new Float64Array(FFTN), _im = new Float64Array(FFTN);

// Raw (unwindowed) autocorrelation of the trailing 2048 samples — the
// dsp-worker computeHNR recipe. Returns { rawAc: Float64Array over
// lags 0..maxLag (normalized by r0), r0 }.
function rawAcOf(buffer, maxLag) {
  const n = Math.min(buffer.length, 2048);
  const off = buffer.length - n;
  _re.fill(0); _im.fill(0);
  for (let i = 0; i < n; i++) _re[i] = buffer[off + i];
  fft(_re, _im);
  for (let i = 0; i < FFTN; i++) { _re[i] = _re[i] * _re[i] + _im[i] * _im[i]; _im[i] = 0; }
  fft(_re, _im);
  const r0 = _re[0] / FFTN;
  const out = new Float64Array(maxLag + 1);
  if (r0 <= 0) return { rawAc: out, r0: 0 };
  for (let t = 0; t <= maxLag; t++) out[t] = (_re[t] / FFTN) / r0;
  return { rawAc: out, r0 };
}

// YIN CMNDF at the decoded period, from the RAW AC (difference-function
// approximation d(tau) ~ 2*r0*(1 - rawAc(tau))): d'(tau) =
// d(tau) * tau / sum_{j<=tau} d(j). Returns min d' within ±5% of tau*.
function cmndfAt(rawAc, tauStar) {
  const maxT = Math.min(rawAc.length - 1, Math.ceil(tauStar * 1.05));
  let cum = 0;
  const dprime = new Float64Array(maxT + 1);
  for (let t = 1; t <= maxT; t++) {
    const d = Math.max(0, 1 - rawAc[t]); // d(tau)/(2*r0)
    cum += d;
    dprime[t] = cum > 0 ? (d * t) / cum : 1;
  }
  let best = Infinity;
  for (let t = Math.max(1, Math.floor(tauStar * 0.95)); t <= maxT; t++) {
    if (dprime[t] < best) best = dprime[t];
  }
  return best;
}

// Raw-AC HNR at band max (the dsp-worker/dashboard measure).
function rawHnrOf(rawAc) {
  const minLag = Math.floor(SR / 600), maxLag = Math.floor(SR / 75);
  let m = 0;
  for (let t = minLag; t <= Math.min(maxLag, rawAc.length - 1); t++) if (rawAc[t] > m) m = rawAc[t];
  if (m <= 0) return -30;
  m = Math.min(m, 0.99);
  return 10 * Math.log10(m / (1 - m));
}

// ---------------------------------------------------------------- decode

// Single pass over the signal, one entry PER HOP, realigned so
// entry[k] describes signal hop k (the tracker emits frame k at hop
// k+L; we shift back by L and drop the un-flushed tail — 2 hops,
// negligible). Metrics are computed from the delay-line buffer of the
// decoded frame itself, so they stay aligned after the shift.
function runChain(sig, vt = null) {
  const notch = createNoiseNotch(SR);
  const ac = createBoersmaAC(SR, N, vt != null ? { voicingThreshold: vt } : {});
  const pt = createPathTracker();
  const L = pt.config.lookback;
  const buf = new Float32Array(N);
  const delayLine = []; // analysis buffers, newest last; decoded frame = first
  let fill = 0;
  const perHop = []; // one entry per hop (emission-aligned)
  for (let i = 0; i + HOP <= sig.length; i += HOP) {
    const chunk = Float32Array.from(sig.subarray(i, i + HOP));
    notch.process(chunk);
    buf.copyWithin(0, HOP, N);
    buf.set(chunk, N - HOP);
    fill = Math.min(N, fill + HOP);
    delayLine.push(Float32Array.from(buf));
    if (delayLine.length > L + 1) delayLine.shift();
    let v;
    if (fill < N) {
      pt.emit({ voiced: [], unvoicedStrength: ac.config.voicingThreshold });
      v = null;
    } else {
      v = pt.emit(ac.candidates(buf));
      if (v === undefined) v = null; // tracker warmup
      if (v > 0 && isNearNotch(v, notch.activeFreqs())) v = null;
    }
    if (!(v > 0)) { perHop.push({ f0: 0 }); continue; }
    const frameBuf = delayLine[0]; // buffer of the frame L hops back
    const tauStar = SR / v;
    const { rawAc } = rawAcOf(frameBuf, Math.floor(SR / 40));
    perHop.push({
      f0: v,
      yinD: cmndfAt(rawAc, tauStar),
      harmCount: harmonicStructureCount(frameBuf, v, SR, 4),
      harmCount10: harmonicStructureCount(frameBuf, v, SR, 10),
      harmCount16: harmonicStructureCount(frameBuf, v, SR, 16),
      rawHnr: rawHnrOf(rawAc),
    });
  }
  // realign: frame series = emissions shifted back by L
  return perHop.slice(L);
}

// ---------------------------------------------------------------- scoring

// Debounced criteria: veto only when the last K frames ALL fail the
// instantaneous check — sustained noise dies after K hops (~K*25 ms),
// transient weak speech frames survive. Implemented via a stateful
// factory; state resets per track (makeCriteria() called per track).
function debounced(instFn, K) {
  let failStreak = 0;
  return (m) => {
    if (m.f0 > 0 && !instFn(m)) failStreak++;
    else failStreak = 0;
    return failStreak < K;
  };
}
const CRITERIA_FACTORY = {
  "harm10deb8": () => debounced((m) => m.harmCount10 >= 2, 8),
  "harm10deb4": () => debounced((m) => m.harmCount10 >= 2, 4),
};
const CRITERIA = {
  baseline: () => true,
  "yinA<=0.30": (m) => m.yinD <= 0.30,
  "yinA<=0.50": (m) => m.yinD <= 0.50,
  "yinA<=0.70": (m) => m.yinD <= 0.70,
  "harm>=2": (m) => m.harmCount >= 2,
  "harm10>=2": (m) => m.harmCount10 >= 2,
  "harm16>=2": (m) => m.harmCount16 >= 2,
  "rawHnr>=1dB": (m) => m.rawHnr >= 1,
  "rawHnr>=3dB": (m) => m.rawHnr >= 3,
  "rawHnr>=5dB": (m) => m.rawHnr >= 5,
  // combination candidates
  "harm10+yin.70": (m) => m.harmCount10 >= 2 && m.yinD <= 0.70,
};

function classify(reported, truth) {
  if (!(truth > 0)) return "n/a";
  if (!(reported > 0)) return "null";
  const r = reported / truth;
  if (Math.abs(r - 1) < 0.05) return "correct";
  const big = r > 1 ? r : 1 / r;
  const nearest = Math.round(big);
  if (nearest >= 2 && Math.abs(big - nearest) / nearest < 0.10) return r > 1 ? "octave-up" : "octave-down";
  return "other";
}

function to16k(t) { return t.sampleRate === SR ? t.samples : resampleLinear(t.samples, t.sampleRate, SR); }

// ---------------------------------------------------------------- main

console.log("Loading corpora …");
const corpora = loadAllCorpora();
const CORPS = (args.corpus || "fda,vocadito").split(",");
const speech = {};
for (const c of CORPS) {
  speech[c] = corpora.filter((t) => t.corpus === c).map((t) => ({
    sig: to16k(t), ref: t.ref.f0, refHopMs: t.ref.hopMs,
  }));
  // vocadito is big; subsample for tractability
  if (c === "vocadito" && speech[c].length > 12) speech[c] = speech[c].filter((_, i) => i % 2 === 0);
  console.log(`${c}: ${speech[c].length} tracks`);
}

// --- speech regression per criterion
console.log("\n=== SPEECH (accuracy vs refs; veto applied post-decode) ===");
const speechRows = {};
for (const [cname, tracks] of Object.entries(speech)) {
  const perCrit = {};
  const allNames = [...Object.keys(CRITERIA), ...Object.keys(CRITERIA_FACTORY)];
  for (const k of allNames) perCrit[k] = { correct: 0, oct: 0, other: 0, null: 0, voiced: 0 };
  for (const tr of tracks) {
    const frames = runChain(tr.sig);
    const live = Object.fromEntries(Object.entries(CRITERIA_FACTORY).map(([k, f]) => [k, f()]));
    // stateful criteria must see EVERY frame in order (incl. unscored)
    const statefulVerdicts = frames.map((f) => Object.fromEntries(
      Object.entries(live).map(([k, fn]) => [k, fn(f)])));
    const centerOffMs = (N / 2) / SR * 1000;
    for (let k = 0; k < frames.length; k++) {
      const tMs = (k + 1) * (HOP / SR) * 1000 - centerOffMs;
      const idx = Math.round(tMs / tr.refHopMs);
      if (idx < 0 || idx >= tr.ref.length) continue;
      const truth = tr.ref[idx];
      if (!(truth > 0)) continue;
      const f = frames[k];
      for (const crit of Object.keys(perCrit)) {
        const pass = CRITERIA[crit] ? CRITERIA[crit](f) : statefulVerdicts[k][crit];
        const rep = f.f0 > 0 && pass ? f.f0 : 0;
        const cls = classify(rep, truth);
        const agg = perCrit[crit];
        agg.voiced++;
        if (cls === "correct") agg.correct++;
        else if (cls === "octave-up" || cls === "octave-down") agg.oct++;
        else if (cls === "other") agg.other++;
        else agg.null++;
      }
    }
  }
  speechRows[cname] = perCrit;
  for (const [crit, a] of Object.entries(perCrit)) {
    console.log(`${cname.padEnd(9)} ${crit.padEnd(13)} correct ${(100 * a.correct / a.voiced).toFixed(1).padStart(5)}  oct ${(100 * a.oct / a.voiced).toFixed(1).padStart(4)}  null ${(100 * a.null / a.voiced).toFixed(1).padStart(5)}`);
  }
}

// --- noise-only per criterion (ambient scale, painted via display chain)
console.log("\n=== NOISE-ONLY (30 s ambient scale 0.03; % of hops voiced / painted) ===");
const hillSrc = corpora.filter((t) => t.corpus === "hillenbrand").slice(0, 40).filter((_, i) => i % 5 === 0).map(to16k);
const noiseNames = [...Object.keys(NOISE_TYPES), "babble", "resonant-noise-q5", "resonant-noise-q2"];
for (const nz of noiseNames) {
  let sig;
  if (nz === "babble") sig = babble(30 * SR, hillSrc);
  else if (nz === "resonant-noise-q5") sig = NOISE_TYPES["resonant-noise"](30 * SR, 11, 330, 5);
  else if (nz === "resonant-noise-q2") sig = NOISE_TYPES["resonant-noise"](30 * SR, 11, 330, 2);
  else sig = NOISE_TYPES[nz](30 * SR);
  for (let i = 0; i < sig.length; i++) sig[i] *= 0.03;
  const frames = runChain(sig);
  const row = [];
  const allCrit = { ...CRITERIA };
  for (const [k, f] of Object.entries(CRITERIA_FACTORY)) allCrit[k] = f();
  for (const [crit, fn] of Object.entries(allCrit)) {
    let voiced = 0, painted = 0;
    const sm = [], gate = createPaintGate();
    for (const f of frames) {
      const rep = f.f0 > 0 && fn(f) ? f.f0 : 0;
      if (!(rep > 0)) { sm.length = 0; gate.resetSegment(); continue; }
      voiced++;
      if (gate.push(pushAndMedianPitch(sm, rep, PITCH_SMOOTH_LEN))) painted++;
    }
    row.push(`${crit}:${(100 * voiced / frames.length).toFixed(1)}/${(100 * painted / frames.length).toFixed(1)}`);
  }
  console.log(`${nz.padEnd(18)} ${row.join("  ")}`);
}
