// analyze.mjs — statistics for the desktop timing runs (§P5 / §P6 of
// measurements/voice-preview-spike-2026-10-12.md): per (browser, engine, build, front end,
// frame period, rate, length) the median, p90 (linear interpolation, numpy's default), worst
// clip's p90, minimum and quartiles of C0, cold G1, G2 and warm G1; split-half medians
// (repeats 0-4 vs 5-9) as a stability check; per-stage medians of cold G1; the machine load
// during the group's runs (load-log.mjs); the §P6 gate conditions applied to these desktop
// numbers (information only — only the phone's numbers count) and to desktop x a phone factor
// (a PREDICTION, not a measurement). Runs that overlap a gap in the load log (a governor
// suspension) are excluded and listed.
//
//   node scripts/voice-preview/timing/analyze.mjs <result.json>[,<result.json>...] [--load=load.jsonl]
//        [--factors=2,2.4,4.5] [--json=out.json] [--by-clipset=1]
// --by-clipset=1 (§ Addition 2026-10-12): the clip set (run row "clipset", default "timing") is part
// of the group key, for result files that mix clip sets (run-desktop.mjs --plans). Each group also
// reports runComputeMeanMs, the mean of C0 + cold G1 + 20 x G2 + 5 x warm G1 per run (the phone
// session estimate, A7).
//        [--governor=governor.log] [--governor-match=REGEX] [--skip-reps=0,1]
// --governor (review of the addition, 2026-10-13): the resource governor's own log. A gap in the
// load log shows a suspension only when the load logger itself was suspended; the governor can
// also suspend the driver or a browser process for a few seconds while the logger keeps running.
// Every "suspend pid N (...) <command line>" whose command line matches --governor-match
// (default: the timing driver, the load logger, the static server and the pinned browsers under
// voice-preview/browsers) opens a suspension that the next "resume pid N" (or "resumed leftover
// pid N") closes. A run whose span overlaps one (widened by 1 s each side: the log has 1-s
// resolution) is excluded and listed with the process. The log's timestamps are local time, read
// in this machine's time zone.
// --skip-reps: leave out these repeat indices (a sensitivity check, e.g. repeats that ran beside
// other heavy jobs); listed like the other exclusions.
import { readFileSync, writeFileSync } from "node:fs";
import { quantile } from "./summarize.mjs";

const args = Object.fromEntries(process.argv.slice(3).map((a) => a.replace(/^--/, "").split("=")));
const files = process.argv[2].split(",");
const factors = (args.factors || "2,2.4,4.5").split(",").map(Number);
const load = args.load ? readFileSync(args.load, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r) => ({ t: Date.parse(r.t), b: r.busyPct })) : [];

const st = (v) => (v.length ? { n: v.length, median: quantile(v, 0.5), p25: quantile(v, 0.25), p75: quantile(v, 0.75), p90: quantile(v, 0.9), min: Math.min(...v), max: Math.max(...v) } : null);
function loadNear(iso) {
  if (!load.length || !iso) return null;
  const t = Date.parse(iso);
  let best = null;
  for (const r of load) if (r.t >= t - 5000 && r.t <= t + 15000) best = best === null ? r.b : (best + r.b) / 2;
  return best;
}

