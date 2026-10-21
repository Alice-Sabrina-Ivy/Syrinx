// switch-cand.mjs — score the pre-registered candidates
// (measurements/resonance-switch-asymmetry-2026-10-21.md §Plan) against BASE.
//
//   dev (replay):       node scripts/resonance/switch-cand.mjs --runs=<switch-asymmetry jsonl,...> --mode=replay [--json=out.json]
//   held-out (recorded): node scripts/resonance/switch-cand.mjs --runs=<jsonl from switch-asymmetry --cand=NAME> --mode=recorded --cand=NAME
//
// replay: every candidate is replayed over the tapped vtln bins of each run
//   (admitted flag and voiced stamps as the cue saw them). A bin is in the
//   post of the chunk whose end is >= its te + 0.1 s (the pitch frames that
//   resolve it arrive ~0.1 s later); where that misses BASE's posted value
//   by one or two bins, the bin count that reproduces BASE is used for every
//   candidate (counted and printed). Positions (dot, state) are BASE's: a
//   candidate changes only the shown value (switch-candidates.mjs).
// recorded: the run carries arm.cand (the replica's candidate cue, posted and
//   put through the real row logic in switch-asymmetry.mjs).
//
// Metrics as switch-report.mjs (drawn dot, arm on; each arm against its own
// controls). Bars as the plan.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const imp = (p) => import(pathToFileURL(path.join(repo, p)).href);
const { createReadout } = await imp("src/resonance-lab/readout.js");
const CS = await imp("src/components/cueStripModel.js");
const { CANDIDATES, createDisplayReadout } = await imp("scripts/resonance/switch-candidates.mjs");
const REF = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/reference.json"), "utf8")).vtln;
const GAP = REF.womenMedian - REF.menMedian;
const CHS = 0.025, SEG = 18, TOL = 0.15, LAG = 0.1, SR = 48000, CH = 1200;
const ROW_STATES = ["starting", "restarting", "reload", "unavailable", "paused", "narrowband", "idle", "sustained", "warming", "settling", "holding", "live"];
const LIVE = new Set([ROW_STATES.indexOf("live"), ROW_STATES.indexOf("holding")]);
const mode = arg("mode", "replay");
const rows = arg("runs", "").split(",").filter(Boolean).flatMap((f) => readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)));
const byId = new Map(rows.map((r) => [r.id, r]));
const cands = mode === "recorded" ? ["base", arg("cand", "")] : Object.keys(CANDIDATES);
if (cands.some((c) => !(c in CANDIDATES))) throw new Error("unknown --cand");
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const r4 = (x) => (x == null ? null : +x.toFixed(4));
const ARMS = ["on", "off"];

function postChunks(n) {
  const out = [];
  let sp = 0;
  for (let k = 0; k < n; k++) { sp += CH / SR; if (sp >= 0.2) { sp = 0; out.push(k); } }
  return out;
}

