// narrow-review-info.mjs — information added in the review of the narrower
// resonance-row hold round (measurements/resonance-row-hold-narrow-2026-11-01.md
// "Review and fixes"; no bar, after the verdict). Over the real-noise streams
// of one set (cold start and after speech, gate on), BASE and the confirmed
// pick K4 through pause-report.mjs stripReplay, exactly as narrow-report.mjs:
//   1. nominal timing — must equal the report's per-stream rows (checked);
//   2. the tickJitterMs 150 and arrival40 options (the plan ran them on dev
//      speech only): K4 − BASE drawn per cell (level × mode × screen class),
//      the worst clip, and whether every §9 bar holds under that option;
//   3. the screen class split by metadata family (nominal).
//
//   node --max-old-space-size=4096 scripts/resonance/mobile/narrow-review-info.mjs [--set=dev|fresh]
//
// Inputs (defaults per set) are the report's: fresh = the confirmation's cold
// start (build/resonance-mobile/narrow/confirm/hold/) and after-speech
// (runs-fresh / hook-fresh) records; dev = build/resonance-mobile/hold/runs,
// narrow/hook-cold, runs-dev / hook-dev. Reads report-<set>.json for the check.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const R_ = (p) => path.resolve(repo, p);
const SET = arg("set", "fresh");
const DEF = {
  fresh: { coldRuns: "build/resonance-mobile/narrow/confirm/hold/runs", coldHook: "build/resonance-mobile/narrow/confirm/hold/hook",
    asRuns: "build/resonance-mobile/narrow/runs-fresh", asHook: "build/resonance-mobile/narrow/hook-fresh", report: "build/resonance-mobile/narrow/report-fresh.json" },
  dev: { coldRuns: "build/resonance-mobile/hold/runs", coldHook: "build/resonance-mobile/narrow/hook-cold",
    asRuns: "build/resonance-mobile/narrow/runs-dev", asHook: "build/resonance-mobile/narrow/hook-dev", report: "build/resonance-mobile/narrow/report-dev.json" },
}[SET];
if (!DEF) throw new Error(`--set=${SET}`);
const P = Object.fromEntries(Object.entries(DEF).map(([k, v]) => [k, R_(arg(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v))]));

const PR = await import(pathToFileURL(R_("scripts/resonance/mobile/pause-report.mjs")).href);
const NR = await import(pathToFileURL(R_("scripts/resonance/mobile/narrow-report.mjs")).href);
const CS = await import(pathToFileURL(R_("src/components/cueStripModel.js")).href);
const { stripReplay, STATES } = PR;
const IDLE = STATES.indexOf("idle"), START = STATES.indexOf("starting");
const cands = { K4: CS.RESONANCE_HOLD_CANDIDATES.K4 };
const screen = JSON.parse(readFileSync(R_("scripts/resonance/mobile/narrow-screen.json"), "utf8")).sets[SET];
const SCR = new Map(screen.clips.map((c) => [c.id, c]));
const report = JSON.parse(readFileSync(P.report, "utf8"));
const REP = new Map(report.noise.filter((x) => !x.ft).map((x) => [`${x.mode}|${x.level}|${x.id}`, x]));

