// cpp-quefrency-bins-sweep.js — Sweep the quefrency-smoothing bin count
// (the only Maryn component that HELPED in the 2026-05-10 isolation:
// mean r 0.460 → 0.487 at 3 bins; Theil/exponential/time-smoothing all
// hurt and were reverted). The bin COUNT was never swept — 3 was
// adopted directly from Praat's default. Part of the 2026-06-10
// vocal-weight accuracy pass (step 3 of the ranked plan).
//
// Method identical to cpp-maryn-component-isolation.js: per-track
// median of production-cadence per-frame CPP, Pearson r against
// Praat CPPS per corpus.
//
// Usage: node tests/dsp/cpp-quefrency-bins-sweep.js
// Output: measurements/cpp-quefrency-bins-sweep-2026-06-10.json

import { readFileSync, writeFileSync } from "node:fs";
import { computeCPP, resetCppState } from "../../src/dsp/cpp.js";
import { loadHillenbrand, loadPtdbTug, loadVocadito, loadFda } from "./data/corpora.js";

const CHUNK_MS = 25;
const WINDOW_MS = 50;
const PRAAT_PATH = "measurements/praat-cpps-corpus-2026-05-10.json";
const BIN_COUNTS = [1, 3, 5, 7, 11, 15];

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

const corpora = ["hillenbrand", "ptdb-tug", "vocadito", "fda"];
const allResults = [];
for (const bins of BIN_COUNTS) {
  const opts = { regression: "linear", trend: "linear", timeSmoothFrames: 1, quefrencySmoothBins: bins };
  const byCorpus = {};
  for (const t of tracks) {
    const v = processTrack(t, opts);
    if (v === null) continue;
    const praat = praatIdx.get(`${t.corpus}/${t.trackId}`);
    (byCorpus[t.corpus] ||= []).push({ praat: praat.cpps_db, syrinx: v });
  }
  const perCorpus = {};
  const rs = [];
  for (const c of corpora) {
    const pairs = byCorpus[c] ?? [];
    const r = pearson(pairs.map((p) => p.praat), pairs.map((p) => p.syrinx));
    perCorpus[c] = { n: pairs.length, r: r === null ? null : Math.round(r * 1000) / 1000 };
    if (r !== null) rs.push(r);
  }
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  console.log(
    `bins=${String(bins).padStart(2)}  ` +
    corpora.map((c) => `${c.slice(0, 4)} ${perCorpus[c].r?.toFixed(3) ?? "-"}`).join("  ") +
    `  mean ${mean.toFixed(3)}`,
  );
  allResults.push({ bins, perCorpus, meanR: Math.round(mean * 1000) / 1000 });
}

writeFileSync("measurements/cpp-quefrency-bins-sweep-2026-06-10.json", JSON.stringify({
  timestamp: new Date().toISOString(),
  method: "per-track median of production-cadence CPP vs Praat CPPS, Pearson per corpus",
  results: allResults,
}, null, 1));
console.log("\nsaved measurements/cpp-quefrency-bins-sweep-2026-06-10.json");
