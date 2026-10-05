// sim.mjs — run src/audio/steadiness.js (the real module) over posted pitch
// series for a grid of parameter configurations; score.py scores the output.
//
// Inputs:
//   sessions / fda / ptdb / voc : lowband-attr.mjs dumps
//       build/session-oracle/attr/<tag>/<set>/<track>.{json,f32} (column "post")
//   synth  : synth-cases.mjs output build/steady/synth/cases_*.json
//   prec   : the precision pass's 96 held notes build/prec/sc_base_*.json
// Message convention: posted value post[kk] (0 = unvoiced) has contextTime
// (kk + 1) * hop (window centre = contextTime - 40 ms).
//
// Usage: node scripts/steadiness/sim.mjs --sets=sessions,fda,ptdb,voc,synth,prec
//          [--tag=base] [--configs=all|name,name] [--src=src] [--out=build/steady/sim]
// Output: <out>/<config>/<set>/<track>.f32 = Float32 [value (NaN = "—") x n, held x n]
//         <out>/configs.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return [m[1], m[2] ?? "1"]; }));
const TAG = args.tag ?? "base";
const OUT = resolve(args.out ?? "build/steady/sim");
const mod = await import(pathToFileURL(resolve(args.src ?? "src", "audio/steadiness.js")).href);

// One-factor-at-a-time grid around the precision pass's recipe
// (1 s, 3-st trim, coverage gate), plus the untrimmed control.
const BASE = { windowSec: 1.0, minCoverage: 0.5, trimSemitones: 3, wideTrimSemitones: null, maxTrimFraction: 1, maxWideTrimFraction: null, minValues: 8, updateSec: 0.025, emaAlpha: 1, holdSec: 0 };
const C = {
  base: {},
  untrimmed: { trimSemitones: 1e9 },
  // the untrimmed control at the trim grid's coverage (0.6), for the §2 table
  untrimmed06: { trimSemitones: 1e9, minCoverage: 0.6 },
  w075: { windowSec: 0.75, minValues: 6 },
  w15: { windowSec: 1.5, minValues: 12 },
  cov03: { minCoverage: 0.3 }, cov04: { minCoverage: 0.4 }, cov06: { minCoverage: 0.6 }, cov07: { minCoverage: 0.7 }, cov08: { minCoverage: 0.8 },
  trim2: { trimSemitones: 2 }, trim15: { trimSemitones: 1.5 }, trim4: { trimSemitones: 4 }, trim6: { trimSemitones: 6 },
  mtf05: { maxTrimFraction: 0.05 }, mtf10: { maxTrimFraction: 0.1 }, mtf20: { maxTrimFraction: 0.2 }, mtf30: { maxTrimFraction: 0.3 },
  ema05: { emaAlpha: 0.5, updateSec: 0.1 }, ema03: { emaAlpha: 0.3, updateSec: 0.1 },
  upd100: { updateSec: 0.1 }, upd250: { updateSec: 0.25 },
  hold15: { holdSec: 1.5, updateSec: 0.1 },
  // candidates assembled from the one-factor results
  candA: { maxTrimFraction: 0.2, updateSec: 0.1, holdSec: 1.5 },
  candB: { maxTrimFraction: 0.2, minCoverage: 0.6, updateSec: 0.1, holdSec: 1.5 },
  candC: { maxTrimFraction: 0.1, updateSec: 0.1, holdSec: 1.5 },
  candD: { maxTrimFraction: 0.3, updateSec: 0.1, holdSec: 1.5 },
  defaults: null, // the module's STEADINESS_DEFAULTS as committed
};
// trim width x max-trim-fraction grid (coverage 0.6)
for (const w of [3, 4, 5, 6, 7, 8, 9]) for (const f of [0.1, 0.2, 0.3, 1]) C[`t${w}m${Math.round(f * 100)}`] = { trimSemitones: w, maxTrimFraction: f, minCoverage: 0.6 };
// two-stage (adaptive) trim: inner 3 st, outer w st, max drop fraction f
for (const w of [6, 7, 8, 9]) for (const f of [0.1, 0.2, 0.3]) C[`a${w}m${Math.round(f * 100)}`] = { trimSemitones: 3, wideTrimSemitones: w, maxTrimFraction: f, minCoverage: 0.6 };
// separate inner / outer drop limits
for (const w of [5, 6, 7]) for (const fi of [0.05, 0.1, 0.15]) for (const fo of [0.1, 0.15, 0.2]) C[`a${w}i${Math.round(fi * 100)}o${Math.round(fo * 100)}`] = { trimSemitones: 3, wideTrimSemitones: w, maxTrimFraction: fi, maxWideTrimFraction: fo, minCoverage: 0.6 };
// one-factor variations around the chosen recipe (two-stage trim 3 / 6 st,
// drop limits 10 / 15 %, coverage 0.6)
const REC = { trimSemitones: 3, wideTrimSemitones: 6, maxTrimFraction: 0.1, maxWideTrimFraction: 0.15, minCoverage: 0.6 };
Object.assign(C, {
  rec: { ...REC },
  rec_cov04: { ...REC, minCoverage: 0.4 }, rec_cov05: { ...REC, minCoverage: 0.5 }, rec_cov07: { ...REC, minCoverage: 0.7 }, rec_cov08: { ...REC, minCoverage: 0.8 },
  rec_w075: { ...REC, windowSec: 0.75, minValues: 6 }, rec_w15: { ...REC, windowSec: 1.5, minValues: 12 },
  rec_upd100: { ...REC, updateSec: 0.1 }, rec_upd200: { ...REC, updateSec: 0.2 },
  rec_ema05: { ...REC, emaAlpha: 0.5 }, rec_ema07: { ...REC, emaAlpha: 0.7 },
  rec_hold15: { ...REC, holdSec: 1.5 }, rec_hold1: { ...REC, holdSec: 1.0 },
  rec_min12: { ...REC, minValues: 12 }, rec_min16: { ...REC, minValues: 16 },
});
const CONFIGS = Object.fromEntries(Object.entries(C).map(([k, v]) => [k, v === null ? { ...mod.STEADINESS_DEFAULTS } : { ...BASE, ...v }]));
const pick = args.configs && args.configs !== "all" ? args.configs.split(",") : Object.keys(CONFIGS);
// --col=paint: feed the PAINTED trace instead (display hops; content lags
// the posted convention by L*hop + 30 ms, recorded as lagSec for score.py).
const COL = args.col ?? "post";
const SUFFIX = COL === "post" ? "" : `_${COL}`;

