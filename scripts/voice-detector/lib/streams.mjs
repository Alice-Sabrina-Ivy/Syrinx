// streams.mjs — JS twin of streams.py (voice-detector benchmark, 2026-10-06):
// list the benchmark's streams and read EXACTLY the samples the app's
// production chain received, in place. For a JS / WASM candidate.
//
//   import { listStreams, loadAudio, writeProbs } from "./scripts/voice-detector/lib/streams.mjs";
//   for (const meta of listStreams("build/vad", ["noise", "fda"])) {
//     const { samples, sr } = loadAudio(meta);
//     const p = new Float32Array(...);              // one probability per frame
//     writeProbs("build/vad/cand/<name>", meta, p);
//   }
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { readWav } from "../../notch-adversarial/realdata/realdata.mjs";

export const SETS = ["noise", "noiseho", "vin20", "vin0", "fda", "ptdb", "voc", "hil", "vocalset", "pvqd", "voiced"];

export function listStreams(root, sets = SETS) {
  const out = [];
  for (const s of sets) {
    const d = resolve(root, "dumps", s);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((x) => x.endsWith(".json")).sort()) out.push(JSON.parse(readFileSync(join(d, f), "utf8")));
  }
  return out;
}

export function loadAudio(meta) {
  const a = meta.audio;
  let x;
  if (a.fmt === "sig16be") {
    const b = readFileSync(a.path);
    x = new Float32Array(b.length >> 1);
    for (let i = 0; i < x.length; i++) x[i] = b.readInt16BE(i * 2) / 32768;
  } else {
    const w = readWav(a.path);
    if (w.sampleRate !== a.sr) throw new Error(`${a.path}: ${w.sampleRate} Hz, manifest says ${a.sr}`);
    x = w.samples;
  }
  if (x.length < a.start + a.len) throw new Error(`${a.path}: shorter than the stream`);
  return { samples: x.subarray(a.start, a.start + a.len), sr: a.sr };
}

// one float32 probability per frame of the candidate's stated grid
export function writeProbs(candDir, meta, probs) {
  const d = resolve(candDir, meta.set);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${meta.id}.f32`), Buffer.from(Float32Array.from(probs).buffer));
}
