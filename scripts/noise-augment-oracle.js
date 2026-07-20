// noise-augment-oracle.js — Noise-robustness oracle (2026-07-19).
// Mixes deterministic synthetic noise (scripts/noise-synth.js) into REAL
// speech corpora at controlled SNRs and scores the production analysis
// chain per (noise type × SNR × front-end option), so noise-cancellation
// candidates are chosen from a measured accuracy-delta matrix instead of
// intuition. Decision doc: measurements/noise-robustness-oracle-2026-07-19.md.
//
// Modes:
//   pitch  — FDA corpus through the production Boersma-AC + L=2 tracker.
//            Per cell: band-relevant accuracy (correct/octave/other/null
//            vs ref) on speech, plus FALSE-VOICING rate on a 3 s
//            noise-only tail appended to every track (the fan-hum
//            painted-as-pitch failure mode).
//   gender — Hillenbrand speaker subset through the production
//            windowing/VAD/EMA pipeline (0.75 s window, 150 ms hop,
//            peak VAD, α=0.2) with the production v2 model. Per cell:
//            accuracy + mean |score - cleanScore| drift, plus VAD
//            false-trigger rate + scores on noise-only audio.
//   cpp    — Hillenbrand speaker subset, per-track median CPP bias vs
//            clean (dB). No front-end can legitimately "fix" CPP (any
//            denoiser alters the harmonic-to-noise structure CPP
//            measures); this mode quantifies when the vocal-weight
//            gauge should be DISTRUSTED, not how to repair it.
//
// Front-ends (--frontend=):
//   none   — baseline.
//   notch  — oracle-informed biquad notch cascade at the KNOWN synthetic
//            interferer frequencies (TONAL_FREQS); passthrough for
//            broadband types. This is Direction D's UPPER BOUND (perfect
//            interferer detection); a shippable D needs a peak detector,
//            which only gets built if this bound is worth it.
//
// Other knobs: --vt=N (pitch voicingThreshold override — the adaptive-
// threshold Direction E probe: sweeping vt under noise maps the
// false-voicing vs speech-accuracy tradeoff an adaptive gate could
// navigate), --snrs=20,10,5  --noises=a,b,c  --subset=N (gender/cpp
// speaker stride), --model=<HF id> (gender).
//
// Usage:
//   node scripts/noise-augment-oracle.js pitch  [--frontend=notch] [--vt=0.45]
//   node scripts/noise-augment-oracle.js gender [--noises=crickets,cicadas]
//   node scripts/noise-augment-oracle.js cpp
//
// Speech stays real; only the interference is synthetic (binding-
// methodology compromise, documented in the decision doc; field-recorded
// noise validation is a follow-up before shipping any front-end).

import { loadAllCorpora } from "../tests/dsp/data/corpora.js";
import { resampleLinear } from "../tests/dsp/swift-f0-adapter.js";
import { createBoersmaAC, createPathTracker, createHarmonicVoicingGuard, BOERSMA_FRAME_LENGTH_16K } from "../src/dsp/boersma-ac.js";
import { computeCPP, CPP_INPUT_LEN } from "../src/dsp/cpp.js";
import {
  SR, NOISE_TYPES, TONAL_FREQS, babble, mix, notchCascade,
} from "./noise-synth.js";
import { createNoiseNotch, isNearNotch } from "../src/dsp/noise-notch.js";

const args = Object.fromEntries(
  process.argv.slice(3).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? "true"] : [a, "true"];
  }),
);
const MODE = process.argv[2];
const SNRS = (args.snrs || "20,10,5").split(",").map(Number);
const FRONTEND = args.frontend || "none";
const VT = args.vt ? parseFloat(args.vt) : null;
const SUBSET_STRIDE = parseInt(args.subset || "3", 10);
const NOISE_LIST = (args.noises || "white,pink,fan-hum,mains-complex,babble,crickets,cicadas").split(",");

const HOP = 400;
const N = BOERSMA_FRAME_LENGTH_16K;
const TAIL_SEC = 3;
// Noise-only lead prepended to every noisy pitch cell (--lead=N). Gives
// the persistent-peak tracker its promotion time — and is the realistic
// condition anyway (ambient noise precedes speech in a session). Applied
// identically to ALL front-ends so comparisons stay apples-to-apples.
const LEAD_SEC = args.lead != null ? parseFloat(args.lead) : 8;

function to16k(t) {
  return t.sampleRate === SR ? t.samples : resampleLinear(t.samples, t.sampleRate, SR);
}

