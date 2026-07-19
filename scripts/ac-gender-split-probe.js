// ac-gender-split-probe.js — Per-gender corpus scoring for candidate AC
// configs (2026-07-19). The tuning sweep aggregates per corpus; this
// probe splits by the loader's per-track gender tag so a config trade
// (e.g. shorter window: session/FDA/PTDB up, hillenbrand down) can be
// checked against the project's gender-symmetric ship rule — a change
// must not buy male-band gains with female-voice regressions.
//
// Usage: node scripts/ac-gender-split-probe.js
// Configs are defined inline in CONFIGS below.

import { loadAllCorpora } from "../tests/dsp/data/corpora.js";
import { resampleLinear } from "../tests/dsp/swift-f0-adapter.js";
import { createBoersmaAC, createPathTracker } from "../src/dsp/boersma-ac.js";

const SR = 16000;
const HOP = 400;
const REF_OFFSET_MS = { "ptdb-tug": 20 };

const CONFIGS = [
  { name: "prod(fl1536,vt0.40)", frameLength: 1536, ac: { voicingThreshold: 0.40, octaveCost: 0.01 } },
  { name: "fl1536,vt0.35", frameLength: 1536, ac: { voicingThreshold: 0.35, octaveCost: 0.01 } },
  { name: "fl1280,vt0.35", frameLength: 1280, ac: { voicingThreshold: 0.35, octaveCost: 0.01 } },
];
const PATH = { octaveJumpCost: 0.15, voicedUnvoicedCost: 0.20, lookback: 2 };

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

function runConfig(sig16k, cfg) {
  const L = cfg.frameLength;
  const ac = createBoersmaAC(SR, L, cfg.ac);
  const tracker = createPathTracker(PATH);
  const buf = new Float32Array(L);
  let fill = 0;
  const reported = [];
  const centerOffMs = (L / 2) / SR * 1000;
  let hopIdx = 0;
  for (let i = 0; i + HOP <= sig16k.length; i += HOP, hopIdx++) {
    buf.copyWithin(0, HOP, L);
    buf.set(sig16k.subarray(i, i + HOP), L - HOP);
    fill = Math.min(L, fill + HOP);
    const tMs = (hopIdx + 1) * (HOP / SR) * 1000 - centerOffMs;
    if (fill < L) { tracker.emit({ voiced: [], unvoicedStrength: cfg.ac.voicingThreshold }); continue; }
    reported.push({ tMs, pitch: tracker.emit(ac.candidates(buf)) ?? 0 });
  }
  const L2 = PATH.lookback;
  const tail = tracker.flush();
  const pitches = reported.map((r) => r.pitch).slice(L2).concat(tail);
  for (let k = 0; k < reported.length; k++) reported[k].pitch = pitches[k] ?? 0;
  return reported;
}

console.log("Loading corpora …");
const corpora = loadAllCorpora();
const tracks = corpora.map((t) => ({
  corpus: t.corpus,
  gender: t.gender,
  sig16k: t.sampleRate === SR ? t.samples : resampleLinear(t.samples, t.sampleRate, SR),
  ref: t.ref.f0,
  refHopMs: t.ref.hopMs,
}));

for (const cfg of CONFIGS) {
  console.log(`\n=== ${cfg.name} ===`);
  const agg = {}; // corpus|gender -> counts
  for (const tr of tracks) {
    const rep = runConfig(tr.sig16k, cfg);
    const key = `${tr.corpus}|${tr.gender}`;
    const a = (agg[key] ||= { correct: 0, "octave-up": 0, "octave-down": 0, other: 0, null: 0, voiced: 0 });
    const off = REF_OFFSET_MS[tr.corpus] ?? 0;
    for (const { tMs, pitch } of rep) {
      const idx = Math.round((tMs - off) / tr.refHopMs);
      if (idx < 0 || idx >= tr.ref.length) continue;
      const truth = tr.ref[idx];
      if (!(truth > 0)) continue;
      a.voiced++;
      a[classify(pitch, truth)]++;
    }
  }
  for (const key of Object.keys(agg).sort()) {
    const a = agg[key];
    const p = (k) => (100 * a[k] / a.voiced).toFixed(1);
    console.log(
      `${key.padEnd(16)} correct ${p("correct").padStart(5)}  up ${p("octave-up").padStart(4)}  down ${p("octave-down").padStart(4)}  other ${p("other").padStart(5)}  null ${p("null").padStart(4)}  (n=${a.voiced})`,
    );
  }
}
