// audit-report.mjs — tables for the phone-vs-desktop resonance audit
// (audit-pitch.mjs + audit-chain.mjs output).
//
//   node scripts/resonance/mobile/audit-report.mjs [--root=build/resonance-mobile/audit]
//        [--base=c0__imm__gon] [--runs=<comma list of cond__sched__gX>]
//
// Per run (cond, schedule, gate) and sex, medians over readers of:
//   voiced RMS     the 50 ms RMS (dBFS) around posted voiced frames (pitch run)
//   hidden         share of posted voiced frames the voice gate hides
//   first dot      L stream: audio time of the first post whose row shows a
//                  position (live / holding / settling with u != null)
//   live           L stream: share of posts after the first dot whose row is live
//   idle+warm      L stream: share of posts (after 5 s) whose row is idle or warming
//   voiced s/min   L stream: voiced seconds the readout admitted per minute of audio
//                  (the last post's voicedS); "bins dropped/min" counts every 150 ms
//                  vtln bin the gate dropped, empty (unvoiced) bins included — the
//                  engine closes a bin every 150 ms whether or not it is voiced, so
//                  admitted + dropped bins is always ~400 / min
//   u moves/min    L stream: posts whose shown u differs from the previous post's
//   forced / drop  L stream: grid frames forced unvoiced (STALL_S) / frames dropped
//   du             L stream: median shown u over posts >= 30 s, minus the base
//                  run's, per reader (negative = darker)
//   T50 up / down  NUN: seconds after the 18 s (up) / 36 s (back) switch until the
//                  shown u first crosses halfway between the N and U10 control
//                  medians (t >= 10 s) of the same run; "miss" = never in 18 s
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const ROOT = path.resolve(repo, arg("root", "build/resonance-mobile/audit"));
const BASE = arg("base", "c0__imm__gon");
const ROWS = ["starting", "restarting", "reload", "unavailable", "paused", "narrowband", "idle", "sustained", "warming", "settling", "holding", "live"];
const med = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const f = (x, d = 2) => (x == null ? "–" : x.toFixed(d));
const T = (k) => (k + 1) * 0.025;

function loadRun(name) {
  const file = path.join(ROOT, "chain", `${name}.jsonl`);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const pitchCache = new Map();
function pitchStats(cond, id) {
  const key = `${cond}/${id}`;
  if (pitchCache.has(key)) return pitchCache.get(key);
  const file = path.join(ROOT, "pitch", cond, `${id}.json`);
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, "utf8"));
  const rms = [];
  let v = 0, hid = 0, n = 0;
  for (const ch of j.byChunk) for (const m of ch) { n++; if (m[0]) { v++; if (m[3] === 0) hid++; if (m[4] != null) rms.push(m[4]); } }
  const st = { voicedShare: v / n, hidden: v ? hid / v : null, rms50: q(rms, 0.5), rms10: q(rms, 0.1) };
  pitchCache.set(key, st);
  return st;
}

function perStream(rec) {
  const P = rec.posts.filter((p) => typeof p[1] !== "string");
  const out = { id: rec.id, reader: rec.reader, sex: rec.sex, stream: rec.stream };
  const dotRow = (p) => ["live", "holding", "settling"].includes(ROWS[p[16]]) && p[1] != null;
  const first = P.find(dotRow);
  out.firstDot = first ? T(first[0]) : null;
  const after = first ? P.filter((p) => p[0] >= first[0]) : [];
  out.live = after.length ? after.filter((p) => ROWS[p[16]] === "live").length / after.length : null;
  const after5 = P.filter((p) => T(p[0]) >= 5);
  out.idleWarm = after5.length ? after5.filter((p) => ["idle", "warming"].includes(ROWS[p[16]])).length / after5.length : null;
  const last = P[P.length - 1];
  const durMin = rec.nC * 0.025 / 60;
  out.binsPerMin = last ? last[13] / durMin : null;
  out.voicedPerMin = last ? last[4] / durMin : null;
  let mv = 0;
  for (let i = 1; i < P.length; i++) if (P[i][1] != null && P[i - 1][1] != null && P[i][1] !== P[i - 1][1]) mv++;
  out.uMovesPerMin = mv / durMin;
  out.droppedPerMin = last ? last[14] / durMin : null;
  out.forced = last ? last[15] : null;
  out.framesDropped = last ? last[12] : null;
  out.nbOn = P.filter((p) => p[9] === 1).length / Math.max(1, P.length);
  out.nbF = med(P.filter((p) => T(p[0]) >= 10).map((p) => p[11]));
  out.lag = med(P.map((p) => p[17]));
  out.lagMax = Math.max(...P.map((p) => p[17] ?? 0));
  out.u30 = med(P.filter((p) => T(p[0]) >= 30 && p[1] != null).map((p) => p[1]));
  out.u10 = med(P.filter((p) => T(p[0]) >= 10 && p[1] != null).map((p) => p[1]));
  out.uSeries = P.map((p) => [T(p[0]), p[1]]);
  return out;
}

