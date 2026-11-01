// hold-report.mjs — the resonance row hold (measurements/
// resonance-row-hold-2026-10-28.md), stage 3 of 3: targets T1 / T2 on speech
// and guards G1–G4, BASE vs CAND, from pause-report.mjs stripReplay (the
// SHIPPED cue-strip model: arm "act" = BASE, arm "cand" = createResonanceHold
// wired as CueStrip.jsx wires it) over the real hook's flags (pause-row.mjs)
// and the resonance posts (chain.mjs).
//
//   node scripts/resonance/mobile/hold-report.mjs [--speech-runs=build/resonance-mobile/pause/runs]
//        [--speech-hook=build/resonance-mobile/pause/hook] [--noise-runs=build/resonance-mobile/hold/runs]
//        [--noise-hook=build/resonance-mobile/hold/hook] [--json=build/resonance-mobile/hold/summary.json]
//        [--md=build/resonance-mobile/hold/tables.md]
//
// Speech: the planned conditions (none; brown / pink / real AC at -55 / -50 /
// -48 / -40 dBFS pause floors), 12 readers, window 20-150 s. Noise only: the
// real-noise clips at each level (RN_m48, RN_m40), whole 60 s streams.
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripReplay, windowMetrics, pausesFromClean, pauseMetrics, pauseFloor } from "./pause-report.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const R_ = (p) => path.resolve(repo, p);
const SPEECH_RUNS = R_(arg("speech-runs", "build/resonance-mobile/pause/runs"));
const SPEECH_HOOK = R_(arg("speech-hook", "build/resonance-mobile/pause/hook"));
const NOISE_RUNS = R_(arg("noise-runs", "build/resonance-mobile/hold/runs"));
const NOISE_HOOK = R_(arg("noise-hook", "build/resonance-mobile/hold/hook"));
const FROM = 20;
const SPEECH_CONDS = ["clean", ...["brown", "pink", "ac"].flatMap((f) => [55, 50, 48, 40].map((m) => `${f}_m${m}`))];
const STATES = ["starting", "restarting", "reload", "unavailable", "paused", "narrowband", "idle", "sustained", "warming", "settling", "holding", "live"];
const IDLE = STATES.indexOf("idle");

const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const sum = (a) => a.reduce((x, y) => x + y, 0);
const f1 = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
const sg = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);

function loadJsonl(dir, re) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => re.test(f)).flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean)
    .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }));
}
function chainIndex(runsDir, conds) {
  const m = new Map();
  for (const c of conds) for (const r of loadJsonl(path.join(runsDir, c), /^runs-.*\.jsonl$/)) if (r.gate === "on") m.set(`${c}|${r.id}`, r);
  return m;
}

// Per-stream guards G2-G4: render points (25 ms grid) and ticks.
function guards(R, { kFrom, kTo }) {
  const a = R.arms.act, c = R.arms.cand;
  const g = { pts: 0, uBoth: 0, uDiff: 0, pitchDiff: 0, resDiff: 0, resDiffNotIdle: 0, thumbDiff: 0, thumbDiffNotIdle: 0, ticks: 0, tickPitchDiff: 0, tickResDiffNotIdle: 0 };
  for (let k = kFrom; k < kTo; k++) {
    g.pts++;
    if (a.thumb[k] && c.thumb[k]) { g.uBoth++; if (a.thumbU[k] !== c.thumbU[k]) g.uDiff++; }
    if (a.ps[k] !== c.ps[k]) g.pitchDiff++;
    if (a.rs[k] !== c.rs[k]) { g.resDiff++; if (a.rs[k] !== IDLE) g.resDiffNotIdle++; }
    if (a.thumb[k] !== c.thumb[k]) { g.thumbDiff++; if (a.rs[k] !== IDLE) g.thumbDiffNotIdle++; }
  }
  const t0 = (kFrom + 1) * 0.025, t1 = kTo * 0.025;
  for (let i = 0; i < a.ticks.length; i++) {
    const x = a.ticks[i], y = c.ticks[i];
    if (x.t < t0 || x.t > t1) continue;
    g.ticks++;
    if (x.pstate !== y.pstate) g.tickPitchDiff++;
    if (x.rstate !== y.rstate && x.rstate !== "idle") g.tickResDiffNotIdle++;
  }
  return g;
}
const addG = (acc, g) => { for (const [k, v] of Object.entries(g)) acc[k] = (acc[k] ?? 0) + v; return acc; };

