// sweep3.mjs — round 3 (edge sharpness) grid search on the dev half and the
// one-shot confirmation on the held-out half
// (measurements/resonance-narrowband-2026-10-19.md "Round 3 plan").
//
//   node scripts/resonance-narrowband/sweep3.mjs --half=dev               grid, selection
//   node scripts/resonance-narrowband/sweep3.mjs --half=held --point=E1,8,3,6,-12
//        (feature, tauS, vMinS, hystDb, tOnDb)                            confirmation
//
// Reads build/resonance-narrowband/feat3/<cond>/<spk>.{json,f64} (extract.mjs
// --subbands). Judged positives, the descriptive lp4k row, negatives, bar,
// metrics and selection rule as sweep.mjs (round 2), with E1 / E2 in place of
// the band pair (R3.5). The grid computes E once per (feature, tau) with
// detector.mjs createEdgeDecision and scans the hysteresis rule over it; the
// selected / confirmed point is then run through createEdgeDecision itself,
// and the two must agree exactly. On the dev half, before any detector output,
// every stream's voiced grid frames must equal round 1's
// (build/resonance-narrowband/feat/) exactly (R3.4). Writes
// build/resonance-narrowband/sweep-r3-<half>[-point].json and prints Markdown.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { N_SUB, createEdgeDecision } from "./detector.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../build/resonance-narrowband");
const FEAT = path.join(OUT, "feat3");
const FEAT1 = path.join(OUT, "feat");
const arg = (k, d = null) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const HALF = arg("half");
const POINT = arg("point");
if (!["dev", "held"].includes(HALF)) { console.error("--half=dev|held"); process.exit(2); }

const GRID = {
  feature: ["E1", "E2"],
  tau: [4, 8],
  vmin: [3, 5],
  hyst: [3, 6],
  ton: Array.from({ length: 41 }, (_, i) => -40 + i),
};
const POS = ["tel", "amrnb", "g711u", "opus8nb", "btnb"]; // judged (rounds 2 and 3)
const DESC = ["lp4k"]; // reported only: not judged, not used in selection
const NEG_BAR = 0.01, POS_BAR = 0.95, DETECT_FRAMES = 1000;

// ---- split (as conditions.py): within sex, numeric LibriSpeech id, even ranks = dev
const streamsJson = JSON.parse(readFileSync(path.join(OUT, "streams.json"), "utf8")).streams;
const half = {};
for (const sx of ["f", "m"]) {
  streamsJson.filter((s) => s.sex === sx).sort((a, b) => +a.speaker.slice(2) - +b.speaker.slice(2))
    .forEach((s, i) => { half[s.speaker] = i % 2 === 0 ? "dev" : "held"; });
}

// ---- reading feat3 records: per stream header [k, gridFrames, voicedFrames],
// then rows [j, p0 .. p31]
const W = 1 + N_SUB;
function readRec(cond, f) {
  const rec = JSON.parse(readFileSync(path.join(FEAT, cond, f), "utf8"));
  const b = readFileSync(path.join(FEAT, cond, f.replace(".json", ".f64")));
  return { rec, a: new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8) };
}
function eachStream(rec, a, cond, cb) {
  let o = 0;
  for (const ver of rec.order) {
    const k = a[o], nv = a[o + 2];
    if (rec.order[k] !== ver) throw new Error(`order mismatch ${cond} ${rec.spk}`);
    o += 3;
    cb(ver, nv, o);
    o += W * nv;
  }
  if (o !== a.length) throw new Error(`trailing data ${cond} ${rec.spk}`);
}
// round 1 voiced grid indices, for the same-frames check (dev only)
function round1Frames(cond, spk) {
  const p = path.join(FEAT1, cond, `${spk}.f64`);
  if (!existsSync(p)) return null;
  const rec = JSON.parse(readFileSync(p.replace(".f64", ".json"), "utf8"));
  const b = readFileSync(p);
  const a = new Float64Array(b.buffer, b.byteOffset, b.byteLength / 8);
  const by = {};
  let o = 0;
  for (const ver of rec.order) {
    const grid = a[o + 1], nv = a[o + 2];
    o += 3;
    const j = new Float64Array(nv);
    for (let i = 0; i < nv; i++) j[i] = a[o + 5 * i];
    o += 5 * nv;
    by[ver] = { grid, j };
  }
  return by;
}

