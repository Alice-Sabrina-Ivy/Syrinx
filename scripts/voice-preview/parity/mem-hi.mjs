// mem-hi.mjs — CheapTrick FFT size and WebAssembly memory per rate (§ Addition 2026-10-12, A4, of
// measurements/voice-preview-spike-2026-10-12.md), in Node.
//   FFT size  the module's own rule (vp_cheaptrick_fft_size, f0 floor 71 Hz) at each rate; D4C's
//             internal FFT size 2^(1 + floor(log2(4 fs / 47 + 1))) from WORLD's d4c.cpp, for scale
//   memory    WebAssembly memory (bytes of the module's linear memory) after analysing a clip with
//             the gate configuration (WORLD SIMD, F-S, 5 ms frames, first render at +2 st / x1.03),
//             a fresh module instance per (rate, length, clip set, clip); the largest over the 4
//             clips is reported. 44 100 Hz uses the 44.1 kHz clip copies (no resampling, A3).
//   node scripts/voice-preview/parity/mem-hi.mjs [--rates=16000,22050,24000,32000,44100,48000] [--json=FILE]
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { P } from "../lib/paths.mjs";
import { loadWorldNode, readF32 } from "../lib/node-io.mjs";
import { Preview } from "../lib/preview-core.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const RATES = (args.rates || "16000,22050,24000,32000,44100,48000").split(",").map(Number);
const d4cFft = (fs) => 2 ** (1 + Math.floor(Math.log2(4 * fs / 47 + 1)));
const out = { rates: {} };
for (const rate of RATES) {
  const w0 = await loadWorldNode("simd");
  const r = { cheaptrickFft: w0.fftSize(rate), d4cFft: d4cFft(rate), memMB: {} };
  for (const set of ["timing", "timing-speech"]) {
    const dir = rate === 44100 ? `${set}-44k` : set;
    const idx = JSON.parse(readFileSync(path.join(P.clips, dir, "index.json"), "utf8"));
    for (const L of ["5", "8"]) {
      let worst = 0;
      for (const c of idx.clips) {
        const e = c.lengths[L];
        const world = await loadWorldNode("simd"); // a fresh instance: memory only grows
        const pv = new Preview({ engine: "world", world, lab: null });
        pv.analyse(readF32(path.join(P.clips, dir, e.pcm)), c.sr, { rate, frontEnd: "S", posted: readF32(path.join(P.clips, dir, e.posted)), framePeriod: 5, first: { st: 2, a: 1.03 } });
        worst = Math.max(worst, pv.memoryBytes());
        pv.free();
      }
      r.memMB[`${set} ${L} s`] = worst / 1048576;
    }
  }
  out.rates[rate] = r;
  console.log(`${rate}: CheapTrick FFT ${r.cheaptrickFft}, D4C FFT ${r.d4cFft}, WebAssembly memory ${Object.entries(r.memMB).map(([k, v]) => `${k} ${v.toFixed(0)} MB`).join(", ")}`);
}
if (args.json) writeFileSync(args.json, JSON.stringify(out, null, 1));
