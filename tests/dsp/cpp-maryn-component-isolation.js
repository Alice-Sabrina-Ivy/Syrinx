// cpp-maryn-component-isolation.js — Isolate which Maryn component
// caused the WS2 correlation regression vs pre-Maryn baseline.
//
// Pre-Maryn divisor=1 result:
//   Hillenbrand 0.387, PTDB-TUG 0.624, Vocadito 0.214, FDA 0.616
// Post-Maryn (full):
//   Hillenbrand 0.233, PTDB-TUG 0.570, Vocadito 0.123, FDA 0.574
//
// Test each Maryn component independently to find the culprit.
//
// Usage: node tests/dsp/cpp-maryn-component-isolation.js
// Output: measurements/cpp-maryn-component-isolation-2026-05-10.json

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { computeCPP, resetCppState } from "../../src/dsp/cpp.js";
import { loadHillenbrand, loadPtdbTug, loadVocadito, loadFda } from "./data/corpora.js";

const CHUNK_MS = 25;
const WINDOW_MS = 50;
const PRAAT_PATH = "measurements/praat-cpps-corpus-2026-05-10.json";

function median(arr) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const ex = xs[i] - mx, ey = ys[i] - my;
    num += ex * ey;
    dx += ex * ex;
    dy += ey * ey;
  }
  return dx === 0 || dy === 0 ? null : num / Math.sqrt(dx * dy);
}

function processTrack(track, opts) {
  resetCppState();
  const { samples, sampleRate } = track;
  const chunkSize = Math.floor(sampleRate * CHUNK_MS / 1000);
  const windowSize = Math.floor(sampleRate * WINDOW_MS / 1000);
  const ringCapacity = windowSize * 2;
  const ring = new Float32Array(ringCapacity);
  let ringLen = 0;
  const cpps = [];

  for (let chunkIdx = 0; ; chunkIdx++) {
    const chunkStart = chunkIdx * chunkSize;
    if (chunkStart + chunkSize > samples.length) break;
    const chunk = samples.subarray(chunkStart, chunkStart + chunkSize);
    if (ringLen + chunk.length <= ringCapacity) {
      ring.set(chunk, ringLen);
      ringLen += chunk.length;
    } else {
      const keepLen = Math.min(ringLen, ringCapacity - chunk.length);
      ring.copyWithin(0, ringLen - keepLen, ringLen);
      ring.set(chunk, keepLen);
      ringLen = keepLen + chunk.length;
    }
    if (ringLen < windowSize) continue;
    const window = ring.subarray(ringLen - windowSize, ringLen);
    const cpp = computeCPP(window, sampleRate, opts);
    if (typeof cpp === "number" && isFinite(cpp)) cpps.push(cpp);
  }
  return median(cpps);
}

const variants = {
  "(0) baseline pre-Maryn (linear LSQ + linear trend, no smoothing)": {
    regression: "linear", trend: "linear", timeSmoothFrames: 1, quefrencySmoothBins: 1,
  },
  "(1) Theil only (linear trend, no smoothing)": {
    regression: "theil", trend: "linear", timeSmoothFrames: 1, quefrencySmoothBins: 1,
  },
  "(2) Exponential trend only (linear LSQ, no smoothing)": {
    regression: "linear", trend: "exponential", timeSmoothFrames: 1, quefrencySmoothBins: 1,
  },
  "(3) Time smoothing only (linear LSQ + linear trend)": {
    regression: "linear", trend: "linear", timeSmoothFrames: 3, quefrencySmoothBins: 1,
  },
  "(4) Quefrency smoothing only (linear LSQ + linear trend)": {
    regression: "linear", trend: "linear", timeSmoothFrames: 1, quefrencySmoothBins: 3,
  },
  "(5) Theil + exponential (no smoothing)": {
    regression: "theil", trend: "exponential", timeSmoothFrames: 1, quefrencySmoothBins: 1,
  },
  "(6) Maryn full (Theil + exp + 3+3 smoothing)": {
    regression: "theil", trend: "exponential", timeSmoothFrames: 3, quefrencySmoothBins: 3,
  },
};

console.log("Maryn component isolation — Praat correlation per variant");
console.log("=".repeat(60));

const praatDoc = JSON.parse(readFileSync(PRAAT_PATH, "utf8"));
const praatIdx = new Map();
for (const r of praatDoc.results) {
  if ("error" in r) continue;
  praatIdx.set(`${r.corpus}/${r.track_id}`, r);
}

const tracks = [
  ...loadHillenbrand(),
  ...loadPtdbTug(),
  ...loadVocadito(),
  ...loadFda(),
].filter((t) => praatIdx.has(`${t.corpus}/${t.trackId}`));

console.log(`${tracks.length} tracks (matched against Praat)\n`);

const allResults = [];
for (const [label, opts] of Object.entries(variants)) {
  console.log(label);
  const tracksByCorpus = {};
  for (const t of tracks) {
    const v = processTrack(t, opts);
    if (v === null) continue;
    const praat = praatIdx.get(`${t.corpus}/${t.trackId}`);
    if (!praat) continue;
    tracksByCorpus[t.corpus] = tracksByCorpus[t.corpus] || [];
    tracksByCorpus[t.corpus].push({ praat: praat.cpps_db, syrinx: v });
  }
  const perCorpus = {};
  for (const [c, pairs] of Object.entries(tracksByCorpus)) {
    const r = pearson(pairs.map((p) => p.praat), pairs.map((p) => p.syrinx));
    perCorpus[c] = { n: pairs.length, r: r === null ? null : Math.round(r * 1000) / 1000 };
  }
  console.log(`  hill: r=${perCorpus["hillenbrand"]?.r ?? "-"} (n=${perCorpus["hillenbrand"]?.n ?? 0})`);
  console.log(`  ptdb: r=${perCorpus["ptdb-tug"]?.r ?? "-"} (n=${perCorpus["ptdb-tug"]?.n ?? 0})`);
  console.log(`  voca: r=${perCorpus["vocadito"]?.r ?? "-"} (n=${perCorpus["vocadito"]?.n ?? 0})`);
  console.log(`  fda:  r=${perCorpus["fda"]?.r ?? "-"} (n=${perCorpus["fda"]?.n ?? 0})`);
  allResults.push({ label, opts, perCorpus });
}

mkdirSync("measurements", { recursive: true });
writeFileSync("measurements/cpp-maryn-component-isolation-2026-05-10.json", JSON.stringify({
  timestamp: new Date().toISOString(),
  variants: allResults,
}, null, 2));
console.log("\nWrote measurements/cpp-maryn-component-isolation-2026-05-10.json");