// Pauses: the machine's resource governor can suspend processes for minutes. The load log
// stops while it does (gaps > 30 s between samples). A run whose time span overlaps a gap is
// excluded and counted, so a suspension never enters the statistics.
const gaps = [];
for (let i = 1; i < load.length; i++) if (load[i].t - load[i - 1].t > 30000) gaps.push([load[i - 1].t, load[i].t]);
// Governor suspensions (--governor): [from, to, pid, command line] per matching suspension.
const govMatch = new RegExp(args["governor-match"] || "run-desktop\\.mjs|load-log\\.mjs|serve\\.mjs|voice-preview[\\\\/]browsers[\\\\/]", "i");
const suspensions = [];
if (args.governor) {
  const open = new Map();
  const resumes = []; // every resume time, in log order
  const local = (d, t) => { const [y, mo, da] = d.split("-").map(Number), [h, mi, se] = t.split(":").map(Number); return new Date(y, mo - 1, da, h, mi, se).getTime(); };
  for (const line of readFileSync(args.governor, "utf8").split(/\r?\n/)) {
    const m = line.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) (suspend|resume|resumed leftover) pid (\d+)\s*(.*)$/);
    if (!m) continue;
    const t = local(m[1], m[2]), pid = m[4];
    if (m[3] === "suspend") { const cmd = m[5].replace(/^\([^)]*\)\s*/, ""); if (govMatch.test(cmd) && !open.has(pid)) open.set(pid, { t, cmd }); continue; }
    resumes.push(t);
    if (open.has(pid)) { const o = open.get(pid); open.delete(pid); suspensions.push([o.t - 1000, t + 1000, pid, o.cmd]); }
  }
  // A process that exits while suspended (e.g. a renderer of a closed browser context) gets no
  // resume line: its suspension is taken to end with the governor's next resume wave (the first
  // resume after it, and every resume that follows within 15 s of the previous one).
  for (const [pid, o] of open) {
    let k = resumes.findIndex((t) => t >= o.t);
    if (k < 0) { suspensions.push([o.t - 1000, Infinity, pid, `${o.cmd} (no resume in the log)`]); continue; }
    while (k + 1 < resumes.length && resumes[k + 1] - resumes[k] <= 15000) k++;
    suspensions.push([o.t - 1000, resumes[k] + 1000, pid, `${o.cmd} (exited while suspended: ends with the next resume wave)`]);
  }
}
const skipReps = new Set((args["skip-reps"] || "").split(",").filter((x) => x !== "").map(Number));
const runSpanMs = (r) => r.c0 + r.g1cold.ms + r.g2.reduce((a, g) => a + g.ms, 0) + r.g1warm.reduce((a, g) => a + g.ms, 0);
const hhmmss = (t) => (Number.isFinite(t) ? new Date(t).toISOString().slice(11, 19) : "?");
const excluded = [];
const groups = new Map();
for (const f of files) {
  const res = JSON.parse(readFileSync(f, "utf8"));
  const browser = res.driver?.browser || "?";
  for (const r of res.runs) {
    if (r.error) continue;
    const ex = { file: f, i: r.i, rep: r.rep, block: r.block, rate: r.rate, length: r.length, clip: r.clip, clipset: r.clipset || "timing", startedAt: r.startedAt };
    if (skipReps.has(r.rep)) { excluded.push({ ...ex, why: "--skip-reps" }); continue; }
    if (r.startedAt && (gaps.length || suspensions.length)) {
      const t0 = Date.parse(r.startedAt), t1 = t0 + runSpanMs(r) + 2000;
      if (gaps.some(([a, b]) => t0 < b && t1 > a)) { excluded.push({ ...ex, why: "load-log gap > 30 s" }); continue; }
      const s = suspensions.find(([a, b]) => t0 < b && t1 > a);
      if (s) { excluded.push({ ...ex, why: "governor suspension", pid: s[2], suspended: `${hhmmss(s[0] + 1000)}-${hhmmss(s[1] - 1000)} UTC`, cmd: s[3].slice(0, 110) }); continue; }
    }
    const clipset = r.clipset || "timing";
    const key = [browser, r.engine, r.ready?.build || "js", r.fe, `fp${r.fp}`, r.rate, `${r.length}s`, ...(args["by-clipset"] ? [clipset] : [])].join(" ");
    if (!groups.has(key)) groups.set(key, { browser, engine: r.engine, build: r.ready?.build || "js", fe: r.fe, fp: r.fp, rate: r.rate, length: r.length, ...(args["by-clipset"] ? { clipset } : {}), runs: [] });
    groups.get(key).runs.push(r);
  }
}

function gate(g, k = 1) {
  const c0 = g.c0.median * k;
  const excess = Math.max(0, c0 - 3000);
  const g1med = g.g1cold.median * k + excess, g1p90 = g.g1cold.worstClipP90 * k + excess;
  const g2med = g.g2.median * k, g2p90 = g.g2.worstClipP90 * k;
  const c = [g1med <= 3000, g1p90 <= 3000, g2med <= 1000, g2p90 <= 1000];
  return { factor: k, g1med, g1p90, g2med, g2p90, c0, pass: c.every(Boolean), conditions: c };
}

