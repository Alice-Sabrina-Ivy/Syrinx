// perceived-voice-gate-replay.mjs — replays the perceived-voice chain's
// gate + EMA + meter display over recorded production-chain runs
// (measurements/perceived-voice-gate-2026-10-07.md).
//
// Input (--runs=<dir>), produced by the audit's chain replay — the real
// pitch worker + DSP worker + handleAnalysisResult over 16 kHz streams in
// 25 ms chunks — and its classifier scoring (deployed q8-v2 ONNX in
// onnxruntime):
//   vad_<set>.*.jsonl  { id, n, ticks: [[k, oldGateCode]], pitch: [Hz | 0 unvoiced
//                        | -1 no message, per chunk], gate: "0|1|2|9" per chunk }
//   sc_<set>.*.jsonl   { id, ks: [tick k], lg: [logit(female) - logit(male) | null] }
// Old gate codes: 0 = window peak below VAD_SILENCE_FLOOR; logits exist for
// every window the old gate scored (codes 1-3), a superset of what the new
// gate scores (checked: "missing logits" must print 0).
//
// Steps per clip, using the repo's modules:
//   pitch frames -> relayed hints (one chunk late, as the main thread does)
//   -> ml/utterance-gate.js decide() at the worker's 150 ms ticks
//   -> audio-utils ema (alpha 0.2, reset per resetEma) on sigmoid(logit)
//   -> posted scores + voice-state -> components/perceivedVoiceView.js
//      every 25 ms (before the meter's rAF tween).
//
//   node scripts/perceived-voice-gate-replay.mjs --runs=<dir> --set=<name>
//        [--variant=<name>] [--gate='<json options>'] [--fresh=<ms>] [--out=<dir>]
// Output: <out>/<set>.<variant>.jsonl  { id, ks, vc, sm, disp, stat }
//   vc: per tick 1 score, 0 silent, 4 pause, 5 warming, 6 sustained, 9 stale
//   disp: per hop the number on screen (-1 = none)
//   stat: per hop N number, L listening, U updating, S sustained

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { createUtteranceGate, meterStateForVerdict } from "../src/ml/utterance-gate.js";
import { perceivedVoiceView, SCORE_FRESH_MS } from "../src/components/perceivedVoiceView.js";
import { ema } from "../src/ml/audio-utils.js";

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const RUNS = arg("runs", "");
const SET = arg("set", "");
const VARIANT = arg("variant", "branch");
const GATE = JSON.parse(arg("gate", "{}"));
const FRESH = Number(arg("fresh", String(SCORE_FRESH_MS)));
const OUT = arg("out", "build/perceived-voice-gate");
if (!RUNS || !SET) { console.error("need --runs=<dir> and --set=<name>"); process.exit(2); }

const C = 25; // ms per chunk (400 samples @ 16 kHz)
const EMA_ALPHA = 0.2; // gender-worker EMA_ALPHA

function readJsonl(prefix) {
  const out = new Map();
  for (const f of readdirSync(RUNS)) {
    if (!f.startsWith(prefix) || !f.endsWith(".jsonl")) continue;
    for (const l of readFileSync(path.join(RUNS, f), "utf8").split("\n")) {
      if (!l.trim()) continue;
      const d = JSON.parse(l);
      out.set(d.id, d);
    }
  }
  return out;
}
const vad = readJsonl(`vad_${SET}.`);
const sc = readJsonl(`sc_${SET}.`);

const VCODE = { stale: 9, silent: 0, warming: 5, pause: 4, sustained: 6, score: 1 };
const SCODE = { listening: "L", updating: "U", sustained: "S", scoring: "N", loading: "X", error: "E" };
let missing = 0, scoredTotal = 0, staleTicks = 0;
const lines = [];
for (const [id, s] of sc) {
  const v = vad.get(id);
  if (!v) continue;
  const lgAt = new Map();
  s.ks.forEach((k, i) => { if (s.lg[i] !== null) lgAt.set(k, s.lg[i]); });
  const oldCode = new Map(v.ticks.map(([k, g]) => [k, g]));
  const gate = createUtteranceGate({ windowMs: 750, ...GATE });
  let fed = 0;
  let smoothed = null;
  const ks = [], vc = [], sm = [], posted = [], states = [];
  let state = null;
  for (const [k] of v.ticks) {
    // Pitch frames up to chunk k-1 have been relayed by the time chunk k
    // reaches the ML worker.
    for (; fed < k; fed++) {
      const p = v.pitch[fed];
      if (p < 0) continue;
      gate.notePitchHint({ voiced: p > 0, pitch: p > 0 ? p : null, ts: (fed + 1) * C });
    }
    const d = gate.decide((k + 1) * C);
    const peakOk = oldCode.get(k) !== 0;
    let st;
    let y = NaN;
    if (d.verdict === "stale") {
      staleTicks++;
      st = "listening";
    } else {
      const doScore = d.verdict === "score" && peakOk;
      if (d.resetEma) smoothed = null;
      st = d.verdict === "score" && !doScore ? "pause" : meterStateForVerdict(d.verdict);
      if (doScore) {
        const lg = lgAt.get(k);
        if (lg === undefined) missing++;
        else {
          scoredTotal++;
          smoothed = ema(smoothed, 1 / (1 + Math.exp(-lg)), EMA_ALPHA);
          y = Math.max(0, Math.min(100, smoothed * 100));
          posted.push([k, y]);
        }
      }
    }
    if (st !== state) { state = st; states.push([k, st]); }
    ks.push(k);
    vc.push(d.verdict === "score" && !peakOk ? 4 : VCODE[d.verdict]);
    sm.push(y);
  }
  const disp = new Array(v.n).fill(-1);
  let stat = "";
  let pi = 0, si = 0, newest = null, vs = null;
  for (let k = 0; k < v.n; k++) {
    while (pi < posted.length && posted[pi][0] <= k) { newest = { time: (posted[pi][0] + 1) * C, score: posted[pi][1] }; pi++; }
    while (si < states.length && states[si][0] <= k) { vs = { state: states[si][1], ts: (states[si][0] + 1) * C }; si++; }
    const g = v.gate[k];
    const r = perceivedVoiceView({
      now: (k + 1) * C, modelStatus: "ready",
      dspGate: { voiced: g === "2", holding: g === "1" },
      newest, voiceState: vs, freshMs: FRESH,
    });
    disp[k] = r.score === null ? -1 : Math.round(r.score * 10) / 10;
    stat += r.score !== null ? "N" : SCODE[r.status];
  }
  lines.push(JSON.stringify({ id, ks, vc, sm: sm.map((x) => (Number.isNaN(x) ? null : Math.round(x * 100) / 100)), disp, stat }));
}
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, `${SET}.${VARIANT}.jsonl`), lines.join("\n") + "\n");
console.log(`${SET} ${VARIANT}: ${lines.length} clips, ${scoredTotal} scored windows, ${missing} missing logits, ${staleTicks} stale ticks`);
process.exit(missing === 0 ? 0 : 1);
