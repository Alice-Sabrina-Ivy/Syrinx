// hum-run.mjs — the hum and noise tests (§P7 of measurements/voice-preview-spike-2026-10-12.md),
// Node side, on the real modules of this branch's src/:
//   - the real pitch chain (scripts/session-oracle/lib/chain.mjs runWorkers: real pitch worker +
//     DSP worker) on every condition clip and every render: posted pitch per 25 ms hop
//   - the renders: WORLD (WebAssembly, SIMD build) and PSOLA through the Worker's engine
//     (lib/preview-core.js) with the selected front end F-S (the condition clip's own posted
//     track, recording only), at (0, 1.00), (+2, 1.03), (-2, 0.97), (+6, 1.12), (-6, 0.88)
//   - d1, the tonal-noise detector: createNoiseNotch(16000) from src/dsp/noise-notch.js
//     (defaults), fed 400-sample (25 ms) chunks as the pitch worker feeds it; 48 kHz clips go
//     through the pitch worker's own resampler (src/ml/audio-utils.js createStreamingResampler)
//     in 1200-sample chunks first. "rec" = the recording alone; "live" = after the condition's
//     10 s pre-roll of the hum or noise alone. Flag = any active notch line during the recording.
//   - d2, the level check: margin = 95th - 10th percentile of 20 ms frame energies (dB)
// and, after all renders, the resonance lab's VTLN meter (scripts/resonance-lab/node/lab_live.mjs,
// 16 kHz renders and condition clips).
//
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/voice-preview/hum/hum-run.mjs [--only=name,...] [--no-vtln]
//        [--index=index-tonal.json] [--track=rec|live] [--preSec=10]
//
// Inputs: VP_CACHE/hum/clips (make_conditions.py; make_tonal_conditions.mjs for index-tonal.json),
// clips/proto16 (ls_f2), clips/timing (5 s), clips/timing-speech (5 s, extra clean set).
// Outputs under VP_CACHE/hum: post/, renders/, detect.json, vtln.jsonl (the pre-registered run:
// --index=index.json --track=rec). Any other index or track is a labelled addition (review,
// 2026-10-12) and writes detect-<tag>.json and vtln-<tag>.jsonl, tag = <index name>-<track>
// (e.g. tonal-rec, tonal-live10), so the pre-registered outputs are never overwritten:
//   --index   which condition list to run (default index.json, the pre-registered §P7 set)
//   --track   rec  = the F-S track from the real pitch chain on the recording alone (§P7, worst case)
//             live = the chain first hears --preSec seconds of the condition's pre-roll (the hum
//                    or noise alone, as if the app had been listening before the recording); the
//                    posted track of the recording part is then used (a mitigation test: by then
//                    the notch and its ghost veto may be active). Renders go to renders/<engine>-<track>,
//                    posted tracks to post/orig-<track> and post/<engine>-<track>.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO } from "../lib/paths.mjs";
import { loadWorldNode, readF32, writeArr } from "../lib/node-io.mjs";
import { Preview } from "../lib/preview-core.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const only = args.only ? new Set(args.only.split(",")) : null;
const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { loadSrc, runWorkers } = await imp("scripts/session-oracle/lib/chain.mjs");
const { createNoiseNotch } = await imp("src/dsp/noise-notch.js");
const { createStreamingResampler } = await imp("src/ml/audio-utils.js");
const S = await loadSrc(path.join(REPO, "src"));
const world = await loadWorldNode("simd");
const H = P.hum;
const INDEX = args.index || "index.json";
const TRACK = args.track || "rec";
const PRE_SEC = Number(args.preSec || 10);
if (!["rec", "live"].includes(TRACK)) throw new Error("--track=rec|live");
const PREREG = INDEX === "index.json" && TRACK === "rec";
const TAG = PREREG ? "" : `${INDEX.replace(/^index-?/, "").replace(/\.json$/, "") || "prereg"}-${TRACK}${TRACK === "live" ? PRE_SEC : ""}`;
const SUF = TRACK === "rec" ? "" : `-${TRACK}${PRE_SEC}`; // folder suffix: renders/<engine><SUF>, post/orig<SUF>
const idx = JSON.parse(readFileSync(path.join(H, "clips", INDEX), "utf8"));
const CELLS = [[0, 1.0], [2, 1.03], [-2, 0.97], [6, 1.12], [-6, 0.88]];
const cellName = (s, a) => `p${s >= 0 ? "+" : "-"}${Math.abs(s)}_a${a.toFixed(2)}`;
const t00 = Date.now();
const mk = (...p) => { const d = path.join(...p); mkdirSync(d, { recursive: true }); return d; };

