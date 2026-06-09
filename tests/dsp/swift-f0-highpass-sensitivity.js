// swift-f0-highpass-sensitivity.js — Does losing the fundamental to
// mic-chain low-frequency rolloff make SwiftF0 octave-up on low-F0 voices?
//
// Motivation (2026-06-09): user reports octave-up + step-ladder pitch on
// an 85–95 Hz voice in a QUIET room, while other live trackers in the
// same room track correctly. The May harmonic-stack investigation
// explained octave-up via environmental tonal interferers; a quiet room
// weakens that explanation. Alternative hypothesis: the capture chain
// (headset/laptop mic rolloff, browser processing despite requested
// noiseSuppression=false) attenuates the 80–95 Hz fundamental itself,
// and SwiftF0's CNN — unlike autocorrelation trackers, which recover F0
// from harmonic spacing — loses the octave when the fundamental bin is
// weak.
//
// Approach: take low-F0 tracks (FDA male ~84 Hz, PTDB-TUG male) and
// apply a 2nd-order Butterworth high-pass at several cutoffs spanning
// plausible mic rolloffs (none, 60, 100, 120, 150, 200 Hz). Run the
// production streaming simulation per cutoff and classify each voiced
// ground-truth frame as correct / octave-up / octave-down / other /
// null. Also count octave-FLIP transitions (consecutive reported frames
// jumping by ~2×) — the signature that, after 5-frame median smoothing,
// renders as the reported "steps on a ladder."
//
// Usage:  node tests/dsp/swift-f0-highpass-sensitivity.js
// Output: measurements/swift-f0-highpass-sensitivity-2026-06-09.json

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadFda, loadPtdbTug } from "./data/corpora.js";
import {
  createSwiftF0Session,
  resampleLinear,
  SWIFT_F0_SAMPLE_RATE,
  SWIFT_F0_FRAME_LENGTH,
} from "./swift-f0-adapter.js";
import * as ort from "onnxruntime-node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const CONFIDENCE_THRESHOLD = 0.5;
const CUTOFFS_HZ = [0, 60, 100, 120, 150, 200]; // 0 = unfiltered baseline
const LOW_F0_MAX_HZ = 110; // only tracks whose median voiced truth is below this

// 2nd-order Butterworth high-pass (biquad, RBJ cookbook), applied twice
// for a steeper 4th-order response approximating real mic rolloff slopes.
function highPass(samples, sampleRate, cutoffHz) {
  if (cutoffHz <= 0) return samples;
  const out = Float32Array.from(samples);
  for (let pass = 0; pass < 2; pass++) {
    const w0 = 2 * Math.PI * cutoffHz / sampleRate;
    const cosW0 = Math.cos(w0);
    const alpha = Math.sin(w0) / Math.SQRT2; // Q = 1/sqrt(2)
    const b0 = (1 + cosW0) / 2;
    const b1 = -(1 + cosW0);
    const b2 = (1 + cosW0) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosW0;
    const a2 = 1 - alpha;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const x0 = out[i];
      const y0 = (b0 / a0) * x0 + (b1 / a0) * x1 + (b2 / a0) * x2
               - (a1 / a0) * y1 - (a2 / a0) * y2;
      x2 = x1; x1 = x0;
      y2 = y1; y1 = y0;
      out[i] = y0;
    }
  }
  return out;
}

function classifyError(reportedHz, truthHz) {
  if (!(reportedHz > 0)) return "null";
  const tolHz = truthHz * 0.05;
  if (Math.abs(reportedHz - truthHz) < tolHz) return "correct";
  const r = reportedHz / truthHz;
  if (r >= 1.5) {
    const nearest = Math.round(r);
    if (nearest >= 2 && Math.abs(r - nearest) / nearest < 0.1) return "octave-up";
  } else if (r <= 1 / 1.5) {
    const inv = 1 / r;
    const nearest = Math.round(inv);
    if (nearest >= 2 && Math.abs(inv - nearest) / nearest < 0.1) return "octave-down";
  }
  return "other";
}

class StreamingPitch {
  constructor(session) {
    this.session = session;
    this.inputName = session.inputNames[0];
    this.buffer = new Float32Array(SWIFT_F0_FRAME_LENGTH);
    this.fill = 0;
  }
  reset() { this.buffer.fill(0); this.fill = 0; }
  append(incoming) {
    const k = incoming.length;
    if (k === 0) return;
    if (k >= SWIFT_F0_FRAME_LENGTH) {
      this.buffer.set(incoming.subarray(k - SWIFT_F0_FRAME_LENGTH));
      this.fill = SWIFT_F0_FRAME_LENGTH;
      return;
    }
    this.buffer.copyWithin(0, k, SWIFT_F0_FRAME_LENGTH);
    this.buffer.set(incoming, SWIFT_F0_FRAME_LENGTH - k);
    this.fill = Math.min(SWIFT_F0_FRAME_LENGTH, this.fill + k);
  }
  async infer() {
    if (this.fill < SWIFT_F0_FRAME_LENGTH) return null;
    const tensor = new ort.Tensor("float32", this.buffer, [1, SWIFT_F0_FRAME_LENGTH]);
    const outputs = await this.session.run({ [this.inputName]: tensor });
    const pitch = outputs[this.session.outputNames[0]].data[0];
    const conf = outputs[this.session.outputNames[1]].data[0];
    return conf >= CONFIDENCE_THRESHOLD ? pitch : null;
  }
}