function applyFrontend(signal, noiseName) {
  if (FRONTEND === "notch" && TONAL_FREQS[noiseName]) {
    return notchCascade(signal, TONAL_FREQS[noiseName]);
  }
  if (FRONTEND === "tracker") {
    // The REAL production front-end (src/dsp/noise-notch.js), streamed
    // chunk-by-chunk exactly as the pitch worker applies it — including
    // its detection warm-up (first minTrackSec unprotected), so this
    // measures the shippable implementation, not the oracle-informed
    // upper bound.
    const notch = createNoiseNotch(SR);
    const out = new Float32Array(signal.length);
    for (let i = 0; i < signal.length; i += 400) {
      const chunk = Float32Array.from(signal.subarray(i, Math.min(i + 400, signal.length)));
      notch.process(chunk);
      out.set(chunk, i);
    }
    return out;
  }
  return signal;
}

function classify(reported, truth) {
  if (!(truth > 0)) return "n/a";
  if (!(reported > 0)) return "null";
  const r = reported / truth;
  if (Math.abs(r - 1) < 0.05) return "correct";
  const big = r > 1 ? r : 1 / r;
  const nearest = Math.round(big);
  if (nearest >= 2 && Math.abs(big - nearest) / nearest < 0.10) {
    return r > 1 ? "octave-up" : "octave-down";
  }
  return "other";
}

function makeNoise(name, len, sources) {
  if (name === "babble") return babble(len, sources);
  const gen = NOISE_TYPES[name];
  if (!gen) throw new Error(`unknown noise type ${name}`);
  return gen(len);
}

// ---------------------------------------------------------------- pitch

async function runPitch() {
  console.log(`pitch oracle — frontend=${FRONTEND}${VT != null ? ` vt=${VT}` : ""}`);
  const corpora = loadAllCorpora();
  const fda = corpora.filter((t) => t.corpus === "fda").map((t) => ({
    sig: to16k(t), ref: t.ref.f0, refHopMs: t.ref.hopMs, gender: t.gender,
  }));
  // babble sources: hillenbrand speech (different corpus than FDA targets)
  const hillSrc = corpora.filter((t) => t.corpus === "hillenbrand").slice(0, 40)
    .filter((_, i) => i % 5 === 0).map(to16k);
  console.log(`FDA tracks: ${fda.length}`);

  const detectorOpts = VT != null ? { voicingThreshold: VT } : {};

  function runTrack(sig) {
    const ac = createBoersmaAC(SR, N, detectorOpts);
    const pt = createPathTracker();
    const guard = createHarmonicVoicingGuard(); // production-parity
    const L2 = pt.config.lookback;
    const buf = new Float32Array(N);
    const delayLine = [];
    let fill = 0;
    const out = [];
    for (let i = 0; i + HOP <= sig.length; i += HOP) {
      buf.copyWithin(0, HOP, N);
      buf.set(sig.subarray(i, i + HOP), N - HOP);
      fill = Math.min(N, fill + HOP);
      delayLine.push(Float32Array.from(buf));
      if (delayLine.length > L2 + 1) delayLine.shift();
      if (fill < N) { pt.emit({ voiced: [], unvoicedStrength: ac.config.voicingThreshold }); out.push(null); continue; }
      let v = pt.emit(ac.candidates(buf));
      if (v > 0 && !guard.check(delayLine[0], v, SR)) v = null;
      out.push(v);
    }
    // re-align tracker delay (L=2) like ac-tuning-sweep does
    const tail = pt.flush();
    const vals = out.slice(L2).concat(tail);
    return out.map((_, k) => vals[k] ?? null);
  }

  const results = [];
  const cells = [["clean", 0]].concat(NOISE_LIST.flatMap((nz) => SNRS.map((s) => [nz, s])));
  for (const [noiseName, snr] of cells) {
    const agg = { correct: 0, "octave-up": 0, "octave-down": 0, other: 0, null: 0, voiced: 0 };
    let tailHops = 0, tailVoiced = 0;
    for (const tr of fda) {
      let sig, tailStart, lead = 0;
      if (noiseName === "clean") {
        sig = tr.sig; tailStart = tr.sig.length;
      } else {
        const noise = makeNoise(noiseName, Math.min(tr.sig.length + (TAIL_SEC + LEAD_SEC) * SR, 40 * SR), hillSrc);
        ({ mixed: sig, tailStart, lead } = mix(tr.sig, noise, snr, TAIL_SEC, LEAD_SEC));
      }
      sig = applyFrontend(sig, noiseName);
      const decoded = runTrack(sig);
      const centerOffMs = (N / 2) / SR * 1000;
      for (let k = 0; k < decoded.length; k++) {
        const sampleEnd = (k + 1) * HOP;
        if (sampleEnd <= lead) continue; // noise-only warm-up region
        if (sampleEnd > tailStart) {
          tailHops++;
          if (decoded[k] > 0) tailVoiced++;
          continue;
        }
        const tMs = (sampleEnd - lead) / SR * 1000 - centerOffMs;
        const idx = Math.round(tMs / tr.refHopMs);
        if (idx < 0 || idx >= tr.ref.length) continue;
        const truth = tr.ref[idx];
        if (!(truth > 0)) continue;
        agg.voiced++;
        agg[classify(decoded[k] ?? 0, truth)]++;
      }
    }
    const pct = (k) => (100 * agg[k] / agg.voiced).toFixed(1);
    const fv = tailHops ? (100 * tailVoiced / tailHops).toFixed(1) : "—";
    results.push({ noise: noiseName, snr, correct: +pct("correct"), octUp: +pct("octave-up"), octDown: +pct("octave-down"), other: +pct("other"), null: +pct("null"), falseVoiced: tailHops ? +fv : null });
    console.log(
      `${noiseName.padEnd(14)} ${String(snr).padStart(3)} dB | correct ${pct("correct").padStart(5)}  up ${pct("octave-up").padStart(4)}  down ${pct("octave-down").padStart(4)}  other ${pct("other").padStart(5)}  null ${pct("null").padStart(5)} | false-voiced(tail) ${String(fv).padStart(5)}%`,
    );
  }
  return results;
}

