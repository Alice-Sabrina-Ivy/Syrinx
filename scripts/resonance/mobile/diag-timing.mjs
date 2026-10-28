// diag-timing.mjs — aggregate timing / level statistics of old phone diag
// snapshots (scripts/mobile-diag-capture.js output). Timing and level only:
// no pitch values, no audio content. Usage:
//   node scripts/resonance/mobile/diag-timing.mjs <dir-or-files...> [--out=<json>]
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith("--out="));
const inputs = args.filter((a) => !a.startsWith("--"));
const files = [];
for (const p of inputs) {
  if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) { if (f.endsWith(".json")) files.push(path.join(p, f)); }
  else files.push(p);
}
const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const rows = [];
for (const f of files.sort()) {
  let j;
  try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
  const s = j.snapshot ?? j;
  const fr = s.frames ?? [];
  const audio = s.audio ?? {};
  const cap = s.status?.capture ?? {};
  if (fr.length < 50) { rows.push({ file: path.basename(f), frames: fr.length }); continue; }
  // capture epoch per DSP frame: capturedEpochMs when present, else
  // tEpochMs - workerProcessingMs - chunkArrivalMs (receipt - capture).
  const capT = [], recT = [], arr = [];
  for (const x of fr) {
    const t = x.timings ?? {};
    const rec = typeof x.tEpochMs === "number" && typeof t.workerProcessingMs === "number" ? x.tEpochMs - t.workerProcessingMs : null;
    const c = typeof x.capturedEpochMs === "number" ? x.capturedEpochMs : (rec != null && typeof t.chunkArrivalMs === "number" ? rec - t.chunkArrivalMs : null);
    capT.push(c); recT.push(rec); arr.push(typeof t.chunkArrivalMs === "number" ? t.chunkArrivalMs : null);
  }
  const capSteps = [], recSteps = [];
  let back = 0, holes = 0, maxHole = 0;
  for (let i = 1; i < fr.length; i++) {
    if (capT[i] != null && capT[i - 1] != null) {
      const d = capT[i] - capT[i - 1];
      capSteps.push(d);
      if (d < -0.5) back++;
      if (d > 100) { holes++; maxHole = Math.max(maxHole, d); }
    }
    if (recT[i] != null && recT[i - 1] != null) recSteps.push(recT[i] - recT[i - 1]);
  }
  // deviation of capture step from the nominal chunk (chunkMs)
  const chunkMs = cap.chunkMs ?? 25;
  const dev = capSteps.map((d) => Math.abs(d - chunkMs));
  const burst = recSteps.filter((d) => d < 5).length / Math.max(1, recSteps.length);
  const arrs = arr.filter((x) => x != null);
  const rmsV = fr.filter((x) => x.pitch != null && x.inputRms > 0).map((x) => 20 * Math.log10(x.inputRms));
  const rmsAll = fr.filter((x) => x.inputRms > 0).map((x) => 20 * Math.log10(x.inputRms));
  const pi = s.pitchInferences ?? [];
  const piSteps = [];
  for (let i = 1; i < pi.length; i++) piSteps.push(pi[i].tEpochMs - pi[i - 1].tEpochMs);
  rows.push({
    file: path.basename(f),
    kind: cap.kind ?? audio.captureKind ?? null,
    sr: audio.sampleRate ?? cap.sampleRate ?? null,
    hwFrameMs: audio.mstpFrameDurationMs ?? cap.frameDurationMs ?? null,
    chunkMs,
    frames: fr.length,
    spanS: r1(((recT[recT.length - 1] ?? 0) - (recT[0] ?? 0)) / 1000),
    capStep: { p01: r1(q(capSteps, 0.01)), p50: r1(q(capSteps, 0.5)), p99: r1(q(capSteps, 0.99)), max: r1(Math.max(...capSteps)), min: r1(Math.min(...capSteps)) },
    capStepDevGt1ms: r1(100 * dev.filter((d) => d > 1).length / Math.max(1, dev.length)),
    capBackSteps: back, capHolesGt100ms: holes, capMaxHoleMs: r1(maxHole),
    recStep: { p50: r1(q(recSteps, 0.5)), p99: r1(q(recSteps, 0.99)), max: r1(Math.max(...recSteps)) },
    recBurstShare: r1(100 * burst),
    arrivalMs: { p50: r1(q(arrs, 0.5)), p95: r1(q(arrs, 0.95)), p99: r1(q(arrs, 0.99)), max: r1(Math.max(...arrs)) },
    pitchPostStepMs: piSteps.length ? { p50: r1(q(piSteps, 0.5)), p99: r1(q(piSteps, 0.99)), max: r1(Math.max(...piSteps)) } : null,
    pitchInferMs: pi.length ? { p50: r1(q(pi.map((x) => x.inferMs).filter((x) => x != null), 0.5)), p99: r1(q(pi.map((x) => x.inferMs).filter((x) => x != null), 0.99)) } : null,
    voicedRmsDbfs: rmsV.length > 20 ? { n: rmsV.length, p10: r1(q(rmsV, 0.1)), p50: r1(q(rmsV, 0.5)), p90: r1(q(rmsV, 0.9)) } : null,
    allRmsDbfs: { p10: r1(q(rmsAll, 0.1)), p50: r1(q(rmsAll, 0.5)) },
    ua: (s.userAgent ?? audio.userAgent ?? "").replace(/^.*\((.*?)\).*Chrome\/([\d.]+).*$/, "$1 Chrome $2"),
  });
}
for (const r of rows) console.log(JSON.stringify(r));
if (outArg) fs.writeFileSync(outArg.slice(6), JSON.stringify(rows, null, 1));
