// make-listen.mjs — the listening set (§P9 of measurements/voice-preview-spike-2026-10-12.md):
// ten WAVs for the user, written OUTSIDE the repository (never committed).
//
//   node scripts/voice-preview/listen/make-listen.mjs --out=<folder> [--clipset=timing-speech]
//
// Clips: PTDB-TUG M01 and F01 at 5 s (48 kHz). --clipset=timing-speech (default) uses the
// speech-dense variant (prep_speech_clips.py); the pre-registered timing clips start with
// about 2.5 s of silence. Per clip: the 48 kHz original, then WORLD (WebAssembly, SIMD build,
// front end F-S = the real pitch worker's posted track) at 16 and 24 kHz: the unchanged
// rebuild (0 st, x1.00) and one small step (M01 +2 st / x1.03, F01 -2 st / x0.97).
// Renders are RMS-matched to the input and peak-limited (lib/psola.js finish, as the
// engine returns them); every file gets 10 ms linear fades and is written as 16-bit PCM WAV
// at its own rate. Also writes manifest.json (sources, settings, sha256 of each WAV).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { P } from "../lib/paths.mjs";
import { loadWorldNode, readF32 } from "../lib/node-io.mjs";
import { Preview } from "../lib/preview-core.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
if (!args.out) throw new Error("--out=<folder outside the repository>");
const clipset = args.clipset || "timing-speech";
const OUT = path.resolve(args.out);
mkdirSync(OUT, { recursive: true });

function wav16(x, sr) {
  const n = x.length, buf = Buffer.alloc(44 + 2 * n);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + 2 * n, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(2 * n, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))), 44 + 2 * i);
  return buf;
}
function fades(x, sr) {
  const y = Float32Array.from(x), f = Math.round(0.01 * sr);
  for (let i = 0; i < f && i < y.length; i++) { const g = i / f; y[i] *= g; y[y.length - 1 - i] *= g; }
  return y;
}

const world = await loadWorldNode("simd");
const idx = JSON.parse(readFileSync(path.join(P.clips, clipset, "index.json"), "utf8"));
const plan = [
  { who: "M01", step: [2, 1.03], label: "man" },
  { who: "F01", step: [-2, 0.97], label: "woman" },
];
const manifest = { clipset, frontEnd: "S", build: "simd", files: [] };
let k = 0;
const put = (name, x, sr, what) => {
  const b = wav16(fades(x, sr), sr);
  writeFileSync(path.join(OUT, name), b);
  manifest.files.push({ file: name, rate: sr, seconds: x.length / sr, what, sha256: createHash("sha256").update(b).digest("hex") });
};
for (const p of plan) {
  const c = idx.clips.find((e) => e.name === p.who);
  const e = c.lengths["5"];
  const x = readF32(path.join(P.clips, clipset, e.pcm));
  const posted = readF32(path.join(P.clips, clipset, e.posted));
  put(`${String(++k).padStart(2, "0")}-${p.label}-original-48k.wav`, x, 48000, `${p.who} original, 48 kHz`);
  const renders = {};
  for (const rate of [16000, 24000]) {
    const pv = new Preview({ engine: "world", world, lab: null });
    pv.analyse(x, 48000, { rate, frontEnd: "S", posted, framePeriod: 5, first: { st: 0, a: 1 } });
    renders[rate] = { same: pv.render(0, 1).pcm, step: pv.render(p.step[0], p.step[1]).pcm };
    pv.free();
  }
  const st = `${p.step[0] > 0 ? "+" : ""}${p.step[0]}st-x${p.step[1].toFixed(2)}`;
  put(`${String(++k).padStart(2, "0")}-${p.label}-unchanged-16k.wav`, renders[16000].same, 16000, `${p.who} WORLD unchanged rebuild, 16 kHz`);
  put(`${String(++k).padStart(2, "0")}-${p.label}-unchanged-24k.wav`, renders[24000].same, 24000, `${p.who} WORLD unchanged rebuild, 24 kHz`);
  put(`${String(++k).padStart(2, "0")}-${p.label}-${st}-16k.wav`, renders[16000].step, 16000, `${p.who} WORLD ${st}, 16 kHz`);
  put(`${String(++k).padStart(2, "0")}-${p.label}-${st}-24k.wav`, renders[24000].step, 24000, `${p.who} WORLD ${st}, 24 kHz`);
}
writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1));
console.log(manifest.files.map((f) => `${f.file}  ${f.seconds.toFixed(2)} s`).join("\n"));