// ---------------------------------------------------------------- gender

async function runGender() {
  const MODEL_ID = args.model || "Alice-Sabrina-Ivy/voice-gender-classifier-onnx-q8-v2";
  console.log(`gender oracle — model=${MODEL_ID} frontend=${FRONTEND} subset stride=${SUBSET_STRIDE}`);
  const { pipeline: hfPipeline } = await import("@huggingface/transformers");
  const {
    RingWindow, femaleScoreFromResult, windowPeak, ema, VAD_PEAK_THRESHOLD,
    subFloorVoiced,
  } = await import("../src/ml/audio-utils.js");
  const classifier = await hfPipeline("audio-classification", MODEL_ID, { dtype: "q8" });

  const corpora = loadAllCorpora();
  const byId = new Map();
  for (const t of corpora.filter((t) => t.corpus === "hillenbrand")) {
    const sp = t.trackId.slice(0, 3);
    (byId.get(sp) ?? byId.set(sp, { gender: t.gender, parts: [] }).get(sp)).parts.push(to16k(t));
  }
  const speakers = [...byId.entries()]
    .filter((_, i) => i % SUBSET_STRIDE === 0)
    .map(([id, v]) => {
      const gap = new Float32Array(Math.floor(0.05 * SR));
      const total = v.parts.reduce((a, p) => a + p.length, 0) + gap.length * (v.parts.length - 1);
      const sig = new Float32Array(total);
      let o = 0;
      for (const p of v.parts) { sig.set(p, o); o += p.length + gap.length; }
      return { id, gender: v.gender === "m" ? "male" : "female", sig };
    });
  const fdaSrc = corpora.filter((t) => t.corpus === "fda").filter((_, i) => i % 10 === 0).map(to16k);
  console.log(`speakers: ${speakers.length} (${speakers.filter(s=>s.gender==="male").length} m / ${speakers.filter(s=>s.gender==="female").length} f)`);

  const WINDOW_SAMPLES = Math.floor(0.75 * SR);
  const HOP_SAMPLES = Math.floor(0.150 * SR);
  const VOICED_RECENCY_HOPS = Math.ceil(500 / 25); // 500 ms at the 25 ms pitch hop

  // Production VAD since 2026-07-19 = peak amplitude AND recently-voiced
  // pitch (relayed pitch-hint; audio-utils createVoicedRecencyGate).
  // Simulate by running the production pitch chain (notch + AC + L=2
  // tracker) over the same signal and gating windows on any voiced hop
  // in the trailing 500 ms. --vad=peak measures the retired peak-only VAD.
  const VAD_MODE = args.vad || "voiced";

  function voicedTimeline(sig) {
    const notch = createNoiseNotch(SR);
    const ac = createBoersmaAC(SR, N);
    const pt = createPathTracker();
    const gGuard = createHarmonicVoicingGuard();
    const gDelay = [];
    const buf = new Float32Array(N);
    let fill = 0;
    const out = [], freqs = [];
    for (let i = 0; i + 400 <= sig.length; i += 400) {
      const chunk = Float32Array.from(sig.subarray(i, i + 400));
      notch.process(chunk);
      freqs.push(notch.activeFreqs());
      buf.copyWithin(0, 400, N);
      buf.set(chunk, N - 400);
      gDelay.push(Float32Array.from(buf));
      if (gDelay.length > pt.config.lookback + 1) gDelay.shift();
      fill = Math.min(N, fill + 400);
      if (fill < N) { pt.emit({ voiced: [], unvoicedStrength: ac.config.voicingThreshold }); out.push(false); continue; }
      let decoded = pt.emit(ac.candidates(buf));
      // ghost-voicing veto + harmonic guard, as in pitch-worker
      if (decoded > 0 && isNearNotch(decoded, notch.activeFreqs())) decoded = null;
      if (decoded > 0 && !gGuard.check(gDelay[0], decoded, SR)) decoded = null;
      out.push(decoded > 0);
    }
    const L2 = pt.config.lookback;
    const tail = pt.flush().map((v) => v > 0);
    const vals = out.slice(L2).concat(tail);
    return { voiced: out.map((_, k) => vals[k] ?? false), notchFreqs: freqs };
  }

  function recentlyVoiced(timeline, samplePos) {
    const hop = Math.floor(samplePos / 400);
    for (let k = Math.max(0, hop - VOICED_RECENCY_HOPS); k <= Math.min(hop, timeline.voiced.length - 1); k++) {
      if (timeline.voiced[k]) return true;
    }
    return false;
  }
  function notchFreqsAt(timeline, samplePos) {
    const hop = Math.min(Math.floor(samplePos / 400), timeline.notchFreqs.length - 1);
    return hop >= 0 ? timeline.notchFreqs[hop] : [];
  }

  async function scoreTrack(sig) {
    const timeline = VAD_MODE === "voiced" ? voicedTimeline(sig) : null;
    const ring = new RingWindow(WINDOW_SAMPLES);
    let smoothed = null;
    let pos = 0;
    while (pos < sig.length) {
      ring.append(sig.subarray(pos, Math.min(pos + HOP_SAMPLES, sig.length)));
      pos += HOP_SAMPLES;
      if (!ring.isFull()) continue;
      const win = ring.snapshot();
      if (windowPeak(win) < VAD_PEAK_THRESHOLD) continue;
      if (timeline && !recentlyVoiced(timeline, pos)
          && !subFloorVoiced(win, SR, notchFreqsAt(timeline, pos))) continue;
      const female = femaleScoreFromResult(await classifier(win, { sampling_rate: SR }));
      if (female == null) continue;
      smoothed = ema(smoothed, female, 0.2);
    }
    return smoothed;
  }

  const clean = new Map();
  for (const sp of speakers) clean.set(sp.id, await scoreTrack(sp.sig));
  const cleanAcc = speakers.filter((sp) => (clean.get(sp.id) >= 0.5 ? "female" : "male") === sp.gender).length;
  console.log(`clean: acc ${cleanAcc}/${speakers.length}`);

  const results = [];
  for (const noiseName of NOISE_LIST) {
    for (const snr of SNRS) {
      let acc = 0, drift = 0, nDrift = 0;
      for (const sp of speakers) {
        const noise = makeNoise(noiseName, Math.min(sp.sig.length + LEAD_SEC * SR, 40 * SR), fdaSrc);
        // Same noise-only lead as the pitch cells: warms the voiced-gate's
        // notch tracker before speech, as in a real session.
        let { mixed } = mix(sp.sig, noise, snr, 0, LEAD_SEC);
        mixed = applyFrontend(mixed, noiseName);
        const s = await scoreTrack(mixed);
        if (s != null) {
          if ((s >= 0.5 ? "female" : "male") === sp.gender) acc++;
          const c = clean.get(sp.id);
          if (c != null) { drift += Math.abs(s - c); nDrift++; }
        }
      }
      // VAD false-trigger on noise-only audio. 20 s, evaluated over the
      // last 10 s — the first half is warm-up so the voiced-gate's notch
      // tracker (5 s promotion for tonal types) is judged at steady state,
      // matching a session where the noise has been present for a while.
      const noiseOnly = makeNoise(noiseName, 20 * SR, fdaSrc);
      // scale like a +10 dB-SNR mix against typical speech (activeRms ~0.1)
      const scaled = Float32Array.from(noiseOnly, (v) => v * 0.03);
      const timelineN = VAD_MODE === "voiced" ? voicedTimeline(scaled) : null;
      const ringN = new RingWindow(WINDOW_SAMPLES);
      let vadWindows = 0, vadPassed = 0, noiseScores = [];
      let p = 0;
      while (p < scaled.length) {
        ringN.append(scaled.subarray(p, Math.min(p + HOP_SAMPLES, scaled.length)));
        p += HOP_SAMPLES;
        if (!ringN.isFull()) continue;
        if (p < scaled.length / 2) continue; // warm-up half
        vadWindows++;
        const win = ringN.snapshot();
        if (windowPeak(win) < VAD_PEAK_THRESHOLD) continue;
        if (timelineN && !recentlyVoiced(timelineN, p)
            && !subFloorVoiced(win, SR, notchFreqsAt(timelineN, p))) continue;
        vadPassed++;
        const f = femaleScoreFromResult(await classifier(win, { sampling_rate: SR }));
        if (f != null) noiseScores.push(f);
      }
      const meanNoiseScore = noiseScores.length
        ? (noiseScores.reduce((a, b) => a + b, 0) / noiseScores.length).toFixed(2) : "—";
      results.push({ noise: noiseName, snr, acc, n: speakers.length, meanDrift: +(drift / (nDrift || 1)).toFixed(3), vadFalseRate: +(100 * vadPassed / (vadWindows || 1)).toFixed(0), meanNoiseScore });
      console.log(
        `${noiseName.padEnd(14)} ${String(snr).padStart(3)} dB | acc ${acc}/${speakers.length}  meanDrift ${(drift / (nDrift || 1)).toFixed(3)} | noise-only VAD pass ${(100 * vadPassed / (vadWindows || 1)).toFixed(0)}% meanScore ${meanNoiseScore}`,
      );
    }
  }
  return results;
}

