// run.mjs — session oracle runner: drives the REAL pitch worker, DSP worker
// and main-thread display decision (lib/chain.mjs) over the private session
// WAVs (or any WAV) and saves the per-hop decoded / posted / painted /
// readout series for analyze.py.
//
// Usage (from the repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/run.mjs \
//        [--src=src] [--tag=head] [--out=build/session-oracle/runs]
//        [--sessions=2025-09-08,2026-05-07,2026-05-26,2026-06-09]
//        [--sessions-root=DIR]          default $SYRINX_SESSIONS_DIR (the private
//                                       session recordings; see CLAUDE.md)
//        [--wav=PATH --name=NAME]       ad-hoc file instead of sessions
//        [--refs=build/session-oracle/refs]  enables the alice-only display
//                                       pass (needs <refs>/<session>.spk.json
//                                       from build_refs.py)
//        [--max-seconds=N]
//        [--voice-gate]                 the voice gate (2026-10-21,
//                                       lib/voice-gate.mjs): the pitch worker
//                                       runs the real FireRedVAD model and the
//                                       hook is driven twice from the same
//                                       worker run — gate on -> <tag>/, gate
//                                       off -> <tag>-gateoff/. Needs the
//                                       local model copy (node
//                                       scripts/fetch-firered-model.mjs)
// Output: <out>/<tag>/<name>.hops.f32 (Float32, column-major; columns in
// <name>.meta.json) — DET_COLS + DISP_COLS of lib/chain.mjs, plus
// paintA / roA / styleA / brkA (alice-only display pass; brkA since
// 2026-10-04) when --refs is given, plus vadv (the detector decision each
// display hop consumed) with --voice-gate.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { readWav } from "./lib/wav.mjs";
import { resolve } from "node:path";
import { loadSrc, runWorkers, buildFrames, driveHook, tenthPercentile, DET_COLS, DISP_COLS } from "./lib/chain.mjs";
import { loadVoiceGate, runWorkersVad, buildFramesVad, maskCheck } from "./lib/voice-gate.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const SRC = args.src ?? "src";
const TAG = args.tag ?? "head";
const OUT = resolve(args.out ?? "build/session-oracle/runs", TAG);
const ROOT = args["sessions-root"] ?? process.env.SYRINX_SESSIONS_DIR;
const REFS = args.refs ? resolve(args.refs) : null;
const MAXSEC = Number(args["max-seconds"] ?? 0);
const SESSIONS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"];
const VOICE_GATE = !!args["voice-gate"];

// Alice-only display mask: keep display hop k iff the reference frame at its
// CONTENT time (window centre of the consumed message's frame,
// (k+1)*chunk - L*chunk - 40 ms) is labelled alice in the session-label parquet.
function aliceMask(W, spk) {
  const m = new Uint8Array(W.n), hop = W.C / W.sr;
  for (let k = 0; k < W.n; k++) {
    const t = (k + 1) * hop - W.L * hop - 0.040;
    const i = Math.round((t - spk.t0) / spk.dt);
    if (i >= 0 && i < spk.spk.length && spk.spk[i] === 1) m[k] = 1;
  }
  return m;
}

// One display pass (main + alice-only) written to `dir`; `build(opts)`
// makes the frames (opts: the alice-only mask).
async function writePass(S, W, name, wavPath, dir, build, extraMeta = {}) {
  const D = await driveHook(S.hookPath, build({}), W.n);
  const cols = { ...W.col, ...D };
  const names = [...DET_COLS, ...DISP_COLS];
  if (REFS && existsSync(resolve(REFS, `${name}.spk.json`))) {
    const spk = JSON.parse(readFileSync(resolve(REFS, `${name}.spk.json`), "utf8"));
    const DA = await driveHook(S.hookPath, build({ mask: aliceMask(W, spk), floorDb: tenthPercentile(W.col.inten) }), W.n);
    cols.paintA = DA.paint; cols.roA = DA.ro; cols.styleA = DA.style; cols.brkA = DA.brk;
    names.push("paintA", "roA", "styleA", "brkA");
  }
  if (VOICE_GATE) names.push("vadv");
  mkdirSync(dir, { recursive: true });
  const tbl = new Float32Array(W.n * names.length);
  names.forEach((c, i) => tbl.set(cols[c], i * W.n));
  writeFileSync(resolve(dir, `${name}.hops.f32`), Buffer.from(tbl.buffer));
  writeFileSync(resolve(dir, `${name}.meta.json`), JSON.stringify({
    name, wav: wavPath, src: resolve(SRC), nHops: W.n, hop: W.C, sr: W.sr, hopS: W.C / W.sr, lookback: W.L,
    cols: names, cpu: W.cpu, tap: process.env.SO_TAP !== "0", ...extraMeta,
    conventions: "detection cols indexed by the chunk completing the analysis frame (centre = chunk end - 40 ms); display cols indexed by display hop k consuming the message describing frame k-L",
  }, null, 1));
  return D;
}

async function runOne(S, VG, name, wavPath) {
  let { samples, sr } = readWav(wavPath);
  if (MAXSEC > 0) samples = samples.subarray(0, MAXSEC * sr);
  const t0 = Date.now();
  const W = VOICE_GATE ? await runWorkersVad(S, VG, samples, sr) : runWorkers(S, samples, sr);
  const t1 = Date.now();
  let D;
  if (VOICE_GATE) {
    D = await writePass(S, W, name, wavPath, OUT, (o) => buildFramesVad(W, { ...o, gate: true }), { voiceGate: true, vadStats: W.stats });
    const U = await writePass(S, W, name, wavPath, `${OUT}-gateoff`, (o) => buildFramesVad(W, { ...o, gate: false }), { voiceGate: false, vadStats: W.stats });
    const chk = maskCheck(D, U);
    if (chk.bad) console.log(`WARNING ${name}: ${chk.bad} hops where the gate-on painted value differs from gate off`);
    const s = W.stats;
    console.log(`${name}: detector voice ${s.voice} / no voice ${s.novoice} / none ${s.none} messages, late ${s.late}; the gate hid ${chk.hid} painted hops`);
  } else {
    D = await writePass(S, W, name, wavPath, OUT, (o) => buildFrames(W, o));
  }
  const t2 = Date.now();
  let np = 0; for (const x of D.paint) np += x > 0;
  const cpu = Number.isFinite(W.cpu.pitchMsPerChunk) ? `, pitch worker ${W.cpu.pitchMsPerChunk.toFixed(3)} ms/chunk` : "";
  console.log(`${name}: ${W.n} hops, painted ${(100 * np / W.n).toFixed(1)}%${cpu}; workers ${(t1 - t0) / 1000}s, hook ${(t2 - t1) / 1000}s -> ${OUT}${VOICE_GATE ? ` (+ ${OUT}-gateoff)` : ""}`);
}

const S = await loadSrc(SRC);
const VG = VOICE_GATE ? await loadVoiceGate(S) : null;
if (args.wav) await runOne(S, VG, args.name ?? "file", args.wav);
else {
  if (!ROOT) throw new Error("set SYRINX_SESSIONS_DIR to the folder holding the private session recordings (see CLAUDE.md)");
  for (const s of (args.sessions ?? SESSIONS.join(",")).split(",")) await runOne(S, VG, s, `${ROOT}/${s}/session.wav`);
}
// --voice-gate: the detector's ONNX session keeps the event loop alive.
if (VOICE_GATE) process.exit(0);
