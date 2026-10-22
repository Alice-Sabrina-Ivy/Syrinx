// replay-qf.mjs — replay an in-app `?diag=1` snapshot through the REAL hook
// (handleAnalysisResult) of the baseline and of each quiet-floor candidate's
// gate (measurements/pitch-quiet-floor-2026-10-20.md §4). Each snapshot frame
// is one DSP frame: its DSP intensity, and the pitch / confidence of the
// latest pitch message the app had at that moment (recorded by the app with
// the frame); the message's post time (`ts`, for the staleness rule) is the
// latest pitchInferences entry at or before the frame. Worker-side changes
// (G·F's guard floor) cannot be replayed without audio, so only the gate
// trees are driven; a G·F candidate is judged here on its gate part.
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/quiet-floor/replay-qf.mjs \
//        --snap=PATH --out=JSON [--trees=build/trees] [--cands=g60,g65,g70,g75]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSrc, driveHook } from "../session-oracle/lib/chain.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const TREES = resolve(args.trees ?? "build/trees");
const CANDS = ["base", ...(args.cands ?? "g60,g65,g70,g75").split(",")];
const j = JSON.parse(readFileSync(resolve(args.snap), "utf8"));
const snap = j.snapshot ?? j;
const inf = snap.pitchInferences.map((p) => p.tEpochMs).sort((a, b) => a - b);
let ii = -1;
const frames = snap.frames.map((f, k) => {
  while (ii + 1 < inf.length && inf[ii + 1] <= f.tEpochMs) ii++;
  return { k, now: f.tEpochMs, intensity: typeof f.intensity === "number" ? f.intensity : -Infinity,
    pitch: f.pitch ?? null, confidence: f.confidence ?? null, ts: ii >= 0 ? inf[ii] : 0 };
});
const n = frames.length;
const res = { frames: n, captureKind: snap.audio?.captureKind, sampleRate: snap.audio?.sampleRate,
  postedAtFrames: 100 * frames.filter((f) => f.pitch !== null).length / n };
for (const c of CANDS) {
  const S = await loadSrc(resolve(TREES, `qf-${c}/src`));
  const D = await driveHook(S.hookPath, frames, n);
  let painted = 0, ro = 0, rec = 0;
  for (let k = 0; k < n; k++) { painted += D.paint[k] > 0; ro += D.ro[k] > 0; rec += D.rec[k] > 0; }
  res[c] = { painted: 100 * painted / n, ro: 100 * ro / n, rec: 100 * rec / n };
  if (c !== "base") res[c].paintDrop = 100 * (1 - res[c].painted / res.base.painted);
  console.log(`${c.padEnd(5)} painted ${res[c].painted.toFixed(1).padStart(5)} %  readout ${res[c].ro.toFixed(1).padStart(5)} %  recorded ${res[c].rec.toFixed(1).padStart(5)} %` +
    (c !== "base" ? `  painted drop ${res[c].paintDrop.toFixed(1)} %` : ""));
}
console.log(`${n} frames (${res.captureKind}, ${res.sampleRate} Hz); frames with a posted pitch ${res.postedAtFrames.toFixed(1)} %`);
writeFileSync(resolve(args.out), JSON.stringify(res, null, 1));
