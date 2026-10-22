// Replays the voice-direction branch's REAL utterance gate (src/ml/utterance-gate.js; the calibration ran it from
// origin/voice-direction 852b5cc) over the measured items, to compare the
// meter pooling the calibration was fitted with (lab gate: a 0.75 s window ending every 0.15 s
// is scored when >= 1 voiced 10 ms frame lies in the trailing 0.5 s) with the live gate.
// Hints: the production-replica 10 ms grid sampled every 25 ms (one per pitch frame), stamped on
// the audio clock; at a decision time t only hints with ts <= t - 115 ms are known (L=2 decode
// delay + one-chunk relay). Output: per item, lab-gate mean logit, live-gate mean logit, counts.
//   node gate_replay.mjs <out.jsonl> <result.jsonl>
import { readFileSync, writeFileSync } from "node:fs";
import { createUtteranceGate } from "../../../src/ml/utterance-gate.js";
const [inp, outp] = process.argv.slice(2);
const lines = readFileSync(inp, "utf8").split("\n").filter(Boolean);
const out = [];
for (const line of lines) {
  const r = JSON.parse(line);
  const g = r.grid;
  const dur = g.length * 10;
  const hints = [];
  for (let ts = 5; ts < dur; ts += 25) {
    const j = Math.round((ts - 5) / 10);
    const f = g[Math.min(j, g.length - 1)];
    hints.push({ ts, voiced: f > 0, pitch: f > 0 ? f : null });
  }
  const gate = createUtteranceGate();
  let hi = 0;
  const live = [], lab = [], verdicts = {};
  for (const [k, te, raw, logit] of r.win) lab.push(logit);
  // decide at every 150 ms tick k (window end te = 0.15 k s), like the worker
  const winByK = new Map(r.win.map((w) => [w[0], w[3]]));
  const kmax = Math.floor((dur / 1000) / 0.15) + 1;
  for (let k = 1; k <= kmax; k++) {
    const now = k * 150;
    while (hi < hints.length && hints[hi].ts <= now - 115) gate.notePitchHint(hints[hi++]);
    const d = gate.decide(now);
    verdicts[d.verdict] = (verdicts[d.verdict] || 0) + 1;
    if (d.verdict === "score" && winByK.has(k)) live.push(winByK.get(k));
    else if (d.verdict === "score") verdicts.score_unmeasured = (verdicts.score_unmeasured || 0) + 1;
  }
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  out.push(JSON.stringify({ key: r.key, lab: mean(lab), labN: lab.length, live: mean(live), liveN: live.length, verdicts }));
}
writeFileSync(outp, out.join("\n") + "\n");
console.log("items", out.length);