const out = [];
for (const [key, g] of groups) {
  const rs = g.runs;
  const clips = [...new Set(rs.map((r) => r.clip))].sort();
  const q = (pick) => {
    const all = rs.flatMap(pick);
    const perClip = Object.fromEntries(clips.map((c) => [c, st(rs.filter((r) => r.clip === c).flatMap(pick))]));
    const h1 = rs.filter((r) => r.rep < 5).flatMap(pick), h2 = rs.filter((r) => r.rep >= 5).flatMap(pick);
    return { ...st(all), worstClipP90: Math.max(...Object.values(perClip).map((s) => s.p90)), perClip,
      half1: h1.length ? quantile(h1, 0.5) : null, half2: h2.length ? quantile(h2, 0.5) : null, msPerSecond: quantile(all, 0.5) / g.length };
  };
  const stages = {};
  for (const k of Object.keys(rs[0].g1cold.stages || {})) stages[k] = quantile(rs.map((r) => r.g1cold.stages[k] ?? 0), 0.5);
  const g2stages = {};
  for (const k of Object.keys(rs[0].g2[0].stages || {})) g2stages[k] = quantile(rs.flatMap((r) => r.g2.map((x) => x.stages[k] ?? 0)), 0.5);
  const loads = rs.map((r) => loadNear(r.startedAt)).filter((v) => v !== null);
  const s = {
    key, ...g, runs: undefined, nRuns: rs.length, clips,
    c0: q((r) => [r.c0]), g1cold: q((r) => [r.g1cold.ms]), g2: q((r) => r.g2.map((x) => x.ms)), g1warm: q((r) => r.g1warm.map((x) => x.ms)),
    stagesColdMedian: stages, stagesG2Median: g2stages, memMB: Math.max(...rs.map((r) => r.memBytes || 0)) / 1048576,
    loadBusyPct: loads.length ? st(loads) : null,
    runComputeMeanMs: rs.reduce((a, r) => a + runSpanMs(r), 0) / rs.length,
  };
  s.gateDesktop = gate(s, 1);
  // the largest desktop-to-phone factor at which all four conditions would still hold (C0 excess ignored: C0 << 3 s)
  s.maxFactor = Math.min(3000 / s.g1cold.median, 3000 / s.g1cold.worstClipP90, 1000 / s.g2.median, 1000 / s.g2.worstClipP90);
  s.predicted = factors.map((k) => gate(s, k));
  out.push(s);
}
out.sort((a, b) => a.key.localeCompare(b.key));
const iso = (t) => (Number.isFinite(t) ? new Date(t).toISOString() : null);
if (args.json) {
  writeFileSync(args.json, JSON.stringify({ groups: out, gaps: gaps.map(([a, b]) => [iso(a), iso(b)]),
    governor: args.governor ? { file: args.governor, match: govMatch.source, suspensions: suspensions.map(([a, b, pid, cmd]) => ({ from: iso(a + 1000), to: iso(b - 1000), pid, cmd })) } : null,
    skipReps: [...skipReps], excluded }, null, 1));
}
console.log(`load-log gaps (> 30 s): ${gaps.map(([a, b]) => `${new Date(a).toISOString().slice(11, 19)}-${new Date(b).toISOString().slice(11, 19)}`).join(", ") || "none"}; runs excluded: ${excluded.length}`);
if (args.governor) console.log(`governor log: ${suspensions.length} suspension(s) of matching processes (/${govMatch.source}/i)`);
const why = new Map();
for (const e of excluded) { const k = e.why === "governor suspension" ? `governor suspended pid ${e.pid} ${e.suspended} (${e.cmd.slice(0, 70)})` : e.why || "load-log gap > 30 s"; why.set(k, (why.get(k) || 0) + 1); }
for (const [k, n] of why) console.log(`  excluded ${n}: ${k}`);

const sec = (v) => (v / 1000).toFixed(2);
console.log(`${"group".padEnd(56)} runs  C0 med  G1cold med [p25-p75] wcp90 min   G2 med wcp90 min   G1warm  (ms/s G1,G2)  halves G1 / G2   load%  mem`);
for (const s of out) {
  console.log(`${s.key.padEnd(56)} ${String(s.nRuns).padStart(4)}  ${sec(s.c0.median)}  ${sec(s.g1cold.median)} [${sec(s.g1cold.p25)}-${sec(s.g1cold.p75)}] ${sec(s.g1cold.worstClipP90)} ${sec(s.g1cold.min)}` +
    `   ${sec(s.g2.median)} ${sec(s.g2.worstClipP90)} ${sec(s.g2.min)}   ${sec(s.g1warm.median)}  (${s.g1cold.msPerSecond.toFixed(0)},${s.g2.msPerSecond.toFixed(0)})` +
    `  ${s.g1cold.half1 === null ? "-" : sec(s.g1cold.half1)}/${s.g1cold.half2 === null ? "-" : sec(s.g1cold.half2)} ${s.g2.half1 === null ? "-" : sec(s.g2.half1)}/${s.g2.half2 === null ? "-" : sec(s.g2.half2)}` +
    `  ${s.loadBusyPct ? s.loadBusyPct.median.toFixed(0) : "-"}  ${s.memMB.toFixed(0)}`);
}
console.log("\nGate conditions (5 s groups): desktop as measured, then PREDICTED phone = desktop x factor");
for (const s of out.filter((x) => x.length === 5 && x.fp === 5)) {
  const fmt = (gt) => `${gt.pass ? "PASS" : "fail"} (G1 ${sec(gt.g1med)}/${sec(gt.g1p90)}, G2 ${sec(gt.g2med)}/${sec(gt.g2p90)})`;
  console.log(`${s.key.padEnd(56)} desktop ${fmt(s.gateDesktop)}  ${s.predicted.map((p) => `x${p.factor}: ${fmt(p)}`).join("  ")}  passes up to x${s.maxFactor.toFixed(1)}`);
}