// ---- load: per stream the four E tracks (feature x tau) via the module; the
// sub-band rows are not kept (runModuleAll re-reads them)
const conds = readdirSync(FEAT).filter((c) => existsSync(path.join(FEAT, c)));
const streams = []; // {cond, pos, desc, spk, sex, ver, n, tr: {"E1/4": Float64Array, ...}, file, ...}
const check = { streams: 0, same: 0, missing: 0, diff: [] };
const p32 = new Float64Array(N_SUB);
for (const cond of conds) {
  for (const f of readdirSync(path.join(FEAT, cond)).filter((f) => f.endsWith(".json"))) {
    const { rec, a } = readRec(cond, f);
    if (half[rec.spk] !== HALF) continue;
    const r1 = HALF === "dev" ? round1Frames(cond, rec.spk) : null;
    eachStream(rec, a, cond, (ver, nv, o) => {
      const m = rec.versions[ver];
      if (HALF === "dev") {
        check.streams++;
        const q = r1?.[ver];
        if (!q) check.missing++;
        else {
          let same = q.j.length === nv && q.grid === m.gridFrames;
          for (let i = 0; same && i < nv; i++) same = q.j[i] === a[o + W * i];
          if (same) check.same++; else check.diff.push(`${cond}/${rec.spk}/${ver}`);
        }
      }
      const tr = {};
      for (const ft of GRID.feature) for (const tau of GRID.tau) {
        const d = createEdgeDecision({ feature: ft, tauS: tau, vMinS: 1e9, hystDb: 0, tOnDb: -Infinity });
        const t = new Float64Array(nv);
        for (let i = 0; i < nv; i++) {
          for (let q = 0; q < N_SUB; q++) p32[q] = a[o + W * i + 1 + q];
          t[i] = d.push(p32).e;
        }
        tr[`${ft}/${tau}`] = t;
      }
      streams.push({ cond, pos: POS.includes(cond), desc: DESC.includes(cond), spk: rec.spk, sex: rec.sex, ver, n: nv, tr,
        file: [cond, f], audioS: m.audioS, detMs: m.detMs, gridFrames: m.gridFrames, framesDropped: m.framesDropped });
    });
  }
}
const condList = [...new Set(streams.map((s) => s.cond))].sort();
const negConds = condList.filter((c) => !POS.includes(c) && !DESC.includes(c));
const posConds = condList.filter((c) => POS.includes(c));
const descConds = condList.filter((c) => DESC.includes(c));
if (posConds.length !== POS.length) throw new Error(`missing positive conditions: ${POS.filter((c) => !posConds.includes(c))}`);
console.error(`${HALF}: ${streams.length} streams, ${condList.length} conditions (${posConds.length} positive, ${descConds.length} descriptive)`);
if (HALF === "dev") {
  console.log(`Same-frames check vs round 1: ${check.same}/${check.streams} streams identical (missing in round 1: ${check.missing}; differing: ${check.diff.length}${check.diff.length ? ` — ${check.diff.slice(0, 5).join(", ")}` : ""})\n`);
  if (check.same !== check.streams) { console.error("same-frames check failed: stopping before any detector output"); process.exit(1); }
}

// ---- hysteresis scan = createEdgeDecision's rule on a precomputed E track
function scan(f, nMin, tOn, tOff) {
  let on = false, onFrames = 0, firstOn = -1;
  for (let i = nMin - 1; i < f.length; i++) {
    if (!on && f[i] < tOn) { on = true; if (firstOn < 0) firstOn = i; }
    else if (on && f[i] > tOff) on = false;
    if (on) onFrames++;
  }
  return [onFrames, firstOn];
}
// the module itself, for the selected / confirmed point (re-reads the sub-band rows)
function runModuleAll(p) {
  const byFile = new Map();
  streams.forEach((s, k) => {
    const key = s.file.join("/");
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(k);
  });
  const res = new Array(streams.length);
  for (const ks of byFile.values()) {
    const [cond, f] = streams[ks[0]].file;
    const { rec, a } = readRec(cond, f);
    const idx = new Map(ks.map((k) => [streams[k].ver, k]));
    eachStream(rec, a, cond, (ver, nv, o) => {
      const d = createEdgeDecision({ feature: p.feature, tauS: p.tau, vMinS: p.vmin, hystDb: p.hyst, tOnDb: p.ton });
      let onFrames = 0, firstOn = -1;
      for (let i = 0; i < nv; i++) {
        for (let q = 0; q < N_SUB; q++) p32[q] = a[o + W * i + 1 + q];
        if (d.push(p32).on) { onFrames++; if (firstOn < 0) firstOn = i; }
      }
      res[idx.get(ver)] = [onFrames, firstOn];
    });
  }
  return res;
}

// ---- metrics for one point from per-stream [onFrames, firstOn] (as sweep.mjs)
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