// ---- speech
const speechHooks = loadJsonl(SPEECH_HOOK, /^hook-.*\.jsonl$/).filter((h) => SPEECH_CONDS.includes(h.cond));
const speechChain = chainIndex(SPEECH_RUNS, SPEECH_CONDS);
const cleanBy = new Map();
const cleanOf = (id) => {
  if (!cleanBy.has(id)) { const f = path.join(SPEECH_RUNS, "clean", "pitch", `${id}.json`); cleanBy.set(id, existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).byChunk : null); }
  return cleanBy.get(id);
};
const speech = [];
const gSpeech = {};
for (const h of speechHooks) {
  const cr = speechChain.get(`${h.cond}|${h.id}`);
  if (!cr) throw new Error(`no chain record ${h.cond} ${h.id}`);
  const R = stripReplay(h, cr, { from: FROM });
  const kFrom = R.kFrom, kTo = R.n;
  const pauses = pausesFromClean(cleanOf(h.id));
  const row = { cond: h.cond, id: h.id, sex: h.sex, floor: pauseFloor(h, cleanOf(h.id), pauses, { kFrom }) };
  for (const arm of ["act", "cand"]) {
    const w = windowMetrics(R, arm, { kFrom, kTo });
    const t0 = (kFrom + 1) * 0.025;
    const tk = R.arms[arm].ticks.filter((x) => x.t >= t0 && x.t <= kTo * 0.025);
    row[arm] = {
      w, pauses: pauseMetrics(R, arm, pauses, { kFrom }),
      trailSum: sum(tk.map((x) => x.trailLen)), ticks: tk.length,
      agesFull: tk.filter((x) => x.trailLen === 15).map((x) => x.ageS),
      ages2: tk.filter((x) => x.trailLen >= 2).map((x) => x.ageS),
    };
  }
  row.g = guards(R, { kFrom, kTo });
  addG(gSpeech, row.g);
  speech.push(row);
}

// ---- noise only
const noiseHooks = loadJsonl(NOISE_HOOK, /^hook-.*\.jsonl$/);
const noiseConds = [...new Set(noiseHooks.map((h) => h.cond))].sort();
const noiseChain = chainIndex(NOISE_RUNS, noiseConds);
const noise = [];
const gNoise = {};
for (const h of noiseHooks) {
  const cr = noiseChain.get(`${h.cond}|${h.id}`);
  if (!cr) throw new Error(`no chain record ${h.cond} ${h.id}`);
  const R = stripReplay(h, cr, { from: 0 });
  const kFrom = 0, kTo = R.n;
  const row = { cond: h.cond, level: -Number(h.cond.split("_m")[1]), id: h.id, cls: cr.cls, source: cr.source, n: kTo,
    voicedPct: (100 * cr.pitchStats.voiced) / cr.pitchStats.hops, shownPct: (100 * (cr.pitchStats.voiced - cr.pitchStats.hidden)) / cr.pitchStats.hops };
  const v = h.inten.filter((x) => x != null).map((x) => (x === -999 ? -Infinity : x)).sort((a, b) => a - b);
  row.dspMedDb = v[v.length >> 1];
  for (const arm of ["act", "cand"]) {
    const w = windowMetrics(R, arm, { kFrom, kTo });
    row[arm] = { notIdle: w.notIdlePct, warming: w.warmingPct, thumb: w.thumbPct, idle: w.idlePct };
  }
  row.g = guards(R, { kFrom, kTo });
  addG(gNoise, row.g);
  noise.push(row);
}

