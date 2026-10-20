// sweep.mjs — grid search (dev half) and one-shot confirmation (held-out half)
// for the narrowband detector (measurements/resonance-narrowband-2026-10-19.md §4,
// "Round 4 plan": the judged positives are the four classic 8 kHz links; Opus
// 8 kbit/s narrowband and the 4 kHz low-pass are reported descriptively, neither positive nor negative).
//
//   node scripts/resonance-narrowband/sweep.mjs --half=dev                 grid, selection
//   node scripts/resonance-narrowband/sweep.mjs --half=held --point=B,8,3,6,-31
//        (band, tauS, vMinS, hystDb, tOnDb)                               confirmation
//
// Round 1 (lp4k judged as a positive) is this script at 654e449; round 2 (five
// phone paths judged, opus8nb included) is this script at 50442a0.
//
// Reads build/resonance-narrowband/feat/<cond>/<spk>.{json,f64} (extract.mjs).
// The grid computes F once per (band pair, tau) with detector.mjs
// createDecision and scans the hysteresis rule over it; the selected /
// confirmed point is then run through createDecision itself, and the two
// must agree exactly. Writes build/resonance-narrowband/sweep-r4-<half>.json and
// prints Markdown.
//
// Metrics (plan §4), voiced time = voiced 10 ms grid frames of the engine:
//   negative condition: notice-on share of voiced frames, pooled per sex;
//                       clean: no stream may show the notice at all
//   positive condition: a stream is detected if the notice has come on by
//                       the time 10 s of voiced audio has passed (its first
//                       on frame is among the first 1000 voiced frames)

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAIRS, createDecision } from "./detector.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../build/resonance-narrowband");
const FEAT = path.join(OUT, "feat");
const arg = (k, d = null) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const HALF = arg("half");
const POINT = arg("point");
if (!["dev", "held"].includes(HALF)) { console.error("--half=dev|held"); process.exit(2); }

const GRID = {
  band: ["A", "B", "C"],
  tau: [4, 8],
  vmin: [3, 5],
  hyst: [3, 6],
  ton: Array.from({ length: 51 }, (_, i) => -60 + i),
};
const POS = ["tel", "amrnb", "g711u", "btnb"]; // judged (round 4)
const DESC = ["opus8nb", "lp4k"]; // reported only: not judged, not used in selection
const NEG_BAR = 0.01, POS_BAR = 0.95, DETECT_FRAMES = 1000;

// ---- split (as conditions.py): within sex, numeric LibriSpeech id, even ranks = dev
const streamsJson = JSON.parse(readFileSync(path.join(OUT, "streams.json"), "utf8")).streams;
const half = {};
for (const sx of ["f", "m"]) {
  streamsJson.filter((s) => s.sex === sx).sort((a, b) => +a.speaker.slice(2) - +b.speaker.slice(2))
    .forEach((s, i) => { half[s.speaker] = i % 2 === 0 ? "dev" : "held"; });
}

// ---- load
const conds = readdirSync(FEAT).filter((c) => existsSync(path.join(FEAT, c)));
const streams = []; // {cond, pos, spk, sex, ver, n, e: Float64Array(4n), audioS, detMs}
for (const cond of conds) {
  for (const f of readdirSync(path.join(FEAT, cond)).filter((f) => f.endsWith(".json"))) {
    const rec = JSON.parse(readFileSync(path.join(FEAT, cond, f), "utf8"));
    if (half[rec.spk] !== HALF) continue;
    const b = readFileSync(path.join(FEAT, cond, f.replace(".json", ".f64")));
    const a = new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8);
    let o = 0;
    for (const ver of rec.order) {
      const [k, , nv] = [a[o], a[o + 1], a[o + 2]];
      if (rec.order[k] !== ver) throw new Error(`order mismatch ${cond} ${rec.spk}`);
      o += 3;
      const e = new Float64Array(4 * nv);
      for (let i = 0; i < nv; i++) for (let j = 0; j < 4; j++) e[4 * i + j] = a[o + 5 * i + 1 + j];
      o += 5 * nv;
      const m = rec.versions[ver];
      streams.push({ cond, pos: POS.includes(cond), desc: DESC.includes(cond), spk: rec.spk, sex: rec.sex, ver, n: nv, e,
        audioS: m.audioS, detMs: m.detMs, gridFrames: m.gridFrames, framesDropped: m.framesDropped });
    }
    if (o !== a.length) throw new Error(`trailing data ${cond} ${rec.spk}`);
  }
}
const condList = [...new Set(streams.map((s) => s.cond))].sort();
const negConds = condList.filter((c) => !POS.includes(c) && !DESC.includes(c));
const posConds = condList.filter((c) => POS.includes(c));
const descConds = condList.filter((c) => DESC.includes(c));
if (posConds.length !== POS.length) throw new Error(`missing positive conditions: ${POS.filter((c) => !posConds.includes(c))}`);
console.error(`${HALF}: ${streams.length} streams, ${condList.length} conditions (${posConds.length} positive, ${descConds.length} descriptive)`);

