// chrome-level-compare.mjs — DSP intensity seen in Chrome (chrome-level-check.mjs
// snapshots, MSTP + AudioWorklet paths) vs the Node chain (the real DSP worker
// via scripts/session-oracle/lib/chain.mjs) on the same WAV.
// Chrome's fake microphone loops the file and the diag ring keeps the last
// 1200 frames (30 s), so the Node side is the file looped, scored over every
// 30 s window (1 s steps over one loop): reported as the one-loop value and
// the window range. Pass (§1): medians and p5 / p95 within 1 dB.
//
// Usage (repo root):
//   node --import ./scripts/session-oracle/lib/register.mjs scripts/quiet-floor/chrome-level-compare.mjs \
//        --wav=<path> [--dir=build/quiet-floor/chrome-check]
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadSrc, runWorkers } from "../session-oracle/lib/chain.mjs";
import { readWav } from "../session-oracle/lib/wav.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const DIR = resolve(args.dir ?? "build/quiet-floor/chrome-check");
const pct = (v, p) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const P = [0.05, 0.5, 0.95];

const { samples, sr } = readWav(resolve(args.wav));
const S = await loadSrc(args.src ?? "src");
const loops = 3;
const x = new Float32Array(samples.length * loops);
for (let i = 0; i < loops; i++) x.set(samples, i * samples.length);
const W = runWorkers(S, x, sr);
const hop = W.C / W.sr, perLoop = Math.floor(samples.length / W.C), win = 1200;
const inten = Array.from(W.col.inten);
const one = inten.slice(perLoop, 2 * perLoop);
const ref = P.map((p) => pct(one, p));
const range = P.map(() => [Infinity, -Infinity]);
for (let s = perLoop; s + win <= inten.length && s < 2 * perLoop; s += Math.round(1 / hop)) {
  const w = inten.slice(s, s + win);
  P.forEach((p, i) => { const v = pct(w, p); range[i][0] = Math.min(range[i][0], v); range[i][1] = Math.max(range[i][1], v); });
}
console.log(`Node chain (${sr} Hz): one loop p5/p50/p95 ${ref.map((v) => v.toFixed(2)).join(" / ")} dB; 30-s windows ` +
  range.map(([a, b]) => `${a.toFixed(2)}..${b.toFixed(2)}`).join(" / "));
let ok = true;
for (const kind of ["mstp", "audiocontext"]) {
  const j = JSON.parse(readFileSync(resolve(DIR, `${kind}.json`), "utf8"));
  const v = j.frames.map((f) => f.intensity);
  const c = P.map((p) => pct(v, p));
  const d = c.map((x, i) => x - ref[i]);
  const pass = d.every((x) => Math.abs(x) <= 1);
  ok &&= pass;
  console.log(`${kind.padEnd(12)} (${j.captureKind}, ${j.sampleRate} Hz, ${v.length} frames): p5/p50/p95 ${c.map((x) => x.toFixed(2)).join(" / ")} dB; ` +
    `minus Node ${d.map((x) => (x >= 0 ? "+" : "") + x.toFixed(2)).join(" / ")} -> ${pass ? "PASS" : "FAIL"} (|diff| <= 1 dB)`);
}
console.log(ok ? "level check PASS" : "level check FAIL");