// per stream & arm: { cand -> { u[], hdr[] (strings), restarts } }
let fitN = 0, fitShift = 0, fitMiss = 0, baseEq = 0, baseEqN = 0, dotSame = 0, dotN = 0;
const series = new Map();
function hdrOf(state, u, startU) {
  const raw = u == null ? null : u * GAP + REF.menMedian;
  return CS.resonanceHeader(ROW_STATES[state], { u, raw, startU });
}
for (const r of rows) {
  const per = {};
  for (const a of ARMS) {
    const A = r[a], n = r.n;
    const out = {};
    out.base = { u: A.u, hdr: A.hdr.map((h) => r.hdrs[h]), dot: A.dot, state: A.state, restarts: 0 };
    if (mode === "recorded") {
      const C = A.cand;
      out[cands[1]] = { u: C.u, hdr: C.hdr.map((h) => r.hdrs[h]), dot: C.dot, state: C.state, restarts: C.restarts ?? 0 };
      for (let k = 0; k < n; k++) { dotN++; if (C.dot[k] === A.dot[k] && C.state[k] === A.state[k]) dotSame++; }
    } else {
      // prefix values after each bin count
      const dispOf = (c) => createDisplayReadout({ ref: REF, horizonS: c ? c.horizonS : 5, restart: c ? c.restart : null });
      const pref = {};
      const restartsAt = {};
      const chk = createReadout({ agg: "median", horizonS: 5, ref: REF });
      const chkU = [null];
      for (const name of cands) {
        const d = dispOf(CANDIDATES[name]);
        const us = [null], rs = [0];
        let last = null, dropped = 0;
        for (const b of A.bins) {
          const [, stamp, v, adm] = b;
          const delta = last === null ? 0 : Math.max(0, stamp - last);
          last = stamp;
          if (!adm) dropped += delta;
          else { d.add(stamp - dropped, v); if (name === "base") chk.add(stamp - dropped, v); }
          const s = d.snapshot();
          us.push(s.u); rs.push(s.restarts);
          if (name === "base") { chkU.push(chk.snapshot().u); }
        }
        pref[name] = us; restartsAt[name] = rs;
      }
      for (let i = 0; i < pref.base.length; i++) { baseEqN++; if (pref.base[i] === chkU[i]) baseEq++; }
      const posts = postChunks(n);
      const te = A.bins.map((b) => b[0]);
      let bi = 0;
      const cnt = new Array(n).fill(-1); // bin count used at each post chunk
      for (const k of posts) {
        const t = (k + 1) * CHS;
        while (bi < te.length && te[bi] + LAG <= t + 1e-9) bi++;
        if (A.u[k] == null) { cnt[k] = -2; continue; } // withheld (narrowband not decided)
        fitN++;
        let use = bi, ok = false;
        for (const dd of [0, -1, 1, -2, 2, -3, 3]) {
          const c = bi + dd;
          if (c < 0 || c >= pref.base.length) continue;
          const u = pref.base[c];
          if (u != null && Math.abs(r4(u) - A.u[k]) <= 0.0006) { use = c; ok = true; break; }
        }
        if (!ok) fitMiss++; else if (use !== bi) fitShift++;
        cnt[k] = use;
      }
      for (const name of cands) {
        if (name === "base") continue;
        const u = new Array(n).fill(null), hdr = new Array(n);
        let cur = null, seen = false;
        for (let k = 0; k < n; k++) {
          if (cnt[k] === -2) { cur = null; seen = true; }
          else if (cnt[k] >= 0) { cur = r4(pref[name][cnt[k]]); seen = true; }
          u[k] = seen ? cur : A.u[k];
          hdr[k] = hdrOf(A.state[k], u[k], A.startU[k]);
        }
        const lastCnt = cnt.filter((c) => c >= 0).pop() ?? 0;
        out[name] = { u, hdr, dot: A.dot, state: A.state, restarts: restartsAt[name][lastCnt] ?? 0 };
      }
    }
    per[a] = out;
  }
  series.set(r.id, per);
}

// --check=<jsonl from switch-asymmetry --cand=NAME>: replayed candidate vs the candidate run through the real chain
const checkF = arg("check", "");
if (checkF && mode === "replay") {
  let n = 0, eq = 0, near = 0;
  for (const l of readFileSync(checkF, "utf8").split(String.fromCharCode(10)).filter((x) => x.trim())) {
    const r = JSON.parse(l);
    if (!series.has(r.id)) continue;
    for (const a of ARMS) {
      const rep = series.get(r.id)[a][r.cand].u, got = r[a].cand.u;
      for (let k = 0; k < r.n; k++) {
        if (got[k] == null && rep[k] == null) continue;
        n++;
        if (got[k] === rep[k]) eq++;
        else if (got[k] != null && rep[k] != null && Math.abs(got[k] - rep[k]) <= 0.0006) near++;
      }
    }
  }
  console.log(`Check vs real-chain candidate: ${eq} equal, ${near} within 0.0006 u (bin rounding), of ${n} chunks`);
}