// ---- F trajectory for (band, tau) via the module (thresholds don't affect f)
function fTrack(s, band, tau) {
  const [hi, ref] = PAIRS[band];
  const d = createDecision({ tauS: tau, vMinS: 1e9, hystDb: 0, tOnDb: -Infinity });
  const f = new Float64Array(s.n);
  for (let i = 0; i < s.n; i++) f[i] = d.push(s.e[4 * i + hi], s.e[4 * i + ref]).f;
  return f;
}
// hysteresis scan = createDecision's rule on a precomputed F track
function scan(f, nMin, tOn, tOff) {
  let on = false, onFrames = 0, firstOn = -1;
  for (let i = nMin - 1; i < f.length; i++) {
    if (!on && f[i] < tOn) { on = true; if (firstOn < 0) firstOn = i; }
    else if (on && f[i] > tOff) on = false;
    if (on) onFrames++;
  }
  return [onFrames, firstOn];
}
// the module itself, for the selected / confirmed point
function runModule(s, p) {
  const [hi, ref] = PAIRS[p.band];
  const d = createDecision({ tauS: p.tau, vMinS: p.vmin, hystDb: p.hyst, tOnDb: p.ton });
  let onFrames = 0, firstOn = -1;
  for (let i = 0; i < s.n; i++) {
    const st = d.push(s.e[4 * i + hi], s.e[4 * i + ref]);
    if (st.on) { onFrames++; if (firstOn < 0) firstOn = i; }
  }
  return [onFrames, firstOn];
}

// ---- metrics for one point from per-stream [onFrames, firstOn]
function metrics(res) {
  const neg = {}, pos = {}, desc = {};
  let cleanAny = 0;
  for (let k = 0; k < streams.length; k++) {
    const s = streams[k], [onF, first] = res[k];
    const key = `${s.cond}|${s.sex}`;
    if (!s.pos && !s.desc) {
      const c = (neg[key] ??= { on: 0, n: 0, streamsWithOn: 0, streams: 0 });
      c.on += onF; c.n += s.n; c.streams++; if (onF > 0) c.streamsWithOn++;
      if (s.cond === "clean" && onF > 0) cleanAny++;
    } else {
      const c = ((s.desc ? desc : pos)[key] ??= { det: 0, streams: 0, short: 0, tts: [], drop: 0, after: 0 });
      c.streams++;
      if (s.n < DETECT_FRAMES) c.short++;
      if (first >= 0 && first < DETECT_FRAMES) c.det++;
      if (first >= 0) { c.tts.push((first + 1) * 0.01); c.after += s.n - first; c.drop += s.n - first - onF; }
    }
  }
  let worstNeg = 0, worstNegKey = null, worstPos = 1, worstPosKey = null;
  for (const [k, c] of Object.entries(neg)) {
    c.share = c.on / c.n;
    if (worstNegKey === null || c.share > worstNeg) { worstNeg = c.share; worstNegKey = k; }
  }
  for (const [k, c] of Object.entries(pos)) {
    c.rate = c.det / c.streams;
    if (worstPosKey === null || c.rate < worstPos) { worstPos = c.rate; worstPosKey = k; }
  }
  for (const c of Object.values(desc)) c.rate = c.det / c.streams;
  const pass = worstNeg <= NEG_BAR && cleanAny === 0 && worstPos >= POS_BAR;
  return { neg, pos, desc, cleanAny, worstNeg, worstNegKey, worstPos, worstPosKey, pass };
}

const q = (a, p) => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const pct = (x) => (x == null ? "—" : `${(100 * x).toFixed(x > 0 && x < 0.001 ? 3 : 1)} %`);

// ---- F distribution at the end of each stream / at 10 s voiced (for the chosen band, tau)
function fDist(band, tau) {
  const by = {};
  for (const s of streams) {
    const f = fTrack(s, band, tau);
    const c = (by[`${s.cond}|${s.sex}`] ??= { end: [], at10: [] });
    if (f.length) c.end.push(f[f.length - 1]);
    if (f.length >= DETECT_FRAMES) c.at10.push(f[DETECT_FRAMES - 1]);
  }
  return by;
}