/** d1: the tonal-noise notch over pre-roll + recording; returns flag, first promotion and lines. */
function notchRun(pre, x, sr) {
  const notch = createNoiseNotch(16000);
  const rs = sr === 16000 ? null : createStreamingResampler(sr, 16000);
  const C = Math.round(sr * 0.025);
  const out = { flagged: false, firstActiveSec: null, activeAtEnd: [], maxLines: 0, activeChunkShare: 0 };
  let recChunks = 0, activeChunks = 0;
  const feed = (sig, isRec) => {
    for (let k = 0; k < sig.length; k += C) {
      let ch = Float32Array.from(sig.subarray(k, Math.min(sig.length, k + C)));
      if (rs) ch = rs(ch);
      notch.process(ch);
      const n = notch.activeFreqs().length;
      if (isRec) {
        recChunks++;
        if (n > 0) {
          activeChunks++;
          out.flagged = true;
          if (out.firstActiveSec === null) out.firstActiveSec = k / sr;
        }
        out.maxLines = Math.max(out.maxLines, n);
      } else if (n > 0 && out.firstActiveSec === null) {
        out.firstActiveSec = -(pre.length - k) / sr; // promoted during the pre-roll
      }
    }
  };
  if (pre) feed(pre, false);
  feed(x, true);
  out.activeAtEnd = notch.activeFreqs();
  out.activeChunkShare = recChunks ? activeChunks / recChunks : 0;
  return out;
}

/** d2: 95th - 10th percentile of 20 ms frame energies, dB. */
function levelMargin(x, sr) {
  const n = Math.round(sr * 0.02), m = Math.floor(x.length / n);
  const e = [];
  for (let i = 0; i < m; i++) {
    let s = 0;
    for (let j = i * n; j < (i + 1) * n; j++) s += x[j] * x[j];
    e.push(10 * Math.log10(s / n + 1e-20));
  }
  e.sort((a, b) => a - b);
  const q = (p) => { const h = (e.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h); return e[lo] + (e[hi] - e[lo]) * (h - lo); };
  return { p95: q(0.95), p10: q(0.1), margin: q(0.95) - q(0.1) };
}

