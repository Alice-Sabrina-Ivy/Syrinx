// hook-check.mjs — real-hook check of the steadiness readout wiring.
//
// Runs the REAL pitch + DSP workers over a WAV (session or any file), then
//   (1) drives the REAL useAudioPipeline hook with every pitch message
//       through handlePitchMessage + every DSP frame through
//       handleAnalysisResult (chainlib.mjs driveHookMessages), recording
//       state.steadiness / state.steadinessHeld per display hop;
//   (2) runs the pure steadiness module over the same messages and checks
//       the hook's state equals the module's read() after the latest
//       message, bit for bit;
//   (3) checks the display readout column (`ro`) equals the session
//       oracle's own driveHook() — i.e. moving the pitch-message handler
//       into handlePitchMessage changed nothing on the display path;
//   (4) checks the posted series equals the committed attr dump (if one is
//       given), so the offline scoring (sim.mjs) used the same values.
// Writes the hook's per-hop steadiness to <out>/<name>.f32 [value x n, held x n].
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/steadiness/hook-check.mjs \
//        --session=2026-05-26 [--max-seconds=N] [--src=src] [--attr=build/session-oracle/attr/base]
//        [--out=build/steady/hook]
//   ... --wav=PATH --name=NAME
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { readWav } from "../session-oracle/lib/wav.mjs";
import { loadSrc, runWorkers, buildFrames, driveHook } from "../session-oracle/lib/chain.mjs";
import { driveHookMessages, loadSteadiness } from "./chainlib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? "1"]; }));
const SRC = args.src ?? "src";
const name = args.name ?? args.session;
const wav = args.wav ?? `${args["sessions-root"] ?? "C:/Coding Projects/private-session/sessions"}/${args.session}/session.wav`;
const OUT = resolve(args.out ?? "build/steady/hook");
const S = await loadSrc(SRC);
const mod = await loadSteadiness(SRC);

let { samples, sr } = readWav(wav);
const maxSec = Number(args["max-seconds"] ?? 0);
if (maxSec > 0) samples = samples.subarray(0, Math.round(maxSec * sr));
const t0 = Date.now();
const W = runWorkers(S, samples, sr);
const H = await driveHookMessages(S.hookPath, W);
const D = await driveHook(S.hookPath, buildFrames(W), W.n);

// (2) module over the same messages; the hook state at display hop k
// reflects every message posted at or before chunk k.
const tr = mod.createSteadinessTracker();
let mi = 0, mismatch = 0, compared = 0, reported = 0, heldN = 0, first = null;
let cur = { value: null, held: false };
const msgChunk = []; for (let k = 0; k < W.n; k++) if (!Number.isNaN(W.msgPitch[k])) msgChunk.push(k);
for (let k = 0; k < W.n; k++) {
  while (mi < msgChunk.length && msgChunk[mi] <= k) { const m = H.msgs[mi]; tr.push(m.pitch, m.contextTime); cur = tr.read(); mi++; }
  if (Number.isNaN(W.col.inten[k])) continue;
  compared++;
  const hv = Number.isNaN(H.steady[k]) ? null : H.steady[k];
  const mv = cur.value === null ? null : Math.fround(cur.value);
  const ok = hv === mv && (hv === null || H.held[k] === (cur.held ? 1 : 0));
  if (!ok) { mismatch++; if (first === null) first = { k, hook: hv, held: H.held[k], module: mv, mheld: cur.held }; }
  if (hv !== null) { reported++; if (H.held[k]) heldN++; }
}
// (3) display readout identical to the oracle's driveHook
let roDiff = 0; for (let k = 0; k < W.n; k++) if (H.ro[k] !== D.ro[k]) roDiff++;
// (4) posted values vs the attr dump
let dumpDiff = null;
const attr = resolve(args.attr ?? "build/session-oracle/attr/base", "sessions");
if (!maxSec && existsSync(resolve(attr, `${name}.json`))) {
  const m = JSON.parse(readFileSync(resolve(attr, `${name}.json`), "utf8"));
  const a = new Float32Array(readFileSync(resolve(attr, `${name}.f32`)).buffer.slice(0));
  const ci = m.cols.indexOf("post");
  dumpDiff = 0;
  for (let k = 0; k < Math.min(m.n, W.n); k++) if (a[ci * m.n + k] !== W.col.post[k]) dumpDiff++;
}
mkdirSync(OUT, { recursive: true });
const buf = new Float32Array(2 * W.n); buf.set(H.steady); buf.set(Float32Array.from(H.held), W.n);
writeFileSync(resolve(OUT, `${name}.f32`), Buffer.from(buf.buffer));
const res = { name, hops: W.n, compared, mismatch, first, reportedPct: 100 * reported / compared, heldPct: 100 * heldN / compared, roDiff, dumpDiff, seconds: (Date.now() - t0) / 1000 };
writeFileSync(resolve(OUT, `${name}.json`), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res));
if (mismatch || roDiff || dumpDiff) process.exit(1);
