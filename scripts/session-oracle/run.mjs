// run.mjs — session oracle runner: drives the REAL pitch worker, DSP worker
// and main-thread display decision (lib/chain.mjs) over private-session session
// WAVs (or any WAV) and saves the per-hop decoded / posted / painted /
// readout series for analyze.py.
//
// Usage (from the repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/session-oracle/run.mjs \
//        [--src=src] [--tag=head] [--out=build/session-oracle/runs]
//        [--sessions=2025-09-08,2026-05-07,2026-05-26,2026-06-09]
//        [--sessions-root="C:/Coding Projects/private-session/sessions"]
//        [--wav=PATH --name=NAME]       ad-hoc file instead of sessions
//        [--refs=build/session-oracle/refs]  enables the alice-only display
//                                       pass (needs <refs>/<session>.spk.json
//                                       from build_refs.py)
//        [--max-seconds=N]
// Output: <out>/<tag>/<name>.hops.f32 (Float32, column-major; columns in
// <name>.meta.json) — DET_COLS + DISP_COLS of lib/chain.mjs, plus
// paintA / roA / styleA / brkA (alice-only display pass; brkA since
// 2026-10-04) when --refs is given.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { readWav } from "./lib/wav.mjs";
import { resolve } from "node:path";
import { loadSrc, runWorkers, buildFrames, driveHook, tenthPercentile, DET_COLS, DISP_COLS } from "./lib/chain.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const SRC = args.src ?? "src";
const TAG = args.tag ?? "head";
const OUT = resolve(args.out ?? "build/session-oracle/runs", TAG);
const ROOT = args["sessions-root"] ?? "C:/Coding Projects/private-session/sessions";
const REFS = args.refs ? resolve(args.refs) : null;
const MAXSEC = Number(args["max-seconds"] ?? 0);
const SESSIONS = ["2025-09-08", "2026-05-07", "2026-05-26", "2026-06-09"];

// Alice-only display mask: keep display hop k iff the reference frame at its
// CONTENT time (window centre of the consumed message's frame,
// (k+1)*chunk - L*chunk - 40 ms) is labelled alice in the private-session parquet.
function aliceMask(W, spk) {
  const m = new Uint8Array(W.n), hop = W.C / W.sr;
  for (let k = 0; k < W.n; k++) {
    const t = (k + 1) * hop - W.L * hop - 0.040;
    const i = Math.round((t - spk.t0) / spk.dt);
    if (i >= 0 && i < spk.spk.length && spk.spk[i] === 1) m[k] = 1;
  }
  return m;
}

async function runOne(S, name, wavPath) {
  let { samples, sr } = readWav(wavPath);
  if (MAXSEC > 0) samples = samples.subarray(0, MAXSEC * sr);
  const t0 = Date.now();
  const W = runWorkers(S, samples, sr);
  const t1 = Date.now();
  const D = await driveHook(S.hookPath, buildFrames(W), W.n);
  const cols = { ...W.col, ...D };
  const names = [...DET_COLS, ...DISP_COLS];
  if (REFS && existsSync(resolve(REFS, `${name}.spk.json`))) {
    const spk = JSON.parse(readFileSync(resolve(REFS, `${name}.spk.json`), "utf8"));
    const DA = await driveHook(S.hookPath, buildFrames(W, { mask: aliceMask(W, spk), floorDb: tenthPercentile(W.col.inten) }), W.n);
    cols.paintA = DA.paint; cols.roA = DA.ro; cols.styleA = DA.style; cols.brkA = DA.brk;
    names.push("paintA", "roA", "styleA", "brkA");
  }
  const t2 = Date.now();
  mkdirSync(OUT, { recursive: true });
  const tbl = new Float32Array(W.n * names.length);
  names.forEach((c, i) => tbl.set(cols[c], i * W.n));
  writeFileSync(resolve(OUT, `${name}.hops.f32`), Buffer.from(tbl.buffer));
  writeFileSync(resolve(OUT, `${name}.meta.json`), JSON.stringify({
    name, wav: wavPath, src: resolve(SRC), nHops: W.n, hop: W.C, sr: W.sr, hopS: W.C / W.sr, lookback: W.L,
    cols: names, cpu: W.cpu, tap: process.env.SO_TAP !== "0",
    conventions: "detection cols indexed by the chunk completing the analysis frame (centre = chunk end - 40 ms); display cols indexed by display hop k consuming the message describing frame k-L",
  }, null, 1));
  let np = 0; for (const x of D.paint) np += x > 0;
  console.log(`${name}: ${W.n} hops, painted ${(100 * np / W.n).toFixed(1)}%, pitch worker ${W.cpu.pitchMsPerChunk.toFixed(3)} ms/chunk; workers ${(t1 - t0) / 1000}s, hook ${(t2 - t1) / 1000}s -> ${OUT}`);
}

const S = await loadSrc(SRC);
if (args.wav) await runOne(S, args.name ?? "file", args.wav);
else for (const s of (args.sessions ?? SESSIONS.join(",")).split(",")) await runOne(S, s, `${ROOT}/${s}/session.wav`);
