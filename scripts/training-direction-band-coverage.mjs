// training-direction-band-coverage.mjs — how often a speaker reads "on
// target" under each training direction's pitch band, judged per frame vs
// on the running pitch level (src/utils/pitchLevel.js) the app uses
// (measurements/training-direction-targets-2026-10-07.md).
//
//   node scripts/training-direction-band-coverage.mjs [--corpora=<path to tests/dsp/data/corpora.js>]
//        [--pvg=<build/perceived-voice-gate dir>]
//
// Speakers (public data only):
//   - PTDB-TUG + FDA laryngograph reference F0 (tests/dsp/data, gitignored;
//     --corpora points at a checkout that has them), utterances joined
//     with 2 s gaps, on a 25 ms grid;
//   - the painted pitch trace of the real chain (perceived-voice-gate
//     chain.mjs runs): LibriSpeech clean (set chan) and PVQD sentence
//     portions (set pv, orig), when --pvg has them.
// Per speaker: the share of voiced frames whose value (per frame) or level
// (running median over W ms) is in its own band (women: feminine, men:
// masculine) or on target there (in, or beyond in the direction of
// travel), and — recentred so the speaker's median sits at the band's
// geometric centre — the share in each band. Then candidate androgynous
// widths for equal coverage.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pitchLevels } from "../src/utils/pitchLevel.js";
import { PITCH_TARGETS, pitchStatus, isOnTarget } from "../src/utils/trainingDirection.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const CORPORA = arg("corpora", path.join(REPO, "tests/dsp/data/corpora.js"));
const PVG = arg("pvg", process.env.SYRINX_PVG_OUT ?? path.join(REPO, "build/perceived-voice-gate"));
const WINS = [0, 1000, 1500, 2000, 3000];
const st = (f) => 12 * Math.log2(f / 100);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (x) => (100 * x).toFixed(1).padStart(5);

const speakers = [];
const { loadPtdbTug, loadFda } = await import(pathToFileURL(CORPORA).href);
const bySpk = new Map();
for (const t of [...loadPtdbTug(), ...loadFda()]) {
  const k = t.corpus + ":" + (t.trackId.match(/^(?:mic_)?([FM]\d+|rl|sb)/i)?.[1] ?? t.trackId);
  if (!bySpk.has(k)) bySpk.set(k, { key: k, src: "ref:" + t.corpus, sex: t.gender, frames: [], t0: 0 });
  const s = bySpk.get(k);
  const durMs = t.ref.f0.length * t.ref.hopMs;
  for (let ms = 0; ms < durMs; ms += 25) {
    const v = t.ref.f0[Math.round(ms / t.ref.hopMs)] ?? 0;
    s.frames.push({ t: s.t0 + ms, hz: v > 0 ? v : null });
  }
  s.t0 += durMs + 2000;
}
speakers.push(...bySpk.values());

