// level-offset.mjs — the G·F guard floor's frame level against the DSP
// intensity (measurements/pitch-quiet-floor-2026-10-20.md §2: "its offset
// against DSP intensity on the corpora is reported"). Frame level = 20·log10
// RMS of the last 800 samples of the pitch worker's 16 kHz stream at a chunk
// end (the pitch worker's streaming resampler; the tonal notch is left out —
// it does not engage on these clean files); DSP intensity = the real DSP
// worker's value for the same chunk (lib/chain.mjs). Reported over hops whose
// DSP intensity is above −70 dB, per corpus (dev files, natural level).
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/quiet-floor/level-offset.mjs [--src=build/trees/qf-base/src]
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { loadSrc, runWorkers } from "../session-oracle/lib/chain.mjs";
import { readWav } from "../session-oracle/lib/wav.mjs";
import { loadFda, loadPtdbTug, loadVocadito, loadHillenbrand } from "../../tests/dsp/data/corpora.js";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const SRC = resolve(args.src ?? "build/trees/qf-base/src");
const S = await loadSrc(SRC);
const { createStreamingResampler } = await import(pathToFileURL(resolve(SRC, "ml/audio-utils.js")).href);
const pct = (v, p) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const libri = () => {
  const dir = resolve("build/quiet-floor/libri");
  return JSON.parse(readFileSync(resolve(dir, "index.json"), "utf8")).filter((it) => it.split === "dev-clean").slice(0, 30)
    .map((it) => { const { samples, sr } = readWav(resolve(dir, it.wav)); return { samples, sampleRate: sr }; });
};
const sets = { fda: () => loadFda().filter((_, i) => i % 4 === 0), ptdb: () => loadPtdbTug().filter((_, i) => i % 6 === 0),
  hil: () => loadHillenbrand().filter((_, i) => i % 20 === 0), voc: () => loadVocadito().filter((_, i) => i % 5 === 0), libri };
for (const [name, load] of Object.entries(sets)) {
  const d = [];
  for (const tr of load()) {
    const W = runWorkers(S, tr.samples, tr.sampleRate);
    const rs = createStreamingResampler(tr.sampleRate, 16000);
    const C = W.C; let buf = new Float32Array(0);
    for (let k = 0; k < W.n; k++) {
      const y = rs(Float32Array.from(tr.samples.subarray(k * C, (k + 1) * C)));
      const nb = new Float32Array(Math.min(1280, buf.length + y.length));
      const all = new Float32Array(buf.length + y.length); all.set(buf); all.set(y, buf.length);
      nb.set(all.subarray(all.length - nb.length)); buf = nb;
      if (buf.length < 800 || !(W.col.inten[k] > -70)) continue;
      let e = 0; for (let i = buf.length - 800; i < buf.length; i++) e += buf[i] * buf[i];
      if (e > 0) d.push(10 * Math.log10(e / 800) - W.col.inten[k]);
    }
  }
  console.log(`${name.padEnd(6)} hops ${String(d.length).padStart(6)}: frame level − DSP intensity p5 / median / p95 = ${[0.05, 0.5, 0.95].map((p) => pct(d, p).toFixed(2)).join(" / ")} dB`);
}
