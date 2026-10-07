// window-decision-replay.mjs — decideMlWindow (utterance-gate.js, extracted
// from gender-worker.js maybeInfer on 2026-10-07) vs the pre-refactor inline
// decision, replayed over recorded production-chain runs of the
// perceived-voice gate measurement (public data:
// measurements/perceived-voice-gate-2026-10-07.md, scripts/perceived-voice-gate/).
//
//   node scripts/heard-as/window-decision-replay.mjs --runs=<dir with vad_*.jsonl [+ sc_*.jsonl]>
//
// Per stream: pitch frames -> hints on the audio clock (as replay.mjs) -> at
// every 150 ms tick BOTH decisions, each with its own gate instance fed the
// same hints; with the classifier logits from sc_*.jsonl the posted score
// stream (EMA alpha 0.2 over sigmoid(logit), reset per resetEma) is compared
// too. Exits 1 on any difference.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNS = (process.argv.find((a) => a.startsWith("--runs=")) ?? "").slice(7);
const { createUtteranceGate, meterStateForVerdict, decideMlWindow } = await import(pathToFileURL(path.join(repo, "src/ml/utterance-gate.js")).href);
const { ema, SilenceTracker, VAD_PEAK_THRESHOLD, VAD_SILENCE_FLOOR } = await import(pathToFileURL(path.join(repo, "src/ml/audio-utils.js")).href);

const C = 25, L = 2;
function legacy(st, gate, audioNowMs, peak) {
  const decision = audioNowMs === null ? { verdict: "stale", resetEma: false } : gate.decide(audioNowMs);
  const mode = decision.verdict === "stale" ? "fallback" : "gated";
  let reset = false;
  if (mode !== st.lastGateMode) { reset = true; st.lastGateMode = mode; }
  let score, vs;
  if (mode === "fallback") {
    score = peak >= VAD_PEAK_THRESHOLD;
    if (score) st.silence.noteActive();
    else if (st.silence.noteSilent()) reset = true;
    vs = score ? "scoring" : "listening";
  } else {
    score = decision.verdict === "score" && peak >= VAD_SILENCE_FLOOR;
    if (decision.resetEma) reset = true;
    vs = decision.verdict === "score" && !score ? "pause" : meterStateForVerdict(decision.verdict);
  }
  return { score, resetEma: reset, voiceState: vs, mode };
}

function readJsonl(prefix) {
  const out = new Map();
  for (const f of readdirSync(RUNS)) {
    if (!f.startsWith(prefix) || !f.endsWith(".jsonl")) continue;
    for (const l of readFileSync(path.join(RUNS, f), "utf8").split("\n")) if (l.trim()) { const d = JSON.parse(l); out.set(d.id, d); }
  }
  return out;
}
const sets = [...new Set(readdirSync(RUNS).filter((f) => f.startsWith("vad_")).map((f) => f.split(".")[0].slice(4)))].sort();
let totalStreams = 0, totalTicks = 0, totalScored = 0, totalPosted = 0, diffs = 0;
for (const set of sets) {
  const vad = readJsonl(`vad_${set}.`), sc = readJsonl(`sc_${set}.`);
  let ticks = 0, scored = 0, posted = 0, setDiffs = 0;
  for (const [id, v] of vad) {
    const s = sc.get(id);
    const lgAt = new Map();
    if (s) s.ks.forEach((k, i) => { if (s.lg[i] !== null) lgAt.set(k, s.lg[i]); });
    const peakOk = new Map(v.ticks.map(([k, g]) => [k, g !== 0]));
    const gA = createUtteranceGate({ windowMs: 750 }), gB = createUtteranceGate({ windowMs: 750 });
    const stB = { lastGateMode: null, silence: new SilenceTracker() };
    const silA = new SilenceTracker();
    let lastA = null, emaA = null, emaB = null, fed = 0;
    for (const [k] of v.ticks) {
      for (; fed < k; fed++) {
        const p = v.pitch[fed];
        if (p < 0) continue;
        const ts = v.ctx && v.ctx[fed] >= 0 ? v.ctx[fed] : (fed + 1 - L) * C;
        const h = { voiced: p > 0, pitch: p > 0 ? p : null, ts };
        gA.notePitchHint(h); gB.notePitchHint(h);
      }
      const peak = peakOk.get(k) ? 0.2 : 0;
      const a = decideMlWindow({ gate: gA, audioNowMs: (k + 1) * C, peak, lastGateMode: lastA, silenceTracker: silA });
      lastA = a.mode;
      const b = legacy(stB, gB, (k + 1) * C, peak);
      ticks++;
      if (a.score !== b.score || a.resetEma !== b.resetEma || a.voiceState !== b.voiceState || a.mode !== b.mode) setDiffs++;
      if (a.resetEma) emaA = null;
      if (b.resetEma) emaB = null;
      if (a.score) scored++;
      const lg = lgAt.get(k);
      if (a.score && lg !== undefined) {
        emaA = ema(emaA, 1 / (1 + Math.exp(-lg)), 0.2);
      }
      if (b.score && lg !== undefined) {
        emaB = ema(emaB, 1 / (1 + Math.exp(-lg)), 0.2);
        posted++;
        if (emaA !== emaB) setDiffs++;
      }
    }
  }
  console.log(`${set.padEnd(9)} ${String(vad.size).padStart(4)} streams ${String(ticks).padStart(7)} ticks ${String(scored).padStart(6)} scored ${String(posted).padStart(6)} posted scores compared   differences ${setDiffs}`);
  totalStreams += vad.size; totalTicks += ticks; totalScored += scored; totalPosted += posted; diffs += setDiffs;
}
console.log(`total: ${totalStreams} streams, ${totalTicks} ticks, ${totalScored} scored windows, ${totalPosted} posted scores — ${diffs} differences`);
process.exit(diffs === 0 ? 0 : 1);
