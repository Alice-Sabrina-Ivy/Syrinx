// bridge-rate-check.mjs — does a display change measured on the 16 kHz real
// corpora transfer to a browser mic's 44.1 / 48 kHz stream? (2026-10-06,
// pitch-hold bridge rework: the bridge's voice evidence reads the DSP
// worker's CPP, and cpp.js resamples non-16 kHz input internally.)
// A subset of the public noise-only clips and voice-in-noise mixes is
// resampled (realdata.mjs resample, a band-limited polyphase up-sampler —
// the same audio, not a new recording) to each rate; the REAL pitch + DSP
// workers of --worker run once per stream and rate, and the REAL hook of
// --base and --cand is driven over the same frames (session-oracle
// lib/chain.mjs, DSP cpp / hnr / tilt included).
// Per rate: noise-only painted false voicing (clip mean) for both hooks;
// voice in noise (voice from the stream start, i.e. --lead=0) painted at
// pitch (8 %, display alignment, Praat truth of the voice layers) for both.
//
//   NOTCHVD_ROOT=<...>/build/notchvd node --import ./scripts/realnoise-fv/lib/register.mjs \
//     scripts/realnoise-fv/bridge-rate-check.mjs --worker=<src> --base=<src> --cand=<src>
//     [--rates=16000,44100,48000] [--noise-every=7] [--vin-every=11] [--snr=0] [--max-sec=60] [--shard=i/n] --out=F
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { dataRoot, noiseSet, publicMixes } from "./lib/sets.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
dataRoot(args);
const { loadIndex, readClip, loadF0, resample } = await import("../notch-adversarial/realdata/realdata.mjs");
const { loadSrc, runWorkers, buildFrames, driveHook } = await import("../session-oracle/lib/chain.mjs");

const S = await loadSrc(args.worker);
const hooks = { base: resolve(args.base, "audio/useAudioPipeline.js"), cand: resolve(args.cand, "audio/useAudioPipeline.js") };
const RATES = (args.rates ?? "16000,44100,48000").split(",").map(Number);
const MAXS = Number(args["max-sec"] ?? 60);
const SNR = Number(args.snr ?? 0);
const [shI, shN] = (args.shard ?? "0/1").split("/").map(Number);

const VOICE = new Map(loadIndex("voice", { noDup: false }).map((r) => [r.path, r]));
const f0Cache = new Map();
// Praat F0 of the voice layers on the mix timeline (vinscore.py truth)
function truthAt(rec, t) {
  for (const L of rec.spec.layers) {
    const v = VOICE.get(L.clip);
    if (!v || !v.f0_path) continue;
    if (!f0Cache.has(v.f0_path)) f0Cache.set(v.f0_path, loadF0(v)?.praat ?? null);
    const f = f0Cache.get(v.f0_path);
    if (!f || t < L.at || t > L.at + L.len) continue;
    const i = Math.round((t - L.at + (L.from ?? 0) - f.t0) / f.hop);
    return i >= 0 && i < f.f0.length ? f.f0[i] : 0;
  }
  return -1;
}

const noise = noiseSet(loadIndex).filter((_, i) => i % Number(args["noise-every"] ?? 7) === 0);
const vin = publicMixes(loadIndex, "voice_in_noise").filter((r) => r.snr_db === SNR)
  .filter((_, i) => i % Number(args["vin-every"] ?? 11) === 0);
const items = [...noise.map((r) => ({ kind: "noise", rec: r })), ...vin.map((r) => ({ kind: "vin", rec: r }))]
  .filter((_, i) => i % shN === shI);

const rows = [];
const t0 = Date.now();
for (const it of items) {
  let x = readClip(it.rec.path);
  let crop = 0;
  if (it.kind === "noise" && x.length > MAXS * 16000) x = x.subarray(0, MAXS * 16000);
  if (it.kind === "vin") { const c0 = Math.round(it.rec.voice_t0 * 16000); crop = c0 / 16000; x = x.subarray(c0); }
  const row = { id: it.rec.id, kind: it.kind, v: {} };
  for (const sr of RATES) {
    const y = resample(x, 16000, sr);
    const W = runWorkers(S, y, sr);
    const frames = buildFrames(W);
    const hop = W.C / W.sr;
    const cell = {};
    for (const [name, hookPath] of Object.entries(hooks)) {
      const D = await driveHook(hookPath, frames, W.n);
      if (it.kind === "noise") {
        let nd = 0, np = 0;
        for (let k = 0; k < W.n; k++) if (Number.isFinite(W.col.inten[k])) { nd++; if (D.paint[k] > 0) np++; }
        cell[name] = { fv: nd ? np / nd : 0 };
      } else {
        let n = 0, ok = 0;
        for (let k = 0; k < W.n; k++) {
          const tds = (k + 1) * hop - 0.040 - W.L * hop - 0.030;
          if (tds < 0 || (k + 1) * hop > W.n * hop - 0.3) continue;
          const td = tds + crop;
          if (td < it.rec.voice_t0 || td > it.rec.voice_t1) continue;
          const f = truthAt(it.rec, td);
          if (!(f > 0)) continue;
          n++;
          const p = Number.isFinite(W.col.inten[k]) ? D.paint[k] : 0;
          if (p > 0 && Math.abs(p / f - 1) < 0.08) ok++;
        }
        cell[name] = { ok, n };
      }
    }
    row.v[sr] = cell;
  }
  rows.push(row);
}
if (args.out) writeFileSync(args.out, JSON.stringify(rows));
console.log(`bridge-rate-check ${shI}/${shN}: ${rows.length} streams ${((Date.now() - t0) / 1000).toFixed(0)} s`);
