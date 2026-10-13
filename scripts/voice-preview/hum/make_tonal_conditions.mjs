// make_tonal_conditions.mjs — in-range tonal-noise conditions for the hum test, a labelled
// addition to §P7 of measurements/voice-preview-spike-2026-10-12.md (review, 2026-10-12).
//
// §P7's hum conditions are 50 / 60 Hz mains stacks: their fundamentals sit below the pitch
// floor (75 Hz), so the pitch chain leaves the pauses unvoiced. This adds the repository's own
// in-range tonal classes (scripts/noise-synth.js, the noise-augmentation oracle's generators):
//   fan   fanHum(n, 3): 120 Hz + 240 / 360 Hz over low-passed rumble
//   mcx   mainsComplex(n): 60 / 120 / 180 / 240 Hz with a prominent 180 Hz 3rd harmonic
// at -40, -30 and -20 dB re the clean clip RMS (as §P7's hum: RMS over the recording), on the
// four §P7 base clips (16 kHz), plus a 24 kHz spot check (pt_m1 / pt_f1 from their 48 kHz
// sources, both classes at -20 dB; the 16 kHz generator output upsampled with the lab's sinc
// resampler, which keeps everything below 7.2 kHz: the tonal noise lies below 1 kHz).
// Each condition is generated as one stream over its 10 s pre-roll and the recording, so the
// pre-roll ("live" run) continues the same noise. The clean clips are listed again, so the
// tonal run renders its own clean references.
//
//   node scripts/voice-preview/hum/make_tonal_conditions.mjs
// Reads VP_CACHE/hum/clips (make_conditions.py must have run); writes the new clips there
// and VP_CACHE/hum/clips/index-tonal.json (index.json, the pre-registered set, is untouched).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { P, REPO } from "../lib/paths.mjs";
import { readF32, writeArr } from "../lib/node-io.mjs";

const imp = (p) => import(pathToFileURL(path.join(REPO, p)).href);
const { fanHum, mainsComplex } = await imp("scripts/noise-synth.js");
const { createSincResampler } = await imp("src/resonance-lab/sinc-resampler.js");

const D = path.join(P.hum, "clips");
const idx = JSON.parse(readFileSync(path.join(D, "index.json"), "utf8"));
const PRE_S = idx.pre_s; // 10 s, as §P7's pre-roll
const CLASSES = {
  fan: { gen: (n) => fanHum(n, 3), fund: 120, lines: [120, 240, 360], label: "fan hum (noise-synth fanHum, seed 3)" },
  mcx: { gen: (n) => mainsComplex(n), fund: 60, lines: [60, 120, 180, 240], label: "mains complex (noise-synth mainsComplex)" },
};
const rms = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };

/** n16 samples of the class at 16 kHz, or the same noise upsampled to 48 kHz (n48 samples). */
function noise(cls, nOut, sr) {
  if (sr === 16000) return CLASSES[cls].gen(nOut);
  const n16 = Math.ceil(nOut / 3) + 400;
  const x = CLASSES[cls].gen(n16);
  const rs = createSincResampler(16000, 48000, { cutoffHz: 7200 });
  const out = new Float32Array(nOut);
  let m = 0;
  for (let k = 0; k < x.length && m < nOut; k += 1600) {
    const y = rs(x.subarray(k, Math.min(x.length, k + 1600)));
    const take = Math.min(y.length, nOut - m);
    out.set(y.subarray(0, take), m);
    m += take;
  }
  if (m < nOut) throw new Error(`upsampling gave ${m} of ${nOut} samples`);
  return out;
}

const out = [];
const add = (base, sex, sr, clean, cls, lv, extra = {}) => {
  const npre = Math.round(PRE_S * sr), n = clean.length;
  const z = noise(cls, npre + n, sr);
  const g = (rms(clean) * 10 ** (lv / 20)) / rms(z.subarray(npre));
  const y = Float32Array.from(clean, (v, i) => v + g * z[npre + i]);
  const pre = Float32Array.from(z.subarray(0, npre), (v) => g * v);
  const nm = `${base}${sr === 48000 ? "48" : ""}__${cls}_m${-lv}`;
  writeArr(path.join(D, `${nm}.f32`), y);
  writeArr(path.join(D, `${nm}.pre.f32`), pre);
  let peak = 0;
  for (const v of y) peak = Math.max(peak, Math.abs(v));
  out.push({ name: nm, base, sex, cond: `${cls}_m${-lv}`, sr, n, peak, kind: "tonal", tonal: cls, fund: CLASSES[cls].fund,
    lines: CLASSES[cls].lines, level_db: lv, addition: "review 2026-10-12", ...extra });
};

for (const base of ["ls_m2", "pt_m1", "ls_f1", "pt_f1"]) {
  const c = idx.clips.find((e) => e.name === `${base}__clean`);
  out.push({ ...c });
  const clean = readF32(path.join(D, `${c.name}.f32`));
  for (const cls of ["fan", "mcx"]) for (const lv of [-40, -30, -20]) add(base, c.sex, 16000, clean, cls, lv);
}
for (const base of ["pt_m1", "pt_f1"]) {
  const c = idx.clips.find((e) => e.name === `${base}48__clean`);
  out.push({ ...c });
  const clean = readF32(path.join(D, `${c.name}.f32`));
  for (const cls of ["fan", "mcx"]) add(base, c.sex, 48000, clean, cls, -20, { spot24k: true });
}
writeFileSync(path.join(D, "index-tonal.json"), JSON.stringify({ pre_s: PRE_S, classes: Object.fromEntries(Object.entries(CLASSES).map(([k, v]) => [k, { fund: v.fund, lines: v.lines, label: v.label }])), clips: out }, null, 1));
console.log(`${out.length} entries (${out.filter((e) => e.kind === "tonal").length} tonal conditions); max peak ${Math.max(...out.map((e) => e.peak || 0)).toFixed(3)}`);
