// render_synth.mjs — the suite's SYNTHETIC held notes (scenarios.mjs
// heldScenarios(): families steady / repeat / vowelchange / dynamics) written
// into the voice corpus as source `synthetic`, so the real-vs-synthetic
// comparison uses one loader and one record schema. Truth F0 (truthAt, the
// base trajectory; vibrato / wander / jitter ride on top) at 10 ms.
//   node scripts/notch-adversarial/realdata/render_synth.mjs [--families=steady,repeat,vowelchange,dynamics]
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { heldScenarios } from "../scenarios.mjs";
import { DATA, SR } from "./realdata.mjs";

const A = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const FAM = new Set((A.families ?? "steady,repeat,vowelchange,dynamics").split(","));

function wavFloat(x, sr) {
  const b = Buffer.alloc(44 + x.length * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * 4, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(32, 34); b.write("data", 36); b.writeUInt32LE(x.length * 4, 40);
  for (let i = 0; i < x.length; i++) b.writeFloatLE(x[i], 44 + i * 4);
  return b;
}
const dir = join(DATA, "voice", "synthetic"); mkdirSync(dir, { recursive: true });
const recs = [];
for (const sc of heldScenarios()) {
  if (!FAM.has(sc.family)) continue;
  const B = sc.build(SR);
  const id = "synthetic__" + sc.name.replace(/[^A-Za-z0-9.=+-]+/g, "_");
  writeFileSync(join(dir, id + ".wav"), wavFloat(B.x, SR));
  const n = Math.floor(B.x.length / SR * 100), f0 = new Array(n);
  for (let i = 0; i < n; i++) f0[i] = Math.round((B.truthAt ? B.truthAt(i / 100) : 0) * 100) / 100 || 0;
  writeFileSync(join(dir, id + ".f0.json"), JSON.stringify({ ref: { hopMs: 10, f0 }, praat: null }));
  let ss = 0, pk = 0; for (const v of B.x) { ss += v * v; pk = Math.max(pk, Math.abs(v)); }
  const holds = B.holds ?? sc.holds;
  const fAt = (t) => (B.truthAt ? B.truthAt(t) : 0);
  recs.push({ id, kind: "voice", source: "synthetic", path: `voice/synthetic/${id}.wav`, sr: SR, dur: +(B.x.length / SR).toFixed(3),
    rms_dbfs: +(10 * Math.log10(ss / B.x.length + 1e-24)).toFixed(2), peak: +pk.toFixed(4), class: `synthetic_${sc.family}`, gender: "n/a",
    url: "scripts/notch-adversarial/scenarios.mjs", license: "n/a (synthetic)", attribution: "notch adversarial suite", orig_sr: SR, orig_channels: 1, codec: "pcm",
    notes: sc.name, held: holds.map(([a, b]) => [a, b, +fAt((a + b) / 2).toFixed(2), null, null, null]), held_basis: "scenario",
    f0_median: +fAt((holds[0][0] + holds[0][1]) / 2).toFixed(1), held_sec: +holds.reduce((s, [a, b]) => s + b - a, 0).toFixed(2), f0_path: `voice/synthetic/${id}.f0.json` });
}
mkdirSync(join(DATA, "manifests"), { recursive: true });
writeFileSync(join(DATA, "manifests", "voice.synthetic.json"), JSON.stringify(recs, null, 1));
console.log(`synthetic: ${recs.length} clips, ${(recs.reduce((s, r) => s + r.dur, 0) / 60).toFixed(1)} min`);