function settle(us, uo, un, k0, k1, mask) {
  let t50 = null;
  const pts = [];
  for (let k = k0; k < k1; k++) {
    if (us[k] == null || uo[k] == null || un[k] == null) continue;
    if (mask && !mask[k]) continue;
    const step = un[k] - uo[k];
    const p = Math.abs(step) < 1e-6 ? null : (us[k] - uo[k]) / step;
    pts.push({ k, p, d: Math.abs(us[k] - un[k]) });
    if (t50 === null && p !== null && p >= 0.5) t50 = k - k0;
  }
  const lastBad = (bad) => { let kb = null; for (const x of pts) if (bad(x)) kb = x.k; return kb; };
  const firstAfter = (kb) => { const x = pts.find((y) => kb === null || y.k > kb); return x ? x.k - k0 : null; };
  const btol = lastBad((x) => x.d > TOL), bdb = lastBad((x) => x.d > 0.3);
  const cens = k1 - k0;
  return { t50: (t50 ?? cens) * CHS, c50: t50 === null, ttol: (firstAfter(btol) ?? cens) * CHS, tdb: (firstAfter(bdb) ?? cens) * CHS, cdb: firstAfter(bdb) === null };
}
const LETTER_BRIGHT = { D: 0, B: 1, M: 0, W: 1 };
const controlId = (r, L) => (r.kind === "a" ? `${r.reader}__a${r.mode}__${L}${L}${L}` : L === "M" ? `${r.man}__O` : `${r.woman}__O`);
const events = [];
for (const r of rows) {
  if (!["DBD", "BDB", "MWM", "WMW"].includes(r.seq)) continue;
  const joins = r.joins ?? [SEG, 2 * SEG];
  const pat = `${joins[0]}/${joins[1]}`;
  for (const j of [1, 2]) {
    const from = r.seq[j - 1], to = r.seq[j];
    const cOld = controlId(r, from), cNew = controlId(r, to);
    if (!byId.has(cOld) || !byId.has(cNew)) continue;
    const k0 = Math.round(joins[j - 1] / CHS), k1 = Math.min(r.n, j === 1 ? Math.round(joins[1] / CHS) : r.n);
    const dir = LETTER_BRIGHT[to] > LETTER_BRIGHT[from] ? "up" : "down";
    for (const a of ARMS) for (const c of cands) {
      const S = series.get(r.id)[a][c], O = series.get(cOld)[a][c], N = series.get(cNew)[a][c];
      const mask = S.dot.map((d) => d === 1);
      // header (reported, no bar): first live / holding chunk with the expected text, and the share from 8 s on
      const expect = r.seq[0] === to ? "about where you started" : LETTER_BRIGHT[to] > LETTER_BRIGHT[r.seq[0]] ? "brighter than your start" : "darker than your start";
      let th = null, lateN = 0, lateOk = 0;
      for (let k = k0; k < k1; k++) {
        if (!LIVE.has(S.state[k])) continue;
        const ok = S.hdr[k] === expect;
        if (ok && th === null) th = (k - k0) * CHS;
        if (k - k0 >= 8 / CHS) { lateN++; if (ok) lateOk++; }
      }
      events.push({ id: r.id, kind: r.kind, sex: r.kind === "a" ? r.sex : null, seq: r.seq, join: j, dir, arm: a, cand: c, pat,
        darkFirst: LETTER_BRIGHT[r.seq[0]] === 0, st: settle(S.u, O.u, N.u, k0, k1, mask), th, hdrLate: lateN ? lateOk / lateN : null });
    }
  }
}
// steady speech (controls)
const controls = rows.filter((r) => ["DDD", "BBB", "MMM", "WWW"].includes(r.seq));
function steady(c, sexF) {
  const dus = [], spreads = [], dBase = [];
  let liveN = 0, aboutN = 0, liveB = 0, aboutB = 0, restarts = 0, minutes = 0;
  for (const r of controls) {
    if (sexF && r.sex !== sexF) continue;
    const S = series.get(r.id).on[c], B = series.get(r.id).on.base;
    const posts = postChunks(r.n);
    let prev = null;
    for (const k of posts) {
      if (S.dot[k] === 1 && S.u[k] != null) { if (prev !== null) dus.push(Math.abs(S.u[k] - prev)); prev = S.u[k]; } else prev = null;
    }
    for (let w = 0; w + 200 <= r.n; w += 200) {
      const v = [];
      for (let k = w; k < w + 200; k++) if (S.dot[k] === 1 && S.u[k] != null) v.push(S.u[k]);
      if (v.length >= 100) spreads.push(q(v, 0.9) - q(v, 0.1));
    }
    for (let k = 0; k < r.n; k++) {
      if (S.dot[k] === 1 && B.dot[k] === 1 && S.u[k] != null && B.u[k] != null) dBase.push(Math.abs(S.u[k] - B.u[k]));
      if (LIVE.has(B.state[k]) && r.on.startU[k] != null) {
        liveN++; if (S.hdr[k] === "about where you started") aboutN++;
        liveB++; if (B.hdr[k] === "about where you started") aboutB++;
      }
    }
    restarts += S.restarts; minutes += r.dur / 60;
  }
  return { p90: q(dus, 0.9), spread: med(spreads), dBase: med(dBase), about: liveN ? aboutN / liveN : null, aboutBase: liveB ? aboutB / liveB : null, restartsPerMin: restarts / minutes, nPairs: dus.length, nWin: spreads.length };
}

