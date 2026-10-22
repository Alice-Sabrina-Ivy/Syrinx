// noise-margin-eval.mjs — Voice Shaper's background-noise check (src/voice-preview/checks.js
// levelMargin) on public corpora: how often clean speech gets the notice and how often noisy
// speech does, for the floor at the 10th and the 5th percentile and several thresholds.
// measurements/voice-preview-phase1-2026-10-19.md, fix step (the review's "the noise notice can
// fire on clean continuous speech").
//
// Speech: PTDB-TUG (48 kHz) and FDA (20 kHz) from the gitignored tests/dsp/data corpora,
// resampled to 16 kHz with Voice Shaper's own resampleClip (noise-synth's rate):
//   whole     the corpus file as recorded (pauses before / after the sentence), first 8 s
//   trimmed   cut to the speech (first to last 20 ms frame within 30 dB of the loudest), first
//             8 s, kept when at least 3 s long: continuous speech, the worst case for the floor
// Noise (scripts/noise-synth.js, seeded): pink noise at +10 / +20 dB SNR and fan hum 20 dB below
// the speech (mix(): SNR against the speech's active RMS).
// Every margin is checked against checks.js levelMargin (which uses the 5th percentile).
//
//   node scripts/voice-preview/noise-margin-eval.mjs [--corpora=<path to corpora.js>]
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { levelMargin } from "../../src/voice-preview/checks.js";
import { resampleClip } from "../../src/voice-preview/engine/preview.js";
import { pink, fanHum, mix, SR } from "../noise-synth.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const CORPORA = arg("corpora", path.join(repo, "tests/dsp/data/corpora.js"));
const { loadPtdbTug, loadFda } = await import(pathToFileURL(path.resolve(CORPORA)).href);

function energies(x, sr) {
  const n = Math.round(sr * 0.02), m = Math.floor(x.length / n), e = [];
  for (let i = 0; i < m; i++) { let s = 0; for (let j = i * n; j < (i + 1) * n; j++) s += x[j] * x[j]; e.push(10 * Math.log10(s / n + 1e-20)); }
  return e;
}
function trimSpeech(x, sr) {
  const n = Math.round(sr * 0.02), e = energies(x, sr), mx = Math.max(...e);
  const a = e.findIndex((v) => v > mx - 30), b = e.length - 1 - [...e].reverse().findIndex((v) => v > mx - 30);
  return x.subarray(a * n, (b + 1) * n);
}
function margins(x, sr) {
  const e = energies(x, sr).sort((a, b) => a - b);
  const q = (p) => { const h = (e.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h); return e[lo] + (e[hi] - e[lo]) * (h - lo); };
  return { p10: q(0.95) - q(0.1), p5: q(0.95) - q(0.05) };
}
const sets = {};
const add = (k, x) => {
  const m = margins(x, SR);
  if (Math.abs(levelMargin(x, SR).margin - m.p5) > 1e-9) throw new Error("checks.js levelMargin is not the 95th - 5th percentile margin");
  (sets[k] ??= []).push(m);
};
let files = 0;
for (const [name, load] of [["PTDB-TUG", loadPtdbTug], ["FDA", loadFda]]) {
  for (const r of load()) {
    files++;
    const x = resampleClip(r.samples, r.sampleRate, SR);
    const x8 = x.subarray(0, Math.min(x.length, 8 * SR));
    if (x.length >= 3 * SR) {
      add(`${name} whole, clean`, x8);
      add(`${name} whole, pink +20 dB`, mix(x8, pink(x8.length), 20).mixed);
      add(`${name} whole, pink +10 dB`, mix(x8, pink(x8.length), 10).mixed);
    }
    const t = trimSpeech(x, SR);
    if (t.length < 3 * SR) continue;
    const t8 = t.subarray(0, Math.min(t.length, 8 * SR));
    add(`${name} trimmed, clean`, t8);
    add(`${name} trimmed, pink +20 dB`, mix(t8, pink(t8.length), 20).mixed);
    add(`${name} trimmed, pink +10 dB`, mix(t8, pink(t8.length), 10).mixed);
    add(`${name} trimmed, fan hum -20 dB`, mix(t8, fanHum(t8.length), 20).mixed);
  }
}
if (!files) { console.error(`no corpus files found through ${CORPORA} (PTDB-TUG / FDA are gitignored; pass --corpora=<checkout with tests/dsp/data>/tests/dsp/data/corpora.js)`); process.exit(2); }

const RULES = [["p10", 30], ["p10", 27], ["p5", 30], ["p5", 28], ["p5", 26]];
const f1 = (v) => v.toFixed(1);
console.log(`| Set | n | 95th-10th: min / median / max dB | 95th-5th: min / median / max dB | ${RULES.map(([p, t]) => `flagged ${p === "p10" ? "10th" : "5th"} < ${t}`).join(" | ")} |`);
console.log(`|---|---|---|---|${RULES.map(() => "---").join("|")}|`);
for (const [k, ms] of Object.entries(sets)) {
  const a = ms.map((m) => m.p10).sort((x, y) => x - y), b = ms.map((m) => m.p5).sort((x, y) => x - y);
  const med = (s) => s[Math.floor(s.length / 2)];
  console.log(`| ${k} | ${ms.length} | ${f1(a[0])} / ${f1(med(a))} / ${f1(a.at(-1))} | ${f1(b[0])} / ${f1(med(b))} / ${f1(b.at(-1))} | ${RULES.map(([p, t]) => ms.filter((m) => m[p] < t).length).join(" | ")} |`);
}