function medianOf(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

console.log("Loading SwiftF0 model …");
const { session } = await createSwiftF0Session();
const stream = new StreamingPitch(session);

console.log("Loading FDA + PTDB-TUG, selecting low-F0 tracks …");
const tracks = [...loadFda(), ...loadPtdbTug()].filter((t) => {
  const voiced = Array.from(t.ref.f0).filter((v) => v > 0);
  if (voiced.length < 50) return false;
  return medianOf(voiced) <= LOW_F0_MAX_HZ;
});
const byCorpus = {};
for (const t of tracks) byCorpus[t.corpus] = (byCorpus[t.corpus] || 0) + 1;
console.log(`  ${tracks.length} low-F0 tracks (median voiced truth ≤ ${LOW_F0_MAX_HZ} Hz):`, byCorpus);
if (tracks.length === 0) { console.log("SKIP: no low-F0 tracks available."); process.exit(0); }

const PITCH_LATENCY_MS = (SWIFT_F0_FRAME_LENGTH - 127.5) / SWIFT_F0_SAMPLE_RATE * 1000;

const results = {};
for (const cutoff of CUTOFFS_HZ) {
  const counts = { correct: 0, "octave-up": 0, "octave-down": 0, other: 0, null: 0 };
  let flipTransitions = 0;  // consecutive reported pitches ~2× apart
  let reportedPairs = 0;
  const t0 = Date.now();
  for (const track of tracks) {
    const { samples, sampleRate, ref } = track;
    const filtered = highPass(samples, sampleRate, cutoff);
    stream.reset();
    const hopN = Math.floor(sampleRate * 25 / 1000);
    const hopMs = hopN * 1000 / sampleRate;
    let prevReported = null;
    let n = 0;
    for (let i = 0; i + hopN <= filtered.length; i += hopN, n++) {
      const chunk = filtered.subarray(i, i + hopN);
      stream.append(resampleLinear(chunk, sampleRate, SWIFT_F0_SAMPLE_RATE));
      const out = await stream.infer();
      if (out === undefined) continue;
      const attrMs = (n + 1) * hopMs - PITCH_LATENCY_MS;
      if (attrMs < 0) continue;
      const refIdx = Math.round(attrMs / ref.hopMs);
      if (refIdx < 0 || refIdx >= ref.f0.length) continue;
      const truthHz = ref.f0[refIdx];
      if (!(truthHz > 0)) continue;
      const cls = classifyError(out, truthHz);
      counts[cls]++;
      if (out !== null && prevReported !== null) {
        reportedPairs++;
        const r = out > prevReported ? out / prevReported : prevReported / out;
        if (Math.abs(r - 2) < 0.2) flipTransitions++;
      }
      if (out !== null) prevReported = out;
    }
  }
  const totalVoiced = Object.values(counts).reduce((a, b) => a + b, 0);
  const pct = (k) => (100 * counts[k] / totalVoiced).toFixed(1);
  results[cutoff] = {
    counts,
    totalVoiced,
    octaveUpPct: +pct("octave-up"),
    correctPct: +pct("correct"),
    nullPct: +pct("null"),
    flipTransitions,
    reportedPairs,
    flipPct: reportedPairs > 0 ? +(100 * flipTransitions / reportedPairs).toFixed(2) : null,
  };
  console.log(
    `  cutoff ${String(cutoff).padStart(3)} Hz — correct ${pct("correct")}%  ` +
    `octave-up ${pct("octave-up")}%  octave-down ${pct("octave-down")}%  ` +
    `other ${pct("other")}%  null ${pct("null")}%  ` +
    `octave-flip transitions ${results[cutoff].flipPct}%  (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
  );
}

const jsonPath = join(ROOT, "measurements", "swift-f0-highpass-sensitivity-2026-06-09.json");
writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  config: { cutoffsHz: CUTOFFS_HZ, lowF0MaxHz: LOW_F0_MAX_HZ, confidenceThreshold: CONFIDENCE_THRESHOLD, filter: "2x biquad Butterworth HP (4th-order)" },
  trackCount: tracks.length,
  byCorpus,
  results,
}, null, 2));
console.log(`\nJSON saved to: ${jsonPath}`);
