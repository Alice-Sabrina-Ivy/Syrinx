// make-listen-hi.mjs — the listening addition at 32 and 48 kHz (§ Addition 2026-10-12, A8, of
// measurements/voice-preview-spike-2026-10-12.md): four WAVs for the user, written OUTSIDE the
// repository (never committed), next to the ten from make-listen.mjs.
//
//   node scripts/voice-preview/listen/make-listen-hi.mjs --out=<folder> [--clipset=timing-speech]
//
// The same man (M01) and woman (F01) clips as make-listen.mjs (PTDB-TUG, 5 s, 48 kHz,
// speech-dense by default). Per clip: WORLD (WebAssembly, SIMD build, front end F-S = the real
// pitch worker's posted track) unchanged rebuild (0 st, x1.00) at 32 and 48 kHz. At 48 kHz the
// 48 kHz clip is analysed as it is (no resampling). Renders are RMS-matched and peak-limited
// (lib/psola.js finish, as the engine returns them); 10 ms linear fades; 16-bit PCM WAV at the
// render's rate. Files 11-14; writes manifest-hi.json (sources, settings, sha256 of each WAV).
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
const RATES = [32000, 48000];

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
const plan = [{ who: "M01", label: "man" }, { who: "F01", label: "woman" }];
const manifest = { clipset, frontEnd: "S", build: "simd", setting: { st: 0, a: 1 }, files: [] };
let k = 10;
for (const p of plan) {
  const e = idx.clips.find((c) => c.name === p.who).lengths["5"];
  const x = readF32(path.join(P.clips, clipset, e.pcm));
  const posted = readF32(path.join(P.clips, clipset, e.posted));
  for (const rate of RATES) {
    const pv = new Preview({ engine: "world", world, lab: null });
    pv.analyse(x, 48000, { rate, frontEnd: "S", posted, framePeriod: 5, first: { st: 0, a: 1 } });
    const y = pv.render(0, 1).pcm;
    pv.free();
    const name = `${++k}-${p.label}-unchanged-${rate / 1000}k.wav`;
    const b = wav16(fades(y, rate), rate);
    writeFileSync(path.join(OUT, name), b);
    manifest.files.push({ file: name, rate, seconds: y.length / rate, what: `${p.who} WORLD unchanged rebuild, ${rate / 1000} kHz`, sha256: createHash("sha256").update(b).digest("hex") });
  }
}
writeFileSync(path.join(OUT, "manifest-hi.json"), JSON.stringify(manifest, null, 1));
console.log(manifest.files.map((f) => `${f.file}  ${f.seconds.toFixed(2)} s`).join("\n"));