function chainSet(set, keep, src) {
  const metaPath = path.join(PVG, "sets", `meta_${set}.json`);
  const vadPath = path.join(PVG, "runs", `vad_${set}.0.jsonl`);
  if (!existsSync(metaPath) || !existsSync(vadPath)) { console.log(`(no ${set} chain runs under ${PVG} — skipped)`); return; }
  const meta = new Map(JSON.parse(readFileSync(metaPath, "utf8")).map((r) => [r.id, r]));
  for (const l of readFileSync(vadPath, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const v = JSON.parse(l);
    const m = meta.get(v.id);
    if (!m || !keep(m)) continue;
    speakers.push({ key: v.id, src, sex: m.sex, frames: v.paint.map((p, k) => ({ t: (k + 1) * 25, hz: p > 0 ? p : null })) });
  }
}
chainSet("chan", (m) => m.cond === "clean", "chain:librispeech");
chainSet("pv", (m) => m.var === "orig", "chain:pvqd");

const ANDRO = [[145, 175], [140, 180], [138, 184], [135, 188], [130, 195]];
const rows = [];
for (const s of speakers) {
  const voiced = s.frames.filter((f) => f.hz !== null).map((f) => f.hz);
  if (voiced.length < 100) continue;
  const medSt = median(voiced.map(st));
  const r = { src: s.src, sex: s.sex, medHz: 100 * 2 ** (medSt / 12) };
  const own = s.sex === "f" ? PITCH_TARGETS.feminine : PITCH_TARGETS.masculine;
  for (const W of WINS) {
    const lv = (W === 0 ? s.frames.map((f) => f.hz) : pitchLevels(s.frames, (f) => f.t, (f) => f.hz, W)).filter((x) => x !== null);
    r[`own_${W}`] = lv.filter((x) => pitchStatus(x, own) === "in").length / lv.length;
    r[`on_${W}`] = lv.filter((x) => isOnTarget(pitchStatus(x, own))).length / lv.length;
    for (const [name, t] of Object.entries(PITCH_TARGETS)) {
      const f = 2 ** (((st(t.low) + st(t.high)) / 2 - medSt) / 12);
      r[`ctr_${name}_${W}`] = lv.filter((x) => pitchStatus(x * f, t) === "in").length / lv.length;
    }
    for (const [lo, hi] of ANDRO) {
      const f = 2 ** (((st(lo) + st(hi)) / 2 - medSt) / 12);
      r[`a_${lo}_${hi}_${W}`] = lv.filter((x) => x * f >= lo && x * f <= hi).length / lv.length;
    }
  }
  rows.push(r);
}

console.log(`speakers: ${rows.length} (${rows.filter((r) => r.sex === "f").length} women, ${rows.filter((r) => r.sex === "m").length} men)`);
console.log("\nOwn band (women: feminine, men: masculine) — share of voiced frames in the band | on target (in or beyond):");
for (const src of [...new Set(rows.map((r) => r.src)), "ALL"]) {
  for (const g of ["f", "m"]) {
    const R = rows.filter((r) => (src === "ALL" || r.src === src) && r.sex === g);
    if (!R.length) continue;
    let line = `  ${src.padEnd(18)} ${g} n=${String(R.length).padStart(2)} median ${mean(R.map((r) => r.medHz)).toFixed(0).padStart(3)} Hz |`;
    for (const W of WINS) line += ` ${W ? `level ${W} ms` : "per frame"}: ${pct(mean(R.map((r) => r[`own_${W}`])))} | ${pct(mean(R.map((r) => r[`on_${W}`])))} ;`;
    console.log(line);
  }
}
console.log("\nRecentred (speaker median at the band centre), all speakers — share in the band, mean (10th percentile of speakers):");
for (const W of WINS) {
  let line = `  ${(W ? `level ${W} ms` : "per frame").padEnd(14)}`;
  for (const name of Object.keys(PITCH_TARGETS)) {
    const a = rows.map((r) => r[`ctr_${name}_${W}`]).sort((x, y) => x - y);
    line += ` ${name} ${pct(mean(a))} (${pct(a[Math.floor(0.1 * a.length)])}) |`;
  }
  console.log(line);
}
console.log("\nAndrogynous band widths (recentred), mean (10th percentile):");
for (const W of WINS) {
  let line = `  ${(W ? `level ${W} ms` : "per frame").padEnd(14)}`;
  for (const [lo, hi] of ANDRO) {
    const a = rows.map((r) => r[`a_${lo}_${hi}_${W}`]).sort((x, y) => x - y);
    line += ` ${lo}-${hi} (${(st(hi) - st(lo)).toFixed(1)} st) ${pct(mean(a))} (${pct(a[Math.floor(0.1 * a.length)])}) |`;
  }
  console.log(line);
}
for (const [name, t] of Object.entries(PITCH_TARGETS)) console.log(`${name} ${t.low}-${t.high} Hz = ${(st(t.high) - st(t.low)).toFixed(2)} st`);