function loadJsonl(dir, re) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => re.test(f)).flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean)
    .flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }));
}
const chainIndex = (runsDir, conds) => {
  const m = new Map();
  for (const c of conds) for (const r of loadJsonl(path.join(runsDir, c), /^runs-.*\.jsonl$/)) if (r.gate === "on") m.set(`${c}|${r.id}`, r);
  return m;
};
// narrow-report.mjs shares(): drawn (thumb) and not idle (neither idle nor starting) over [kA, kB)
function shares(R, key, kA, kB) {
  const A = R.arms[key];
  const o = { pts: 0, thumb: 0, notIdle: 0 };
  for (let k = kA; k < kB; k++) { o.pts++; if (A.thumb[k]) o.thumb++; if (A.rs[k] !== IDLE && A.rs[k] !== START) o.notIdle++; }
  return o;
}
const OPTS = { nominal: {}, jitter150: { tickJitterMs: 150 }, arrival40: { arrival40: true } };
const rows = [];
let checked = 0, badStreams = 0;
for (const [mode, runsDir, hookDir, conds] of [["cold", P.coldRuns, P.coldHook, ["RN_m48", "RN_m40"]], ["after", P.asRuns, P.asHook, ["AS_m48", "AS_m40"]]]) {
  const hooks = loadJsonl(hookDir, /^hook-.*\.jsonl$/).filter((h) => conds.includes(h.cond));
  const chain = chainIndex(runsDir, conds);
  for (const h of hooks) {
    const cr = chain.get(`${h.cond}|${h.id}`);
    if (!cr) throw new Error(`no chain record ${h.cond} ${h.id}`);
    const level = -Number(h.cond.split("_m")[1]);
    const scr = SCR.get(h.id);
    if (!scr) throw new Error(`${h.id} not in the screen`);
    const row = { mode, level, id: h.id, cls: scr.class, family: scr.family, opt: {} };
    for (const [name, opt] of Object.entries(OPTS)) {
      const R = stripReplay(h, cr, { from: 0, cands, ...opt });
      const kA = mode === "after" ? NR.afterFrom(cr.tLast) : 0;
      row.opt[name] = { BASE: shares(R, "act", kA, R.n), K4: shares(R, "K4", kA, R.n) };
    }
    const rep = REP.get(`${mode}|${level}|${h.id}`);
    checked++;
    if (!rep || ["BASE", "K4"].some((a) => ["pts", "thumb", "notIdle"].some((k) => rep.a[a][k] !== row.opt.nominal[a][k]))) badStreams++;
    rows.push(row);
  }
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
const pool = (rr, opt, arm, k) => (100 * sum(rr.map((x) => x.opt[opt][arm][k]))) / sum(rr.map((x) => x.opt[opt][arm].pts));
const excess = (x, opt) => (100 * x.opt[opt].K4.thumb) / x.opt[opt].K4.pts - (100 * x.opt[opt].BASE.thumb) / x.opt[opt].BASE.pts;
function cell(rr, opt, cls) {
  const bd = pool(rr, opt, "BASE", "thumb"), bn = pool(rr, opt, "BASE", "notIdle");
  const dd = pool(rr, opt, "K4", "thumb") - bd, dn = pool(rr, opt, "K4", "notIdle") - bn;
  const worst = rr.map((x) => ({ id: x.id, d: excess(x, opt) })).reduce((m, e) => (m == null || e.d > m.d ? e : m), null);
  const barD = cls === "talker" ? Math.max(1, 0.25 * bd) : 1, barN = cls === "talker" ? Math.max(2, 0.25 * bn) : 2;
  return { bd, dd, dn, worst, pass: dd <= barD && dn <= barN && worst.d <= 15 };
}
const f = (v, d = 2) => `${v >= 0 ? "+" : ""}${v.toFixed(d)}`;
console.log(`set ${SET}: ${rows.length} real-noise streams; nominal = the report's per-stream rows on ${checked - badStreams} / ${checked}`);
console.log(`\nK4 − BASE drawn, pooled, and the worst clip, per timing option (every §9 bar recomputed on that option's BASE)`);
console.log(`| cell | clips | nominal | tickJitter150 | arrival40 | all bars hold |`);
console.log(`|---|---|---|---|---|---|`);
for (const L of [-48, -40]) for (const mode of ["cold", "after"]) for (const cls of ["speech-free", "talker"]) {
  const rr = rows.filter((x) => x.level === L && x.mode === mode && x.cls === cls);
  const c = Object.fromEntries(Object.keys(OPTS).map((o) => [o, cell(rr, o, cls)]));
  console.log(`| ${cls} ${L === -48 ? "L1 −48" : "L2 −40"}, ${mode} | ${rr.length} | ${Object.keys(OPTS).map((o) => `${f(c[o].dd)} / ${f(c[o].worst.d)} (${c[o].worst.id})`).join(" | ")} | ${Object.keys(OPTS).every((o) => c[o].pass) ? "yes" : "NO"} |`);
}
console.log(`\nThe screen class by metadata family (nominal): K4 − BASE drawn, pooled`);
console.log(`| screen class | metadata family | clips | cold L1 | cold L2 | after L1 | after L2 | worst clip | BASE drawn |`);
console.log(`|---|---|---|---|---|---|---|---|---|`);
for (const cls of ["speech-free", "talker"]) for (const fam of ["speech-free", "talker"]) {
  const per = [], bases = [], worst = [];
  let n = 0;
  for (const [mode, L] of [["cold", -48], ["cold", -40], ["after", -48], ["after", -40]]) {
    const rr = rows.filter((x) => x.level === L && x.mode === mode && x.cls === cls && x.family === fam);
    n = rr.length;
    if (!rr.length) { per.push("—"); continue; }
    const c = cell(rr, "nominal", cls);
    per.push(f(c.dd)); bases.push(c.bd); worst.push(c.worst.d);
  }
  console.log(`| ${cls} | ${fam} | ${n} | ${per.join(" | ")} | ${worst.length ? f(Math.max(...worst)) : "—"} | ${bases.length ? `${Math.min(...bases).toFixed(2)}–${Math.max(...bases).toFixed(2)} %` : "—"} |`);
}