function report(p, m, label) {
  const lines = [];
  lines.push(`### ${label}: band ${p.band}, τ ${p.tau} s, V_min ${p.vmin} s, H ${p.hyst} dB, T_on ${p.ton} dB — ${m.pass ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push(`Worst negative: ${pct(m.worstNeg)} (${m.worstNegKey}); clean streams with the notice: ${m.cleanAny}; worst positive detection: ${pct(m.worstPos)} (${m.worstPosKey}).`);
  lines.push("");
  const fd = fDist(p.band, p.tau);
  lines.push("Negatives (wideband): notice-on share of voiced time (bar ≤ 1 %), streams with any notice, F at stream end (dB, min / median)");
  lines.push("");
  lines.push("| Condition | women share | women streams on | men share | men streams on | F end women min / med | F end men min / med |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const c of negConds) {
    const w = m.neg[`${c}|f`], mm = m.neg[`${c}|m`];
    const fw = fd[`${c}|f`]?.end ?? [], fm = fd[`${c}|m`]?.end ?? [];
    const mn = (a) => (a.length ? Math.min(...a).toFixed(1) : "—");
    const md = (a) => (a.length ? q(a, 0.5).toFixed(1) : "—");
    lines.push(`| ${c} | ${pct(w?.share)} | ${w?.streamsWithOn}/${w?.streams} | ${pct(mm?.share)} | ${mm?.streamsWithOn}/${mm?.streams} | ${mn(fw)} / ${md(fw)} | ${mn(fm)} / ${md(fm)} |`);
  }
  lines.push("");
  lines.push("Positives (the four classic 8 kHz links, judged): detected by 10 s voiced (bar ≥ 95 %), time to notice (voiced s, median / q90), dropouts after first notice, F at stream end (dB, median / max)");
  lines.push("");
  lines.push("| Condition | women detected | men detected | women time med / q90 | men time med / q90 | women dropouts | men dropouts | F end women med / max | F end men med / max |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const c of [...posConds, ...descConds]) {
    const src = DESC.includes(c) ? m.desc : m.pos;
    const w = src[`${c}|f`], mm = src[`${c}|m`];
    const fw = fd[`${c}|f`]?.end ?? [], fm = fd[`${c}|m`]?.end ?? [];
    const tt = (x) => (x?.tts.length ? `${q(x.tts, 0.5).toFixed(2)} / ${q(x.tts, 0.9).toFixed(2)}` : "—");
    const dr = (x) => (x?.after ? pct(x.drop / x.after) : "—");
    const mx = (a) => (a.length ? Math.max(...a).toFixed(1) : "—");
    const md = (a) => (a.length ? q(a, 0.5).toFixed(1) : "—");
    lines.push(`| ${DESC.includes(c) ? `${c} (descriptive, not judged)` : c} | ${w?.det}/${w?.streams} (${pct(w?.rate)}) | ${mm?.det}/${mm?.streams} (${pct(mm?.rate)}) | ${tt(w)} | ${tt(mm)} | ${dr(w)} | ${dr(mm)} | ${md(fw)} / ${mx(fw)} | ${md(fm)} / ${mx(fm)} |`);
  }
  const short = Object.values(m.pos).reduce((a, c) => a + c.short, 0);
  lines.push("");
  lines.push(`Positive streams with < 10 s of voiced audio in total: ${short}.`);
  return lines.join("\n");
}

const cost = (() => {
  let ms = 0, s = 0;
  for (const x of streams) { ms += x.detMs; s += x.audioS; }
  return { msPerAudioS: ms / s, streams: streams.length, audioMin: s / 60,
    framesDropped: streams.reduce((a, x) => a + (x.framesDropped || 0), 0) };
})();

const out = { half: HALF, nStreams: streams.length, conditions: condList, cost };

if (POINT) {
  const [band, tau, vmin, hyst, ton] = POINT.split(",");
  const p = { band, tau: +tau, vmin: +vmin, hyst: +hyst, ton: +ton };
  const m = metrics(streams.map((s) => runModule(s, p)));
  out.point = p;
  out.metrics = m;
  console.log(report(p, m, `Confirmation (${HALF})`));
} else {
  // ---- grid
  const rows = [];
  for (const band of GRID.band) {
    for (const tau of GRID.tau) {
      const tracks = streams.map((s) => fTrack(s, band, tau));
      for (const vmin of GRID.vmin) {
        const nMin = Math.round(vmin / 0.01);
        for (const hyst of GRID.hyst) {
          for (const ton of GRID.ton) {
            const res = tracks.map((f) => scan(f, nMin, ton, ton + hyst));
            const m = metrics(res);
            rows.push({ band, tau, vmin, hyst, ton, worstNeg: m.worstNeg, worstNegKey: m.worstNegKey,
              cleanAny: m.cleanAny, worstPos: m.worstPos, worstPosKey: m.worstPosKey, pass: m.pass });
          }
        }
      }
      console.error(`band ${band} tau ${tau} done`);
    }
  }
  out.grid = rows;
  const passing = rows.filter((r) => r.pass);
  console.log(`## Dev grid: ${rows.length} points, ${passing.length} pass both bars\n`);
  // per (band, tau, vmin, hyst): passing T_on range
  console.log("| Band | τ | V_min | H | passing T_on (dB) | n |");
  console.log("|---|---|---|---|---|---|");
  for (const band of GRID.band) for (const tau of GRID.tau) for (const vmin of GRID.vmin) for (const hyst of GRID.hyst) {
    const t = passing.filter((r) => r.band === band && r.tau === tau && r.vmin === vmin && r.hyst === hyst).map((r) => r.ton);
    console.log(`| ${band} | ${tau} | ${vmin} | ${hyst} | ${t.length ? `${Math.min(...t)} … ${Math.max(...t)}` : "none"} | ${t.length} |`);
  }
  if (!passing.length) {
    // closest misses, for the record
    const best = [...rows].sort((a, b) => (Math.max(a.worstNeg / NEG_BAR, (1 - a.worstPos) / (1 - POS_BAR)) - Math.max(b.worstNeg / NEG_BAR, (1 - b.worstPos) / (1 - POS_BAR))));
    console.log("\nNo grid point passes on dev. Closest points (worst negative share / worst positive detection):\n");
    for (const r of best.slice(0, 10)) console.log(`- ${r.band} τ${r.tau} V${r.vmin} H${r.hyst} T${r.ton}: neg ${pct(r.worstNeg)} (${r.worstNegKey}), clean ${r.cleanAny}, pos ${pct(r.worstPos)} (${r.worstPosKey})`);
    out.selected = null;
  } else {
    // selection (plan §4): lowest worst negative share, then largest worst-sex
    // positive detection, then larger H, then shorter V_min; then (deviation 3)
    // the (band, tau) with the longest contiguous run of tied T_on values,
    // shorter tau, band A < B < C; T_on at the middle of that run (lower middle).
    const minNeg = Math.min(...passing.map((r) => r.worstNeg));
    let c = passing.filter((r) => r.worstNeg === minNeg);
    const maxPos = Math.max(...c.map((r) => r.worstPos));
    c = c.filter((r) => r.worstPos === maxPos);
    const maxH = Math.max(...c.map((r) => r.hyst));
    c = c.filter((r) => r.hyst === maxH);
    const minV = Math.min(...c.map((r) => r.vmin));
    c = c.filter((r) => r.vmin === minV);
    const runs = [];
    for (const band of GRID.band) for (const tau of GRID.tau) {
      const t = c.filter((r) => r.band === band && r.tau === tau).map((r) => r.ton).sort((a, b) => a - b);
      let i = 0;
      while (i < t.length) {
        let j = i;
        while (j + 1 < t.length && t[j + 1] === t[j] + 1) j++;
        runs.push({ band, tau, lo: t[i], hi: t[j], len: j - i + 1 });
        i = j + 1;
      }
    }
    runs.sort((a, b) => b.len - a.len || a.tau - b.tau || a.band.localeCompare(b.band));
    const r = runs[0];
    const ton = r.lo + Math.floor((r.len - 1) / 2);
    const p = { band: r.band, tau: r.tau, vmin: minV, hyst: maxH, ton };
    out.selection = { minNeg, maxPos, maxH, minV, runs };
    out.selected = p;
    console.log(`\nSelection: ${c.length} points tie on (worst negative ${pct(minNeg)}, worst positive ${pct(maxPos)}, H ${maxH}, V_min ${minV}); runs: ${runs.map((x) => `${x.band}/τ${x.tau} ${x.lo}…${x.hi}`).join("; ")}`);
    // exact check: module vs scan at the selected point
    const tracks = streams.map((s) => fTrack(s, p.band, p.tau));
    const viaScan = tracks.map((f) => scan(f, Math.round(p.vmin / 0.01), p.ton, p.ton + p.hyst));
    const viaMod = streams.map((s) => runModule(s, p));
    const same = viaScan.every((x, k) => x[0] === viaMod[k][0] && x[1] === viaMod[k][1]);
    console.log(`Module vs scan at the selected point: ${same ? "identical" : "MISMATCH"}\n`);
    if (!same) process.exitCode = 1;
    const m = metrics(viaMod);
    out.metrics = m;
    console.log(report(p, m, "Selected (dev)"));
  }
}
console.log(`\nDetector cost: ${cost.msPerAudioS.toFixed(3)} ms CPU per second of audio (band energies; ${cost.streams} streams, ${cost.audioMin.toFixed(0)} min); pitch frames dropped by the engine: ${cost.framesDropped}`);
writeFileSync(path.join(OUT, `sweep-r4-${HALF}${POINT ? "-point" : ""}.json`), JSON.stringify(out, (k, v) => (k === "tts" ? undefined : v)));