const detect = {};
const vtlnJobs = [];
for (const c of idx.clips) {
  if (only && !only.has(c.name)) continue;
  const x = readF32(path.join(H, "clips", `${c.name}.f32`));
  const prePath = path.join(H, "clips", `${c.name}.pre.f32`);
  const pre = existsSync(prePath) ? readF32(prePath) : null;
  let W0 = runWorkers(S, x, c.sr);
  let post0 = Float32Array.from(W0.col.post);
  if (TRACK === "live") {
    // the chain hears the last PRE_SEC s of the pre-roll, then the recording; keep the recording's hops
    const npre = Math.round(PRE_SEC * c.sr);
    if (npre % Math.round(c.sr * 0.025)) throw new Error("pre-roll must be a whole number of 25 ms chunks");
    const pr = pre ? pre.subarray(pre.length - npre) : new Float32Array(npre);
    const xx = new Float32Array(npre + x.length);
    xx.set(pr, 0);
    xx.set(x, npre);
    const WL = runWorkers(S, xx, c.sr);
    const k0 = npre / Math.round(c.sr * 0.025);
    const live = Float32Array.from(WL.col.post.subarray(k0, k0 + post0.length));
    if (live.length !== post0.length) throw new Error(`live track ${live.length} hops vs ${post0.length}`);
    post0 = live;
    W0 = { col: { nnotch: WL.col.nnotch.subarray(k0, k0 + post0.length) } };
  }
  writeArr(path.join(mk(H, "post", `orig${SUF}`), `${c.name}.f32`), post0);
  const rate = c.sr === 48000 ? 24000 : 16000;
  if (c.sr === 16000) vtlnJobs.push({ key: `orig/${c.name}/orig`, audio: path.join(H, "clips", `${c.name}.f32`) });
  for (const engine of ["world", "psola"]) {
    const pv = new Preview({ engine, world, lab: null });
    pv.analyse(x, c.sr, { rate, frontEnd: "S", posted: post0, framePeriod: 5, first: { st: 0, a: 1 } });
    const rd = mk(H, "renders", `${engine}${SUF}`, c.name), pd = mk(H, "post", `${engine}${SUF}`, c.name);
    for (const [st, a] of CELLS) {
      const y = pv.render(st, a).pcm;
      writeArr(path.join(rd, `${cellName(st, a)}.f32`), y);
      writeArr(path.join(pd, `${cellName(st, a)}.f32`), Float32Array.from(runWorkers(S, y, rate).col.post));
      if (rate === 16000) vtlnJobs.push({ key: `${engine}/${c.name}/${cellName(st, a)}`, audio: path.join(rd, `${cellName(st, a)}.f32`) });
    }
    pv.free();
  }
  detect[c.name] = {
    ...c, renderRate: rate,
    d1rec: notchRun(null, x, c.sr), d1live: pre ? notchRun(pre, x, c.sr) : null, d2: levelMargin(x, c.sr),
    workerNotchShare: W0.col.nnotch.reduce((s, v) => s + (v > 0 ? 1 : 0), 0) / W0.col.nnotch.length,
  };
  console.log(`${c.name}: d1 rec ${detect[c.name].d1rec.flagged} live ${detect[c.name].d1live?.flagged ?? "-"}, ` +
    `d2 margin ${detect[c.name].d2.margin.toFixed(1)} dB (${((Date.now() - t00) / 1000).toFixed(0)} s)`);
}

// the clean set for false flags: ls_f2 (16 kHz), the 4 timing clips at 5 s (48 kHz, pre-registered),
// and the speech-dense 5 s variant (extra)
const clean = [{ name: "ls_f2", file: path.join(P.clips, "proto16", "ls_f2.f32"), sr: 16000, set: "proto16" }];
for (const set of ["timing", "timing-speech"]) {
  const ti = JSON.parse(readFileSync(path.join(P.clips, set, "index.json"), "utf8"));
  for (const t of ti.clips) clean.push({ name: `${set}/${t.name}_5s`, file: path.join(P.clips, set, t.lengths["5"].pcm), sr: 48000, set });
}
const cleanDetect = {};
for (const c of clean) {
  const x = readF32(c.file);
  cleanDetect[c.name] = { set: c.set, d1rec: notchRun(null, x, c.sr), d1live: notchRun(new Float32Array(10 * c.sr), x, c.sr), d2: levelMargin(x, c.sr) };
}
const outPath = path.join(H, PREREG ? "detect.json" : `detect-${TAG}.json`);
const prev = only && existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : { conditions: {} };
writeFileSync(outPath, JSON.stringify({ cells: CELLS, index: INDEX, track: TRACK, preSec: TRACK === "live" ? PRE_SEC : null, conditions: { ...prev.conditions, ...detect }, clean: cleanDetect }, null, 1));

if (!("no-vtln" in args) && vtlnJobs.length) {
  // lab_live.mjs overwrites its output file: with --only, only the listed conditions' readings remain
  const jp = path.join(H, PREREG ? "vtln.jobs.json" : `vtln-${TAG}.jobs.json`);
  writeFileSync(jp, JSON.stringify(vtlnJobs));
  const r = spawnSync(process.execPath, [path.join(REPO, "scripts/resonance-lab/node/lab_live.mjs"), jp, path.join(H, PREREG ? "vtln.jsonl" : `vtln-${TAG}.jsonl`), "vtln"], { stdio: "inherit" });
  if (r.status !== 0) throw new Error(`lab_live.mjs failed (${r.status})`);
}
console.log(`done, ${((Date.now() - t00) / 1000).toFixed(0)} s`);
