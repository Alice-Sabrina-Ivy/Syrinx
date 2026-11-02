// timing-drops.mjs — dose-response of CAPTURE LOSS (audio the MSTP reader
// drops when the main thread falls behind) on the resonance cue, in the Node
// chain (chain.mjs pitchPass + binsPass: real pitch worker + FireRedVAD,
// frozen clock, the resonance chain replay; gate on).
//
//   node scripts/resonance/mobile/timing-drops.mjs --set=set1 --pattern=synthetic:0.20:1 [--frame-ms=10]
//   node scripts/resonance/mobile/timing-drops.mjs --set=set1 --pattern=replay:build/resonance-mobile/timing/runs/thr6__set1.json
//        [--out=build/resonance-mobile/timing/drops]
//
// The stream is the timing WAV's 48 kHz audio (timing-wav.mjs) with pieces
// removed and the rest concatenated — what the workers receive after the
// capture reader dropped frames:
//   synthetic:<loss>:<seed>  gaps of whole frames (--frame-ms; the fake mic's
//                            10 ms, a phone's 40 ms) at random places, gap
//                            sizes drawn from the browser thr6 runs' measured
//                            gap sizes (in frames), rate set for the loss share
//   replay:<run.json>        exactly the audio a browser run received (its
//                            chunk log, aligned to the file by timing-analyze)
// contextTime: as in the browser, a chunk carries the FILE time of its last
// sample (MSTP timestamps jump over dropped frames), so the utterance gate sees
// the holes as time; the resonance engine never does (it counts its own
// samples). The pitch pass runs on the received audio with chain.mjs pitchPass
// (its contextTimes remapped afterwards: the worker only passes them through);
// the bins pass is binsPassCt below — chain.mjs binsPass (gate on, no relay
// delay, no worker check) with the chunks' contextTimes given.
// Posts are mapped back to file time through the kept-sample map, then scored
// with timing-analyze.mjs eventMetrics.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pitchPass, SR, CH } from "./chain.mjs";
import { pathToFileURL } from "node:url";
import { eventMetrics, analyze } from "./timing-analyze.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const SET = arg("set", "set1");
const PATTERN = arg("pattern", "synthetic:0:1");
const FRAME_MS = Number(arg("frame-ms", "10"));
const OUT = path.resolve(repo, arg("out", "build/resonance-mobile/timing/drops"));
mkdirSync(OUT, { recursive: true });
const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];
const b = readFileSync(path.join(repo, `build/resonance-mobile/timing/wav/${SET}.f32`));
const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
const man = JSON.parse(readFileSync(path.join(repo, `build/resonance-mobile/timing/wav/${SET}.json`), "utf8"));

function tagOf() { return PATTERN.startsWith("replay:") ? `replay-${path.basename(PATTERN, ".json")}` : `syn-${PATTERN.split(":")[1]}-s${PATTERN.split(":")[2]}-f${FRAME_MS}__${SET}`; }
// keep[i] intervals in file samples
let keep = [];
let label;
if (PATTERN.startsWith("synthetic:")) {
  const [, lossS, seedS] = PATTERN.split(":");
  const loss = Number(lossS);
  let seed = Number(seedS) >>> 0 || 1;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // gap sizes in 10 ms frames measured in the browser thr6 runs (p10 1, p50 2, p90 6, max 32 frames)
  const GAPS = [1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5, 6, 7, 9, 12, 18];
  const meanGap = GAPS.reduce((a, c) => a + c, 0) / GAPS.length;
  const F = Math.round((FRAME_MS / 1000) * SR);
  const nF = Math.floor(x.length / F);
  // start probability per frame so that loss share ≈ loss: p·meanGap / (1 + p·meanGap) = loss
  const p = loss > 0 ? loss / (meanGap * (1 - loss)) : 0;
  let f = 0, s = 0;
  while (f < nF) {
    if (loss > 0 && rnd() < p) {
      if (f > s) keep.push([s * F, f * F]);
      // FRAME_MS frames: gap length in frames of FRAME_MS (sizes drawn in 10 ms units, rounded up)
      const g = Math.max(1, Math.round((GAPS[Math.floor(rnd() * GAPS.length)] * 10) / FRAME_MS));
      f += g; s = f;
    } else f++;
  }
  if (nF > s) keep.push([s * F, Math.min(x.length, nF * F)]);
  label = `synthetic loss ${loss} seed ${seedS} frame ${FRAME_MS} ms`;
} else if (PATTERN.startsWith("replay:")) {
  const run = path.resolve(repo, PATTERN.slice(7));
  const A = analyze(run); // alignment ct0
  const J = JSON.parse(readFileSync(run, "utf8"));
  const ct0 = A.align.ct0;
  const capSr = J.log.diagAudio?.sampleRate ?? 48000;
  const c = J.log.chunks;
  for (let i = 0; i < c.length; i += 4) {
    const e = Math.round((c[i + 1] - ct0) * SR), s = e - Math.round((c[i + 3] / capSr) * SR);
    if (s < 0 || e > x.length) continue;
    const last = keep[keep.length - 1];
    if (last && Math.abs(last[1] - s) <= 2) last[1] = e; else keep.push([s, e]);
  }
  label = `replay ${path.basename(run)} (ct0 ${ct0})`;
} else throw new Error(`--pattern=${PATTERN}`);

