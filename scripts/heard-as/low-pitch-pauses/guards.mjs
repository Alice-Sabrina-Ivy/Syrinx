// guards.mjs — bar (iv) of measurements/heard-as-low-pitch-and-pauses-2026-10-21.md
// §6.3 on the build_guards.py streams (run through run.mjs): no new readings
// where the shipped panel shows none. Shipped (the panel before 2026-10-21:
// 3 s rule, no first-reading check — analyze.mjs VARIANTS, pinned since the
// 2026-10-21 review) vs a variant, the panel as in analyze.mjs (four 2 s-timer
// phases, 250 ms samples).
//
//   node guards.mjs --runs=<run.0.jsonl,run.1.jsonl> --variant=<name> [--out=<file.json>]
//
//   synth / fill60 / pink60 / held.alone / whisonly: shown samples (must be 0
//     where shipped has 0; whisonly judged on the unphonated talkers, the
//     phonated EARS "whisper" recordings reported)
//   heldafter: shown samples while the voice state is "sustained" (must be 0);
//     samples of the held note (from its start + 250 ms) still showing a reading
//     after the state turned "sustained" (must be 0: hidden within 250 ms);
//     shown samples in the held note before "sustained" (reported: the reading
//     of the preceding speech)
//   whis: B1 = share of the pooled classified logits that come from whisper
//     windows (>= 90 % of the 750 ms window inside a whisper piece), over the
//     shown panel computations (2 s updates and the variant's first-reading
//     checks), unphonated talkers, per sex; bar <= 5.0 %.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VARIANTS, simulate } from "./analyze.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { ML_WINDOW_MS } = await import(pathToFileURL(path.join(repo, "src/ml/heard-as.js")).href);
const { HEARD_AS_CALIBRATION: C } = await import(pathToFileURL(path.join(repo, "src/ml/heardAsCalibration.js")).href);
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const VAR = arg("variant", "");
if (!VARIANTS[VAR]) throw new Error(`--variant=${Object.keys(VARIANTS).join("|")}`);
const PH = [0, 500, 1000, 1500];

const streams = [];
for (const p of arg("runs", "").split(",")) for (const l of readFileSync(p, "utf8").split("\n")) if (l.trim()) streams.push(JSON.parse(l));

function pooled(s, now, poolLo) {
  // classified gated windows in the pool whose own span holds >= logitMinVoicedMs posted voiced (heard-as.js)
  let n = 0, nW = 0, sum = 0;
  for (const w of s.windows) {
    if (!w[2] || w[1] !== "gated" || w[0] <= poolLo || w[0] > now) continue;
    let v = 0, last = null;
    for (const [ms, f0] of s.pitch) {
      const dt = last === null ? 25 : Math.min(Math.max(ms - last, 0), 100); last = ms;
      if (ms > w[0]) break;
      if (ms >= w[0] - ML_WINDOW_MS && f0 > 0) v += dt;
    }
    if (v < C.logitMinVoicedMs) continue;
    n++; sum += s.logits[w[0]];
    let inside = 0;
    for (const [a, b] of s.whisper ?? []) inside += Math.max(0, Math.min(b, w[0]) - Math.max(a, w[0] - ML_WINDOW_MS));
    if (inside >= 0.9 * ML_WINDOW_MS) nW++;
  }
  return { n, nW, mean: n ? sum / n : null };
}