// ---- E at the end of each stream (for the chosen feature, tau)
function eDist(feature, tau) {
  const by = {};
  for (const s of streams) {
    const f = s.tr[`${feature}/${tau}`];
    const c = (by[`${s.cond}|${s.sex}`] ??= { end: [] });
    if (f.length) c.end.push(f[f.length - 1]);
  }
  return by;
}

function report(p, m, label) {
  const lines = [];
  lines.push(`### ${label}: feature ${p.feature}, τ ${p.tau} s, V_min ${p.vmin} s, H ${p.hyst} dB, T_on ${p.ton} dB — ${m.pass ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push(`Worst negative: ${pct(m.worstNeg)} (${m.worstNegKey}); clean streams with the notice: ${m.cleanAny}; worst positive detection: ${pct(m.worstPos)} (${m.worstPosKey}).`);
  lines.push("");
  const fd = eDist(p.feature, p.tau);
  const mn = (a) => (a.length ? Math.min(...a).toFixed(1) : "—");
  const mx = (a) => (a.length ? Math.max(...a).toFixed(1) : "—");
  const md = (a) => (a.length ? q(a, 0.5).toFixed(1) : "—");
  lines.push("Negatives (wideband): notice-on share of voiced time (bar ≤ 1 %), streams with any notice, E at stream end (dB, min / median)");
  lines.push("");
  lines.push("| Condition | women share | women streams on | men share | men streams on | E end women min / med | E end men min / med |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const c of negConds) {
    const w = m.neg[`${c}|f`], mm = m.neg[`${c}|m`];
    const fw = fd[`${c}|f`]?.end ?? [], fm = fd[`${c}|m`]?.end ?? [];
    lines.push(`| ${c} | ${pct(w?.share)} | ${w?.streamsWithOn}/${w?.streams} | ${pct(mm?.share)} | ${mm?.streamsWithOn}/${mm?.streams} | ${mn(fw)} / ${md(fw)} | ${mn(fm)} / ${md(fm)} |`);
  }
  lines.push("");
  lines.push("Positives (the five phone paths, judged): detected by 10 s voiced (bar ≥ 95 %), time to notice (voiced s, median / q90), dropouts after first notice, E at stream end (dB, median / max)");
  lines.push("");
  lines.push("| Condition | women detected | men detected | women time med / q90 | men time med / q90 | women dropouts | men dropouts | E end women med / max | E end men med / max |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const c of [...posConds, ...descConds]) {
    const src = DESC.includes(c) ? m.desc : m.pos;
    const w = src[`${c}|f`], mm = src[`${c}|m`];
    const fw = fd[`${c}|f`]?.end ?? [], fm = fd[`${c}|m`]?.end ?? [];
    const tt = (x) => (x?.tts.length ? `${q(x.tts, 0.5).toFixed(2)} / ${q(x.tts, 0.9).toFixed(2)}` : "—");
    const dr = (x) => (x?.after ? pct(x.drop / x.after) : "—");
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

const out = { half: HALF, nStreams: streams.length, conditions: condList, cost, sameFramesCheck: HALF === "dev" ? check : null };

if (POINT) {
  const [feature, tau, vmin, hyst, ton] = POINT.split(",");
  const p = { feature, tau: +tau, vmin: +vmin, hyst: +hyst, ton: +ton };
  const m = metrics(runModuleAll(p));
  out.point = p;
  out.metrics = m;
  console.log(report(p, m, `Confirmation (${HALF})`));
} else {
  // ---- grid
  const rows = [];
  for (const feature of GRID.feature) {
    for (const tau of GRID.tau) {
      const tracks = streams.map((s) => s.tr[`${feature}/${tau}`]);
      for (const vmin of GRID.vmin) {
        const nMin = Math.round(vmin / 0.01);
        for (const hyst of GRID.hyst) {
          for (const ton of GRID.ton) {
            const m = metrics(tracks.map((f) => scan(f, nMin, ton, ton + hyst)));
            rows.push({ feature, tau, vmin, hyst, ton, worstNeg: m.worstNeg, worstNegKey: m.worstNegKey,
              cleanAny: m.cleanAny, worstPos: m.worstPos, worstPosKey: m.worstPosKey, pass: m.pass });
          }
        }
      }
      console.error(`feature ${feature} tau ${tau} done`);
    }
  }
  out.grid = rows;
  const passing = rows.filter((r) => r.pass);
  console.log(`## Dev grid: ${rows.length} points, ${passing.length} pass both bars\n`);
  console.log("| Feature | τ | V_min | H | passing T_on (dB) | n |");
  console.log("|---|---|---|---|---|---|");
  for (const feature of GRID.feature) for (const tau of GRID.tau) for (const vmin of GRID.vmin) for (const hyst of GRID.hyst) {
    const t = passing.filter((r) => r.feature === feature && r.tau === tau && r.vmin === vmin && r.hyst === hyst).map((r) => r.ton);
    console.log(`| ${feature} | ${tau} | ${vmin} | ${hyst} | ${t.length ? `${Math.min(...t)} … ${Math.max(...t)}` : "none"} | ${t.length} |`);
  }
  if (!passing.length) {
    const best = [...rows].sort((a, b) => (Math.max(a.worstNeg / NEG_BAR, (1 - a.worstPos) / (1 - POS_BAR)) - Math.max(b.worstNeg / NEG_BAR, (1 - b.worstPos) / (1 - POS_BAR))));
    console.log("\nNo grid point passes on dev. Closest points (worst negative share / worst positive detection):\n");
    for (const r of best.slice(0, 10)) console.log(`- ${r.feature} τ${r.tau} V${r.vmin} H${r.hyst} T${r.ton}: neg ${pct(r.worstNeg)} (${r.worstNegKey}), clean ${r.cleanAny}, pos ${pct(r.worstPos)} (${r.worstPosKey})`);
    out.selected = null;
  } else {
    // selection (plan §4, R3.5): lowest worst negative share, then largest
    // worst-sex positive detection, then larger H, then shorter V_min; then the
    // (feature, tau) with the longest contiguous run of tied T_on values,
    // shorter tau, E1 before E2; T_on at the lower middle of that run.
    const minNeg = Math.min(...passing.map((r) => r.worstNeg));
    let c = passing.filter((r) => r.worstNeg === minNeg);
    const maxPos = Math.max(...c.map((r) => r.worstPos));
    c = c.filter((r) => r.worstPos === maxPos);
    const maxH = Math.max(...c.map((r) => r.hyst));
    c = c.filter((r) => r.hyst === maxH);
    const minV = Math.min(...c.map((r) => r.vmin));
    c = c.filter((r) => r.vmin === minV);
    const runs = [];
    for (const feature of GRID.feature) for (const tau of GRID.tau) {
      const t = c.filter((r) => r.feature === feature && r.tau === tau).map((r) => r.ton).sort((a, b) => a - b);
      let i = 0;
      while (i < t.length) {
        let j = i;
        while (j + 1 < t.length && t[j + 1] === t[j] + 1) j++;
        runs.push({ feature, tau, lo: t[i], hi: t[j], len: j - i + 1 });
        i = j + 1;
      }
    }
    runs.sort((a, b) => b.len - a.len || a.tau - b.tau || a.feature.localeCompare(b.feature));
    const r = runs[0];
    const ton = r.lo + Math.floor((r.len - 1) / 2);
    const p = { feature: r.feature, tau: r.tau, vmin: minV, hyst: maxH, ton };
    out.selection = { minNeg, maxPos, maxH, minV, runs };
    out.selected = p;
    console.log(`\nSelection: ${c.length} points tie on (worst negative ${pct(minNeg)}, worst positive ${pct(maxPos)}, H ${maxH}, V_min ${minV}); runs: ${runs.map((x) => `${x.feature}/τ${x.tau} ${x.lo}…${x.hi}`).join("; ")}`);
    // exact check: module vs scan at the selected point
    const viaScan = streams.map((s) => scan(s.tr[`${p.feature}/${p.tau}`], Math.round(p.vmin / 0.01), p.ton, p.ton + p.hyst));
    const viaMod = runModuleAll(p);
    const same = viaScan.every((x, k) => x[0] === viaMod[k][0] && x[1] === viaMod[k][1]);
    console.log(`Module vs scan at the selected point: ${same ? "identical" : "MISMATCH"}\n`);
    if (!same) process.exitCode = 1;
    const m = metrics(viaMod);
    out.metrics = m;
    console.log(report(p, m, "Selected (dev)"));
  }
}
console.log(`\nDetector cost: ${cost.msPerAudioS.toFixed(3)} ms CPU per second of audio (32 sub-band powers incl. the lazy 16 kHz samples they read; ${cost.streams} streams, ${cost.audioMin.toFixed(0)} min); pitch frames dropped by the engine: ${cost.framesDropped}`);
writeFileSync(path.join(OUT, `sweep-r3-${HALF}${POINT ? "-point" : ""}.json`), JSON.stringify(out, (k, v) => (k === "tts" ? undefined : v)));