const kept = keep.reduce((a, [s, e]) => a + (e - s), 0);
const y = new Float32Array(kept);
const fileOf = new Float64Array(kept + 1); // output sample -> file time (s) of that sample's end
let o = 0;
for (const [s, e] of keep) { y.set(x.subarray(s, e), o); for (let i = s; i < e; i++) fileOf[o++ + 1] = (i + 1) / SR; }
const lossShare = 1 - kept / Math.max(1, keep.length ? keep[keep.length - 1][1] - keep[0][0] : 1);
const t0 = Date.now();
const imp = (q) => import(pathToFileURL(path.join(repo, q)).href);
// chunk k's contextTime = file time of its last sample's end (+ a constant, irrelevant)
const nC = Math.ceil(y.length / CH);
const cts = Array.from({ length: nC }, (_, k) => fileOf[Math.min(y.length, (k + 1) * CH)]);
const cacheF = path.join(OUT, `pitch-${tagOf()}.json`);
let byChunk;
if (existsSync(cacheF)) byChunk = JSON.parse(readFileSync(cacheF, "utf8"));
else { byChunk = await pitchPass(y); writeFileSync(cacheF, JSON.stringify(byChunk)); }
// remap the posted contextTimes (chain ct = (k+1)·CH/SR) to the jumped clock
const byChunkCt = byChunk.map((list) => list.map((m) => [m[0], m[1], typeof m[2] === "number" ? cts[Math.round((m[2] * SR) / CH) - 1] : m[2], m[3]]));
async function binsPassCt(y, byChunk, cts) {
  const { createLabEngine } = await imp("src/resonance-lab/lab-engine.js");
  const { createNarrowbandDetector } = await imp("src/resonance/narrowband.js");
  const { createResonanceCue } = await imp("src/resonance/resonanceCue.js");
  const resDir = path.join(repo, "public/resonance-lab");
  const VTLN = JSON.parse(readFileSync(path.join(resDir, "vtln_warp.json"), "utf8"));
  const REF = JSON.parse(readFileSync(path.join(resDir, "reference.json"), "utf8"));
  const hint = (m) => ({ voiced: m[3] === 0 ? false : !!m[0], pitch: m[1], contextTime: m[2] }); // gate on
  const cue = createResonanceCue({ reference: REF });
  const nb = createNarrowbandDetector();
  const bins = [];
  const engine = createLabEngine({
    sampleRate: SR, models: { vtln: VTLN }, reference: REF, pitchSource: "frames", vtln: {},
    onStamped: (name, te, stampS, value) => { if (name !== "vtln") return; bins.push([te, stampS, value, cue.onStamped(te, stampS, value) ? 1 : 0]); },
    onGridFrame: (j, f0, ring16) => { if (!(f0 > 0)) return; const st = nb.frame((i) => ring16.at(i), Math.round((0.005 + 0.01 * j) * 16000)); cue.noteNarrowband(st.on); },
  });
  let sincePost = 0, lastVoiced = false;
  const posts = [];
  const relay = (list) => { for (const m of list) { const h = hint(m); if (typeof h.contextTime === "number" && Number.isFinite(h.contextTime)) { cue.notePitchHint(h); engine.pushPitchFrame(h.contextTime, h.voiced ? h.pitch : 0); } lastVoiced = h.voiced; } };
  for (let k = 0; k < byChunk.length; k++) {
    const x = y.slice(k * CH, Math.min(y.length, (k + 1) * CH));
    const ct = cts[k];
    cue.noteChunk(ct);
    engine.pushChunk(x, null, ct);
    sincePost += x.length / SR;
    if (sincePost >= 0.2) {
      sincePost = 0;
      const s = cue.snapshot();
      const pos = nb.state.decided;
      posts.push([k, bins.length, pos ? s.u : null, pos ? s.raw : null, pos ? s.uPlain : null, s.shownStartU, s.startU, s.fill, s.voicedS, VERD.indexOf(s.verdict), s.sinceResumeS, nb.state.on ? 1 : 0, pos ? 1 : 0, lastVoiced ? 1 : 0, 0]);
    }
    relay(byChunk[k]);
  }
  return { bins, posts };
}
const r = await binsPassCt(y, byChunkCt, cts);
const st = r.posts.map((p) => {
  const k = p[0];
  const outEnd = Math.min(y.length, (k + 1) * CH);
  return { ft: fileOf[outEnd], ct: fileOf[outEnd], u: p[2], verdict: VERD[p[9]], a: null };
});
const { ev, steady } = eventMetrics(st, man);
const nAdm = r.bins.filter((q) => q[3]).length;
const verdicts = {};
for (const s of st) verdicts[s.verdict] = (verdicts[s.verdict] ?? 0) + 1;
const tag = tagOf();
const res = {
  tag, set: SET, pattern: PATTERN, label, lossShare, keptS: kept / SR, gaps: keep.length - 1,
  bins: { admitted: nAdm, dropped: r.bins.length - nAdm }, verdicts, events: ev, steady,
  st: st.map((s) => [+s.ft.toFixed(3), s.u == null ? null : +s.u.toFixed(4), s.verdict]),
};
writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(res));
const lo = ev.filter((e) => e.kind === "long");
console.log(`${tag}: ${label}; lost ${(100 * lossShare).toFixed(1)} % in ${keep.length - 1} gaps; bins ${nAdm}+${r.bins.length - nAdm}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`  long T50 ${lo.map((e) => e.t50?.toFixed(2) ?? "nc").join(" ")}; sizes ${lo.map((e) => e.size?.toFixed(2)).join(" ")}; exc peaks ${ev.filter((e) => e.kind === "exc").map((e) => e.peak?.toFixed(2)).join(" ")}`);
process.exit(0);
