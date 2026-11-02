// level-rmswin.mjs — the voiced-frame RMS on the clean N controls with a 25 ms
// window (level-run.mjs levelQ) vs the 50 ms window of the app's diag inputRms
// (dsp-worker.js WINDOW_MS 50, ending at the hop), at the clean run's voiced hops.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath as toPath } from "node:url";
const SR = 48000;
const root = path.join(path.resolve(path.dirname(toPath(import.meta.url)), "../../.."), "build/resonance-mobile");
const L = JSON.parse(readFileSync(path.join(root, "streams/readers-dev.json"), "utf8"));
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); const i = (s.length - 1) * p, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const rd = (p) => { const b = readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
for (const r of L.readers) {
  const y = rd(r.variants.N), pc = JSON.parse(readFileSync(path.join(root, "runs/clean/pitch", `${r.id}__N.json`), "utf8"));
  const w = { 25: [], 50: [] };
  for (const c of pc.byChunk) for (const m of c) {
    if (!m[0]) continue;
    const e = Math.min(y.length, Math.round(m[2] * SR));
    for (const ms of [25, 50]) { const n = Math.round(ms * SR / 1000), b = e - n; if (b < 0) continue; let s = 0; for (let i = b; i < e; i++) s += y[i] * y[i]; w[ms].push(10 * Math.log10(s / n + 1e-20)); }
  }
  console.log(r.id, r.sex, ["q10", "q50", "q90"].map((k, i) => `${k} ${pct(w[25], [0.1, 0.5, 0.9][i]).toFixed(1)}/${pct(w[50], [0.1, 0.5, 0.9][i]).toFixed(1)}`).join("  "));
}