function summarize(name) {
  const recs = loadRun(name);
  if (!recs) return null;
  const [cond, sched, g] = name.split("__");
  const S = recs.map((r) => ({ ...perStream(r), ...(pitchStats(cond, r.id) ?? {}) }));
  const by = (stream, sex) => S.filter((s) => s.stream === stream && (!sex || s.sex === sex));
  // T50 on NUN with this run's own N / U10 control levels
  const t50 = [];
  for (const s of by("NUN")) {
    const A = by("N").find((x) => x.reader === s.reader)?.u10, B = by("U10").find((x) => x.reader === s.reader)?.u10;
    if (A == null || B == null) continue;
    const mid = (A + B) / 2, dir = Math.sign(B - A);
    const up = s.uSeries.find(([t, u]) => t >= 18 && t < 36 && u != null && dir * (u - mid) >= 0);
    const dn = s.uSeries.find(([t, u]) => t >= 36 && u != null && dir * (u - mid) <= 0);
    t50.push({ reader: s.reader, sex: s.sex, step: B - A, up: up ? up[0] - 18 : null, dn: dn ? dn[0] - 36 : null });
  }
  return { name, cond, sched, gate: g, S, t50 };
}

const all = existsSync(path.join(ROOT, "chain")) ? readdirSync(path.join(ROOT, "chain")).filter((x) => x.endsWith(".jsonl")).map((x) => x.slice(0, -6)) : [];
const runs = arg("runs", "") ? arg("runs", "").split(",") : all.sort();
const base = summarize(BASE);
const rows = [];
for (const name of runs) {
  const R = name === BASE ? base : summarize(name);
  if (!R) continue;
  for (const sex of ["m", "f"]) {
    const L = R.S.filter((s) => s.stream === "L" && s.sex === sex);
    const all4 = R.S.filter((s) => s.sex === sex);
    const du = L.map((s) => { const b = base?.S.find((x) => x.id === s.id); return b && s.u30 != null && b.u30 != null ? s.u30 - b.u30 : null; });
    const T5 = R.t50.filter((t) => t.sex === sex);
    rows.push({
      run: name, sex, n: L.length,
      rms50: med(all4.map((s) => s.rms50)), rms10: med(all4.map((s) => s.rms10)),
      hidden: med(all4.map((s) => s.hidden)),
      firstDot: med(L.map((s) => s.firstDot)), firstDotMax: L.length ? Math.max(...L.map((s) => s.firstDot ?? 999)) : null,
      live: med(L.map((s) => s.live)), idleWarm: med(L.map((s) => s.idleWarm)),
      binsPerMin: med(L.map((s) => s.binsPerMin)), droppedPerMin: med(L.map((s) => s.droppedPerMin)),
      voicedPerMin: med(L.map((s) => s.voicedPerMin)), uMovesPerMin: med(L.map((s) => s.uMovesPerMin)),
      forced: med(L.map((s) => s.forced)), framesDropped: med(L.map((s) => s.framesDropped)),
      nbF: med(L.map((s) => s.nbF)), nbOn: med(L.map((s) => s.nbOn)), nbOnMax: L.length ? Math.max(...L.map((s) => s.nbOn)) : null,
      lag: med(L.map((s) => s.lag)), lagMax: L.length ? Math.max(...L.map((s) => s.lagMax)) : null,
      u30: med(L.map((s) => s.u30)), du: med(du), duMin: du.filter((x) => x != null).length ? Math.min(...du.filter((x) => x != null)) : null,
      duMax: du.filter((x) => x != null).length ? Math.max(...du.filter((x) => x != null)) : null,
      t50up: med(T5.map((t) => t.up)), t50dn: med(T5.map((t) => t.dn)), t50miss: T5.filter((t) => t.up == null).length + T5.filter((t) => t.dn == null).length, t50n: T5.length,
      step: med(T5.map((t) => t.step)),
    });
  }
}
const hdr = ["run", "sex", "n", "voiced RMS p50/p10 dBFS", "hidden", "first dot s (max)", "live", "idle+warm", "admitted voiced s/min", "u moves/min", "bins dropped/min", "forced", "fr.drop", "NB F dB (on)", "relay lag s (max)", "u ≥30 s", "Δu vs base (min..max)", "step u", "T50 up / down s (miss)"];
console.log(`| ${hdr.join(" | ")} |`);
console.log(`|${hdr.map(() => "---").join("|")}|`);
for (const r of rows) {
  console.log(`| ${[r.run, r.sex, r.n, `${f(r.rms50, 1)} / ${f(r.rms10, 1)}`, r.hidden == null ? "–" : `${(100 * r.hidden).toFixed(1)} %`,
    `${f(r.firstDot, 1)} (${f(r.firstDotMax, 1)})`, r.live == null ? "–" : `${(100 * r.live).toFixed(0)} %`, r.idleWarm == null ? "–" : `${(100 * r.idleWarm).toFixed(0)} %`,
    f(r.voicedPerMin, 1), f(r.uMovesPerMin, 0), f(r.droppedPerMin, 0), f(r.forced, 0), f(r.framesDropped, 0), `${f(r.nbF, 1)} (${(100 * (r.nbOnMax ?? 0)).toFixed(0)} %)`,
    `${f(r.lag, 3)} (${f(r.lagMax, 2)})`, f(r.u30), `${f(r.du)} (${f(r.duMin)}..${f(r.duMax)})`, f(r.step), `${f(r.t50up, 1)} / ${f(r.t50dn, 1)} (${r.t50miss}/${2 * r.t50n})`].join(" | ")} |`);
}
writeFileSync(path.join(ROOT, "report.json"), JSON.stringify(rows, null, 1));