const lines = [];
const say = (s = "") => { lines.push(s); console.log(s); };
const f1 = (v) => (v == null ? "—" : v.toFixed(1));
const f2 = (v) => (v == null ? "—" : v.toFixed(2));
const f3 = (v) => (v == null ? "—" : v.toFixed(3));
if (mode === "replay") say(`Replay: BASE display = readout.js on ${baseEq}/${baseEqN} bin prefixes; posts fitted ${fitN} (te + ${LAG} s exact ${fitN - fitShift - fitMiss}, shifted 1–3 bins ${fitShift}, unmatched ${fitMiss})`);
else say(`Recorded: candidate dot and row state equal to BASE on ${dotSame}/${dotN} chunks`);
say();
const sel = (c, pred) => events.filter((e) => e.cand === c && e.arm === "on" && pred(e));
const result = {};
for (const c of cands) {
  const up = sel(c, (e) => e.dir === "up"), dn = sel(c, (e) => e.dir === "down");
  const away = sel(c, () => true).filter((e) => e.join === 1);
  const x6a = sel(c, (e) => e.pat === "30/36" && e.darkFirst && e.join === 1), x6b = sel(c, (e) => e.pat === "30/36" && e.darkFirst && e.join === 2);
  const R = {
    upTdb: med(up.map((e) => e.st.tdb)), downTdb: med(dn.map((e) => e.st.tdb)),
    awayTdb: med(away.map((e) => e.st.tdb)),
    x6AwayT50: med(x6a.map((e) => e.st.t50)), x6BackT50: med(x6b.map((e) => e.st.t50)),
    nUp: up.length, nDown: dn.length, nX6: x6a.length,
    steady: { all: steady(c, null), m: steady(c, "m"), f: steady(c, "f") },
  };
  R.upDown = R.upTdb / R.downTdb;
  R.awayBack = R.x6AwayT50 / R.x6BackT50;
  result[c] = R;
}
const B = result.base;
for (const c of cands) {
  const R = result[c];
  const jit = ["all", "m", "f"].every((s) => R.steady[s].p90 <= 1.1 * B.steady[s].p90 + 1e-12 && R.steady[s].spread <= 1.1 * B.steady[s].spread + 1e-12);
  const iv = R.steady.all.dBase <= 0.02 && R.steady.all.about >= R.steady.all.aboutBase - 0.02;
  const settleA = R.upTdb <= 0.6 * B.upTdb && R.upDown <= 1.5;
  const settleB = R.x6AwayT50 <= 0.6 * B.x6AwayT50 && R.awayBack <= 1.5;
  R.pass = { ii: jit, iii: true, iv, ia: settleA, ib: settleB };
}
say("| cand | up Tdb | down Tdb | up/down | away Tdb (all joins 1) | 30/36 dark-first T50 away | back | away/back | jitter p90 Δu (all / m / f) | 5 s spread q90−q10 (all / m / f) | med |Δu| vs BASE | 'about where you started' (BASE) | restarts / min steady | (ii) | (iv) | (i a) | (i b) |");
say("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const c of cands) {
  const R = result[c], s = R.steady;
  say(`| ${c} | ${f1(R.upTdb)} | ${f1(R.downTdb)} | ${f2(R.upDown)} | ${f1(R.awayTdb)} | ${f1(R.x6AwayT50)} | ${f1(R.x6BackT50)} | ${f2(R.awayBack)} | ${f3(s.all.p90)} / ${f3(s.m.p90)} / ${f3(s.f.p90)} | ${f3(s.all.spread)} / ${f3(s.m.spread)} / ${f3(s.f.spread)} | ${f3(s.all.dBase)} | ${f2(s.all.about)} (${f2(s.all.aboutBase)}) | ${f2(s.all.restartsPerMin)} | ${R.pass.ii ? "pass" : "FAIL"} | ${R.pass.iv ? "pass" : "FAIL"} | ${R.pass.ia ? "pass" : "FAIL"} | ${R.pass.ib ? "pass" : "FAIL"} |`);
}
say();
// per sex and direction, settle (arm on): Tdb and T50 medians
say("| cand | set | dir | n | Tdb | T50 | Ttol |");
say("|---|---|---|---|---|---|---|");
for (const c of cands) for (const [label, pred] of [["a, readers m", (e) => e.kind === "a" && e.sex === "m"], ["a, readers f", (e) => e.kind === "a" && e.sex === "f"], ["b (pairs)", (e) => e.kind === "b"]]) for (const dir of ["up", "down"]) {
  const es = sel(c, (e) => pred(e) && e.dir === dir);
  say(`| ${c} | ${label} | ${dir} | ${es.length} | ${f1(med(es.map((e) => e.st.tdb)))} | ${f1(med(es.map((e) => e.st.t50)))} | ${f1(med(es.map((e) => e.st.ttol)))} |`);
}
say();
// header (reported, no bar; arm on)
say("| cand | join | n | header first right (median s; never: n) | right from 8 s on (median share) |");
say("|---|---|---|---|---|");
for (const c of cands) for (const j of [1, 2]) {
  const es = sel(c, (e) => e.join === j);
  say(`| ${c} | ${j} | ${es.length} | ${f1(med(es.filter((e) => e.th != null).map((e) => e.th)))} (${es.filter((e) => e.th == null).length}) | ${f2(med(es.map((e) => e.hdrLate)))} |`);
}
say();
// per pattern away/back (arm on)
say("| cand | joins | first | away T50 | away Tdb | back T50 | back Tdb |");
say("|---|---|---|---|---|---|---|");
for (const c of cands) for (const pat of ["18/36", "30/36", "30/40"]) for (const dark of [true, false]) {
  const A = sel(c, (e) => e.pat === pat && e.darkFirst === dark && e.join === 1), Bk = sel(c, (e) => e.pat === pat && e.darkFirst === dark && e.join === 2);
  if (!A.length) continue;
  say(`| ${c} | ${pat} | ${dark ? "dark" : "bright"} | ${f1(med(A.map((e) => e.st.t50)))} | ${f1(med(A.map((e) => e.st.tdb)))} | ${f1(med(Bk.map((e) => e.st.t50)))} | ${f1(med(Bk.map((e) => e.st.tdb)))} |`);
}
say();
// arm off (reported, no bar)
say("| cand | arm off: up Tdb | down Tdb |");
say("|---|---|---|");
for (const c of cands) {
  const es = events.filter((e) => e.cand === c && e.arm === "off");
  say(`| ${c} | ${f1(med(es.filter((e) => e.dir === "up").map((e) => e.st.tdb)))} | ${f1(med(es.filter((e) => e.dir === "down").map((e) => e.st.tdb)))} |`);
}
say();
if (mode === "replay") {
  const ok = cands.filter((c) => c !== "base" && result[c].pass.ii && result[c].pass.iv);
  // lowest dev median away Tdb; within 0.1 s of it: larger jumpU, then larger confirmN, then C1 before C2
  const best = ok.length ? Math.min(...ok.map((c) => result[c].awayTdb)) : null;
  const tied = ok.filter((c) => result[c].awayTdb <= best + 0.1);
  const key = (c) => [-(CANDIDATES[c].restart?.jumpU ?? 0), -(CANDIDATES[c].restart?.confirmN ?? 0), CANDIDATES[c].kind === "horizon" ? 1 : 0, result[c].awayTdb];
  tied.sort((x, y) => { const a = key(x), b = key(y); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; });
  ok.sort((x, y) => result[x].awayTdb - result[y].awayTdb);
  say(`Pass (ii)–(iv) on dev: ${ok.length ? ok.join(", ") : "none"}`);
  say(`Within 0.1 s of the lowest away Tdb: ${tied.join(", ") || "—"}`);
  say(`Dev winner: ${tied[0] ?? "no candidate"}`);
}
const jf = arg("json", "");
if (jf) writeFileSync(jf, JSON.stringify({ result, lines }, null, 1));