// ---------------------------------------------------------------- cpp

async function runCpp() {
  console.log(`cpp oracle — subset stride=${SUBSET_STRIDE} (bias vs clean, dB)`);
  const corpora = loadAllCorpora();
  const tracks = corpora.filter((t) => t.corpus === "hillenbrand").filter((_, i) => i % (SUBSET_STRIDE * 4) === 0).map(to16k);
  const fdaSrc = corpora.filter((t) => t.corpus === "fda").filter((_, i) => i % 10 === 0).map(to16k);
  console.log(`tracks: ${tracks.length}`);

  function medianCpp(sig) {
    const vals = [];
    for (let i = 0; i + CPP_INPUT_LEN <= sig.length; i += CPP_INPUT_LEN) {
      const c = computeCPP(sig.subarray(i, i + CPP_INPUT_LEN), SR);
      if (c !== null && isFinite(c)) vals.push(c);
    }
    vals.sort((a, b) => a - b);
    return vals.length ? vals[Math.floor(vals.length / 2)] : null;
  }

  const clean = tracks.map(medianCpp);
  const results = [];
  for (const noiseName of NOISE_LIST) {
    for (const snr of SNRS) {
      let bias = 0, m = 0;
      for (let i = 0; i < tracks.length; i++) {
        if (clean[i] == null) continue;
        const noise = makeNoise(noiseName, Math.min(tracks[i].length, 30 * SR), fdaSrc);
        let { mixed } = mix(tracks[i], noise, snr, 0);
        mixed = applyFrontend(mixed, noiseName);
        const c = medianCpp(mixed);
        if (c != null) { bias += c - clean[i]; m++; }
      }
      results.push({ noise: noiseName, snr, biasDb: +(bias / (m || 1)).toFixed(2) });
      console.log(`${noiseName.padEnd(14)} ${String(snr).padStart(3)} dB | CPP bias ${(bias / (m || 1)).toFixed(2)} dB`);
    }
  }
  return results;
}

// ---------------------------------------------------------------- main

const runners = { pitch: runPitch, gender: runGender, cpp: runCpp };
if (!runners[MODE]) {
  console.error("usage: node scripts/noise-augment-oracle.js pitch|gender|cpp [--flags]");
  process.exit(1);
}
const t0 = Date.now();
const results = await runners[MODE]();
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (args.out) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(args.out, JSON.stringify({ mode: MODE, frontend: FRONTEND, vt: VT, results }, null, 1));
  console.log(`saved ${args.out}`);
}
