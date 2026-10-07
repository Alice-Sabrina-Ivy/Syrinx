// replay.mjs — replays the perceived-voice gate + EMA + meter display over
// recorded production-chain runs (measurements/perceived-voice-gate-2026-10-07.md).
//
// Inputs (build/perceived-voice-gate/runs/, or --runs=<dir>):
//   vad_<set>.*.jsonl  chain.mjs: { id, n, ticks: [[k, oldGateCode]], pitch: [Hz | 0
//                      unvoiced | -1 no message, per chunk], ctx: [frame capture ms | -1],
//                      gate: "0|1|2|9" per chunk }
//   sc_<set>.*.jsonl   score.py: { id, ks: [tick k], lg: [logit(female) - logit(male) | null] }
// Logits exist for every window the retired gate scored, a superset of what the current
// gate scores (checked: the run fails on a missing logit). Sets without sc_ files
// (the held-phonation adversarial sets) replay verdicts only: every scored tick posts 50.
//
// Steps per stream, using the app's modules:
//   pitch frames -> hints on the AUDIO clock (ts = the frame's capture time; the hint
//   posted at chunk k describes frame k - 2, and reaches the ML worker one chunk later,
//   as relayed by the main thread) -> ml/utterance-gate.js decide(now = the newest
//   chunk's capture time) at the worker's 150 ms ticks -> audio-utils ema (alpha 0.2,
//   reset per resetEma) on sigmoid(logit) -> posted scores + voice-state ->
//   components/perceivedVoiceView.js every 25 ms (before the meter's rAF tween).
//   --clock=post stamps hints with their posting chunk instead (the pre-review
//   behaviour: wall-clock decode time, which at an even 25 ms cadence is that).
//
//   node scripts/perceived-voice-gate/replay.mjs --set=<name> [--variant=<name>]
//        [--gate='<json options>'] [--fresh=<ms>] [--clock=audio|post] [--runs=<dir>] [--out=<dir>]
// Output: <out>/<set>.<variant>.jsonl  { id, ks, vc, sm, disp, stat }
//   vc: per tick 1 score, 0 silent, 4 pause, 5 warming, 6 sustained, 9 stale
//   disp: per hop the number on screen (-1 = none)
//   stat: per hop N number, L listening, U updating, S sustained

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createUtteranceGate, meterStateForVerdict } from "../../src/ml/utterance-gate.js";
import { perceivedVoiceView, SCORE_FRESH_MS } from "../../src/components/perceivedVoiceView.js";
import { ema } from "../../src/ml/audio-utils.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = process.env.SYRINX_PVG_OUT ?? path.join(REPO, "build", "perceived-voice-gate");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const RUNS = arg("runs", path.join(BASE, "runs"));
const SET = arg("set", "");
const VARIANT = arg("variant", "branch");
const GATE = JSON.parse(arg("gate", "{}"));
const FRESH = Number(arg("fresh", String(SCORE_FRESH_MS)));
const CLOCK = arg("clock", "audio");
const OUT = arg("out", path.join(BASE, "replay"));
if (!SET) { console.error("need --set=<name>"); process.exit(2); }

const C = 25;           // ms per chunk (400 samples @ 16 kHz)
const L = 2;            // pitch-worker decode delay (frames)
const EMA_ALPHA = 0.2;  // gender-worker EMA_ALPHA

function readJsonl(prefix) {
  const out = new Map();
  if (!existsSync(RUNS)) return out;
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
const DUMMY = sc.size === 0;

const VCODE = { stale: 9, silent: 0, warming: 5, pause: 4, sustained: 6, score: 1 };
const SCODE = { listening: "L", updating: "U", sustained: "S", scoring: "N", loading: "X", error: "E" };
let missing = 0, scoredTotal = 0, staleTicks = 0;
const lines = [];
for (const [id, v] of vad) {
  const s = DUMMY ? null : sc.get(id);
  if (!DUMMY && !s) continue;
  const lgAt = new Map();
  if (s) s.ks.forEach((k, i) => { if (s.lg[i] !== null) lgAt.set(k, s.lg[i]); });
  const oldCode = new Map(v.ticks.map(([k, g]) => [k, g]));
  const gate = createUtteranceGate({ windowMs: 750, ...GATE });
  let fed = 0;
  let smoothed = null;
  const ks = [], vc = [], sm = [], posted = [], states = [];
  let state = null;
  for (const [k] of v.ticks) {
    // Pitch messages posted up to chunk k-1 have been relayed by the time
    // chunk k reaches the ML worker.
    for (; fed < k; fed++) {
      const p = v.pitch[fed];
      if (p < 0) continue;
      const ts = CLOCK === "post" ? (fed + 1) * C
        : v.ctx && v.ctx[fed] >= 0 ? v.ctx[fed] : (fed + 1 - L) * C;
      gate.notePitchHint({ voiced: p > 0, pitch: p > 0 ? p : null, ts });
    }
    const d = gate.decide((k + 1) * C);
    const peakOk = oldCode.get(k) !== 0;   // window peak >= VAD_SILENCE_FLOOR
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
        const lg = DUMMY ? 0 : lgAt.get(k);
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
console.log(`${SET} ${VARIANT}: ${lines.length} streams, ${scoredTotal} scored windows${DUMMY ? " (verdicts only, no logits)" : ""}, ${missing} missing logits, ${staleTicks} stale ticks`);
process.exit(missing === 0 ? 0 : 1);