// ---- tables
const L = [];
const P = (s) => L.push(s);
const NAME = (c) => (c === "clean" ? "none (no added noise)" : `${c.startsWith("ac") ? "real AC" : c.split("_")[0]} −${c.split("_m")[1]}`);
const verdict = { T1: true, T2: true, G1: true, G2: true, G3: true, G4: true };
P(`Speech streams: ${speech.length} (${SPEECH_CONDS.length} conditions); noise-only streams: ${noise.length} (${noiseConds.join(", ")}).`);
P("");
P("### T1 / T2 — speech, pooled over the readers (window 20–150 s)");
P("");
P("| condition | sex | readers | pause floor (DSP, median) | mean trail BASE | CAND | 1–5 s pauses: thumb gone BASE | CAND | pauses 1–5 s (n) | 0.3–1 s: thumb gone BASE | CAND | row idle % BASE | CAND | trail clears / min BASE | CAND | ticks with a streak (448×890) BASE | CAND | (360×690) BASE | CAND |");
P("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
const tRows = [];
for (const c of SPEECH_CONDS) for (const [sx, sl] of [[null, "all"], ["m", "men"], ["f", "women"]]) {
  const rr = speech.filter((x) => x.cond === c && (!sx || x.sex === sx));
  if (!rr.length) continue;
  const trail = (a) => sum(rr.map((x) => x[a].trailSum)) / sum(rr.map((x) => x[a].ticks));
  const gone = (a, cl) => { const n = sum(rr.map((x) => x[a].pauses[cl].n)); return { n, pct: n ? (100 * sum(rr.map((x) => x[a].pauses[cl].gone))) / n : null }; };
  const wm = (a, k) => { const tw = rr.map((x) => x[a].w.sec); return sum(rr.map((x, i) => x[a].w[k] * tw[i])) / sum(tw); };
  const tk = (a, k) => sum(rr.map((x) => (x[a].w[k] * x[a].w.ticks) / 100)) / sum(rr.map((x) => x[a].w.ticks)) * 100;
  const floor = q(rr.map((x) => x.floor.medDb), 0.5);
  const r = { c, sl, n: rr.length, floor, trailA: trail("act"), trailC: trail("cand"), midA: gone("act", "mid"), midC: gone("cand", "mid"), shortA: gone("act", "short"), shortC: gone("cand", "short") };
  if (!sx) { tRows.push(r); if (!(r.trailC >= 10)) verdict.T1 = false; if (!(r.midC.pct <= 5)) verdict.T2 = false; }
  P(`| ${NAME(c)} | ${sl} | ${rr.length} | ${f1(floor)} | ${f1(r.trailA)} | **${f1(r.trailC)}** | ${f1(r.midA.pct)} % | **${f1(r.midC.pct)} %** | ${r.midC.n} | ${f1(r.shortA.pct)} % | ${f1(r.shortC.pct)} % | ${f1(wm("act", "idlePct"))} | ${f1(wm("cand", "idlePct"))} | ${f1(wm("act", "clearsPerMin"))} | ${f1(wm("cand", "clearsPerMin"))} | ${f1(tk("act", "streakPct448"))} | ${f1(tk("cand", "streakPct448"))} | ${f1(tk("act", "streakPct360"))} | ${f1(tk("cand", "streakPct360"))} |`);
}
P("");
P(`T1 (mean trail >= 10 points at every condition): ${verdict.T1 ? "PASS" : "FAIL"} — CAND min ${f1(Math.min(...tRows.map((r) => r.trailC)))} points.`);
P(`T2 (thumb gone in <= 5 % of 1–5 s pauses at every condition): ${verdict.T2 ? "PASS" : "FAIL"} — CAND max ${f1(Math.max(...tRows.map((r) => r.midC.pct)))} %.`);
P("");
P("### Streak span — the wall-clock age of the oldest trail point (s), speech window 20–150 s");
P("");
P("| condition | arm | ticks with a full trail (15 points) % | full trail: median age [q10–q90] | ticks with >= 2 points: median age [q10–q90] |");
P("|---|---|---|---|---|");
for (const c of SPEECH_CONDS) for (const a of ["act", "cand"]) {
  const rr = speech.filter((x) => x.cond === c);
  const full = rr.flatMap((x) => x[a].agesFull), two = rr.flatMap((x) => x[a].ages2), nt = sum(rr.map((x) => x[a].ticks));
  P(`| ${NAME(c)} | ${a === "act" ? "BASE" : "CAND"} | ${f1((100 * full.length) / nt)} | ${f1(q(full, 0.5))} [${f1(q(full, 0.1))}–${f1(q(full, 0.9))}] | ${f1(q(two, 0.5))} [${f1(q(two, 0.1))}–${f1(q(two, 0.9))}] |`);
}
P("");
// G1
P("### G1 — noise only, real-noise set (whole 60 s streams, the app replay)");
P("");
const g1 = {};
for (const cond of noiseConds) {
  const rr = noise.filter((x) => x.cond === cond);
  const pool = (r, a, k) => sum(r.map((x) => x[a][k] * x.n)) / sum(r.map((x) => x.n));
  const d = rr.map((x) => x.cand.thumb - x.act.thumb);
  const worst = rr.reduce((m, x) => (x.cand.thumb - x.act.thumb > (m ? m.cand.thumb - m.act.thumb : -Infinity) ? x : m), null);
  const res = {
    n: rr.length, notIdleA: pool(rr, "act", "notIdle"), notIdleC: pool(rr, "cand", "notIdle"), thumbA: pool(rr, "act", "thumb"), thumbC: pool(rr, "cand", "thumb"),
    warmA: pool(rr, "act", "warming"), warmC: pool(rr, "cand", "warming"), maxD: Math.max(...d), worst: worst?.id,
  };
  res.pass = res.thumbC <= res.thumbA + 1.0 && res.notIdleC <= res.notIdleA + 2.0 && res.maxD <= 15;
  if (!res.pass) verdict.G1 = false;
  const nb = rr.filter((x) => x.cls !== "public / cafe");
  res.noBabble = { n: nb.length, notIdleA: pool(nb, "act", "notIdle"), notIdleC: pool(nb, "cand", "notIdle"), thumbA: pool(nb, "act", "thumb"), thumbC: pool(nb, "cand", "thumb") };
  g1[cond] = res;
  P(`**${cond} (median 50 ms level ${cond.replace("RN_m", "−")} dBFS), ${rr.length} clips:** not idle BASE ${f1(res.notIdleA, 2)} % → CAND ${f1(res.notIdleC, 2)} % (${sg(res.notIdleC - res.notIdleA, 2)} points; bar +2.0); thumb drawn ${f1(res.thumbA, 2)} % → ${f1(res.thumbC, 2)} % (${sg(res.thumbC - res.thumbA, 2)}; bar +1.0); "keep talking…" ${f1(res.warmA, 2)} → ${f1(res.warmC, 2)} %; largest single-clip thumb increase ${sg(res.maxD)} points (${res.worst}; bar +15) — **${res.pass ? "PASS" : "FAIL"}**. Without the public / café class (${nb.length} clips, information): not idle ${f1(res.noBabble.notIdleA, 2)} → ${f1(res.noBabble.notIdleC, 2)} %, thumb ${f1(res.noBabble.thumbA, 2)} → ${f1(res.noBabble.thumbC, 2)} %.`);
  P("");
  P("| class | clips | DSP level median | posted voiced % | shown voiced % | not idle BASE | CAND | Δ | thumb BASE | CAND | Δ | keep talking… BASE | CAND | clips with Δthumb > 0 | max Δthumb |");
  P("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const classes = [...new Set(rr.map((x) => x.cls))].sort();
  for (const cl of [...classes, null]) {
    const r = cl ? rr.filter((x) => x.cls === cl) : rr;
    const a = pool(r, "act", "notIdle"), b = pool(r, "cand", "notIdle"), ta = pool(r, "act", "thumb"), tb = pool(r, "cand", "thumb");
    const dd = r.map((x) => x.cand.thumb - x.act.thumb);
    P(`| ${cl ?? "**all**"} | ${r.length} | ${f1(q(r.map((x) => x.dspMedDb), 0.5))} | ${f1(sum(r.map((x) => x.voicedPct)) / r.length)} | ${f1(sum(r.map((x) => x.shownPct)) / r.length)} | ${f1(a, 2)} | ${f1(b, 2)} | ${sg(b - a, 2)} | ${f1(ta, 2)} | ${f1(tb, 2)} | ${sg(tb - ta, 2)} | ${f1(pool(r, "act", "warming"), 2)} | ${f1(pool(r, "cand", "warming"), 2)} | ${dd.filter((x) => x > 0).length} | ${sg(Math.max(...dd))} |`);
  }
  P("");
  for (const src of [...new Set(rr.map((x) => x.source))].sort()) {
    const r = rr.filter((x) => x.source === src);
    P(`- ${src}: ${r.length} clips, not idle ${f1(pool(r, "act", "notIdle"), 2)} → ${f1(pool(r, "cand", "notIdle"), 2)} %, thumb ${f1(pool(r, "act", "thumb"), 2)} → ${f1(pool(r, "cand", "thumb"), 2)} %.`);
  }
  const newOnly = rr.filter((x) => x.act.thumb === 0 && x.cand.thumb > 0).length;
  const newRow = rr.filter((x) => x.act.notIdle === 0 && x.cand.notIdle > 0).length;
  P(`- Clips where CAND draws a thumb but BASE never does: ${newOnly}; where CAND leaves idle but BASE never does: ${newRow}. Clips with any BASE thumb: ${rr.filter((x) => x.act.thumb > 0).length}; pooled thumb time CAND / BASE ${f1(res.thumbC / res.thumbA, 2)}.`);
  P("");
  const top = [...rr].sort((x, y) => (y.cand.notIdle - y.act.notIdle) - (x.cand.notIdle - x.act.notIdle)).slice(0, 8);
  P(`Largest not-idle increases: ${top.map((x) => `${x.id} (${x.cls}) ${sg(x.cand.notIdle - x.act.notIdle)} / thumb ${sg(x.cand.thumb - x.act.thumb)}`).join("; ")}.`);
  P("");
}
if (!noiseConds.length) { verdict.G1 = false; P("G1: no noise-only runs found."); P(""); }
// G2-G4
P("### G2–G4 — every render point (25 ms) and tick");
P("");
const G = (g, label) => {
  P(`- ${label}: render points ${g.pts}, ticks ${g.ticks}. G2 thumb u differs where both draw: ${g.uDiff} of ${g.uBoth}. G3 pitch row differs: ${g.pitchDiff} render points, ${g.tickPitchDiff} ticks. G4 resonance state differs where BASE is not idle: ${g.resDiffNotIdle} render points, ${g.tickResDiffNotIdle} ticks; thumb differs where BASE is not idle: ${g.thumbDiffNotIdle} (state differs where BASE is idle: ${g.resDiff - g.resDiffNotIdle}).`);
};
G(gSpeech, "Speech");
G(gNoise, "Noise only");
if (gSpeech.uDiff || gNoise.uDiff) verdict.G2 = false;
if (gSpeech.pitchDiff || gSpeech.tickPitchDiff || gNoise.pitchDiff || gNoise.tickPitchDiff) verdict.G3 = false;
if (gSpeech.resDiffNotIdle || gSpeech.tickResDiffNotIdle || gSpeech.thumbDiffNotIdle) verdict.G4 = false;
P("");
P(`Verdict: T1 ${verdict.T1 ? "PASS" : "FAIL"}, T2 ${verdict.T2 ? "PASS" : "FAIL"}, G1 ${verdict.G1 ? "PASS" : "FAIL"}, G2 ${verdict.G2 ? "PASS" : "FAIL"}, G3 ${verdict.G3 ? "PASS" : "FAIL"}, G4 ${verdict.G4 ? "PASS" : "FAIL"} (G5: lint / tests / build / smokes, run separately).`);
const md = L.join("\n");
console.log(md);
const jsonOut = R_(arg("json", "build/resonance-mobile/hold/summary.json"));
mkdirSync(path.dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, JSON.stringify({ verdict, g1, gSpeech, gNoise, tRows, noise: noise.map(({ g, ...x }) => x) }, null, 1));
writeFileSync(R_(arg("md", "build/resonance-mobile/hold/tables.md")), md);