const R = {};
const add = (key, vname, field, x) => { R[key] ??= {}; R[key][vname] ??= {}; R[key][vname][field] = (R[key][vname][field] ?? 0) + x; };
for (const s of streams) {
  const key = s.set === "whisonly" ? `whisonly.${s.phonated ? "phonated" : "unphonated"}.${s.sex}`
    : s.set === "whis" ? `whis.${s.phonated ? "phonated" : "unphonated"}.${s.sex}`
      : s.set === "heldafter" ? `heldafter.${s.heldF0}` : s.set === "held" ? `held.alone.${s.heldF0}` : s.id;
  for (const vname of ["shipped", VAR]) {
    add(key, vname, "streams", 1);
    for (const ph of PH) {
      const { samples } = simulate(s, VARIANTS[vname], ph);
      add(key, vname, "samples", samples.length);
      add(key, vname, "shown", samples.filter((q) => q.shown).length);
      if (s.held) {
        const [h0, h1] = s.held;
        const inHeld = samples.filter((q) => q.t >= h0 + 250 && q.t <= h1);
        const firstSus = samples.find((q) => q.t >= h0 && q.vs === "sustained");
        add(key, vname, "sustainedSamples", samples.filter((q) => q.vs === "sustained").length);
        add(key, vname, "shownWhileSustained", samples.filter((q) => q.vs === "sustained" && q.shown).length);
        add(key, vname, "heldShownAfterSustained", firstSus ? inHeld.filter((q) => q.t >= firstSus.t && q.shown).length : 0);
        add(key, vname, "heldShownBeforeSustained", inHeld.filter((q) => (!firstSus || q.t < firstSus.t) && q.shown).length);
        add(key, vname, "heldSamples", inHeld.length);
        add(key, vname, "heldReachedSustained", firstSus ? 1 : 0);
        // the voice state ever "sustained" during the note, and the delay from note start to it
        if (firstSus) add(key, vname, "sustainedDelayMsSum", firstSus.t - h0);
      }
      if (s.set === "whis") {
        let prevShown = false;
        for (const q of samples) {
          const comp = q.shown && (q.upd || !prevShown);
          prevShown = q.shown;
          if (!comp) continue;
          const lo = q.t - C.windowMs;
          const p = pooled(s, q.t, lo);
          add(key, vname, "computations", 1);
          add(key, vname, "pooled", p.n);
          add(key, vname, "pooledWhisper", p.nW);
        }
      }
    }
  }
}
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "—");
const out = {};
console.log(`variant ${VAR} vs shipped (sums over 4 timer phases)`);
for (const [key, v] of Object.entries(R).sort()) {
  const a = v.shipped, b = v[VAR];
  out[key] = v;
  let line = `${key.padEnd(34)} streams ${a.streams}  shown samples ${a.shown} -> ${b.shown} (of ${b.samples})`;
  if (a.heldSamples !== undefined) line += `  | sustained reached ${a.heldReachedSustained}/${4 * a.streams} (stream x phase); shown while sustained ${a.shownWhileSustained} -> ${b.shownWhileSustained}; held shown after sustained ${a.heldShownAfterSustained} -> ${b.heldShownAfterSustained}; before ${a.heldShownBeforeSustained} -> ${b.heldShownBeforeSustained} (of ${b.heldSamples})`;
  if (a.pooled !== undefined || b.pooled !== undefined) line += `  | B1 whisper share ${pct(a.pooledWhisper ?? 0, a.pooled ?? 0)} % (${a.computations ?? 0} comps) -> ${pct(b.pooledWhisper ?? 0, b.pooled ?? 0)} % (${b.computations ?? 0} comps)`;
  console.log(line);
}
// B1 per sex, unphonated (the 2026-10-08 definition)
for (const sx of ["f", "m"]) {
  const v = R[`whis.unphonated.${sx}`];
  if (!v) continue;
  out[`B1.${sx}`] = { shipped: (v.shipped.pooledWhisper ?? 0) / Math.max(1, v.shipped.pooled ?? 0), [VAR]: (v[VAR].pooledWhisper ?? 0) / Math.max(1, v[VAR].pooled ?? 0) };
  console.log(`B1 ${sx === "f" ? "W" : "M"} (unphonated): shipped ${pct(v.shipped.pooledWhisper ?? 0, v.shipped.pooled ?? 0)} %, ${VAR} ${pct(v[VAR].pooledWhisper ?? 0, v[VAR].pooled ?? 0)} %  (bar <= 5.0 %)`);
}
if (arg("out", "")) writeFileSync(arg("out", ""), JSON.stringify(out, null, 1));