function* tracks(set) {
  if (["sessions", "fda", "ptdb", "voc", "hil"].includes(set)) {
    const d = resolve("build/session-oracle/attr", TAG, set);
    for (const f of readdirSync(d).filter((x) => x.endsWith(".json"))) {
      const m = JSON.parse(readFileSync(resolve(d, f), "utf8"));
      const a = new Float32Array(readFileSync(resolve(d, f.replace(/\.json$/, ".f32"))).buffer.slice(0));
      const ci = m.cols.indexOf(COL);
      yield { id: m.name ?? f.replace(/\.json$/, ""), hop: m.hopS, L: m.L, post: a.subarray(ci * m.n, (ci + 1) * m.n) };
    }
  } else if (set === "synth" || set === "prec") {
    const d = set === "synth" ? resolve("build/steady/synth") : resolve("build/prec");
    const re = set === "synth" ? /^cases_\d+\.json$/ : /^sc_base_\d+\.json$/;
    for (const f of readdirSync(d).filter((x) => re.test(x))) {
      for (const c of JSON.parse(readFileSync(resolve(d, f), "utf8"))) yield { id: `c${c.id}`, hop: c.hop, post: Float32Array.from(c.post) };
    }
  } else throw new Error(`set ${set}`);
}

mkdirSync(OUT, { recursive: true });
const cfgFile = resolve(OUT, "configs.json");
const prev = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : {};
for (const k of pick) prev[k + SUFFIX] = COL === "post" ? CONFIGS[k] : { ...CONFIGS[k], lagSec: 2 * 0.025 + 0.030, col: COL };
writeFileSync(cfgFile, JSON.stringify(prev, null, 1));
for (const set of (args.sets ?? "sessions,fda,ptdb,voc,synth,prec").split(",")) {
  const T = [...tracks(set)];
  for (const k of pick) {
    const dir = resolve(OUT, k + SUFFIX, set); mkdirSync(dir, { recursive: true });
    for (const t of T) {
      const tr = mod.createSteadinessTracker(CONFIGS[k]);
      const n = t.post.length, buf = new Float32Array(2 * n).fill(NaN);
      for (let i = 0; i < n; i++) {
        tr.push(t.post[i] > 0 ? t.post[i] : null, (i + 1) * t.hop);
        const r = tr.read();
        buf[n + i] = 0;
        if (r.value !== null) { buf[i] = r.value; buf[n + i] = r.held ? 1 : 0; }
      }
      writeFileSync(resolve(dir, `${t.id}.f32`), Buffer.from(buf.buffer));
    }
  }
  console.log(`${set}: ${T.length} tracks x ${pick.length} configs`);
}
