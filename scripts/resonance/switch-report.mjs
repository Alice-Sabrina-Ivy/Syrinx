// switch-report.mjs — tables for measurements/resonance-switch-asymmetry-2026-10-21.md
// from switch-asymmetry.mjs runs.
//
//   node scripts/resonance/switch-report.mjs --runs=build/resonance-switch/run-dev-0of2.jsonl,... [--json=out.json]
//
// A switch event = one join (18 s or 36 s) of a switch stream (DBD / BDB /
// MWM / WMW), per arm (off / on). Direction: up = into the brighter source
// (D -> B, M -> W), down = the reverse. The steady value the row should reach
// is the time-matched value of the CONTROL stream of the new source (the
// same audio without a switch: DDD / BBB or the reader's own recording), so
// a settled row is the control's row, chunk for chunk. Progress
// p(t) = (u_s - u_old) / (u_new - u_old), u_old / u_new = the two controls
// at the same time.
//   T50   first time p >= 0.5
//   T90   from then on |1 - p| <= 0.1 for the rest of the segment
//   Ttol  from then on |u_s - u_new| <= 0.15 u (half the header deadband)
// Times in s of audio after the join (and s of voiced hint time). Not
// settled within the 18 s segment -> 18 (censored, counted).
// Stages (all on the vtln bins tapped from the replica, indexed by the bin's
// audio end time te, so they line up with each other):
//   bin    each bin vs the control's bin at the same te (vtln's trailing ~1 s
//          of voicing)
//   all    a 5 s voiced median of ALL bins (no gate)
//   cue    the admitted bins (utterance gate, voice gate in arm on), with the
//          dropped voiced time taken out as the cue does = the worker readout
//   posted the worker's posted u (every 0.2 s), per chunk
//   drawn  posted, counting only chunks where the row draws a dot
//   header the header text right ("brighter / darker than your start" in a
//          segment of the other source, "about where you started" back in
//          the first source), on chunks in state live / holding
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const { createReadout } = await import(pathToFileURL(path.join(repo, "src/resonance-lab/readout.js")).href);
const REF = JSON.parse(readFileSync(path.join(repo, "public/resonance-lab/reference.json"), "utf8")).vtln;
const GAP = REF.womenMedian - REF.menMedian;
const toU = (v) => (v - REF.menMedian) / GAP;
const CHS = 0.025, SEG = 18, TOL = 0.15;
const ROW_STATES = ["starting", "restarting", "reload", "unavailable", "paused", "narrowband", "idle", "sustained", "warming", "settling", "holding", "live"];
const LIVE = new Set([ROW_STATES.indexOf("live"), ROW_STATES.indexOf("holding")]);

const rows = arg("runs", "").split(",").filter(Boolean).flatMap((f) => readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)));
const byId = new Map(rows.map((r) => [r.id, r]));
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);

// replay a readout over bins -> per chunk u (by te)
function replay(bins, n, { admittedOnly }) {
  const ro = createReadout({ agg: "median", horizonS: 5, ref: REF });
  const u = new Array(n).fill(null);
  let dropped = 0, last = null, bi = 0, cur = null;
  const sorted = bins; // in stamp order
  for (let k = 0; k < n; k++) {
    const t = (k + 1) * CHS;
    while (bi < sorted.length && sorted[bi][0] <= t + 1e-9) {
      const [, stamp, v, adm] = sorted[bi];
      const delta = last === null ? 0 : Math.max(0, stamp - last);
      last = stamp;
      if (admittedOnly && !adm) dropped += delta;
      else { ro.add(stamp - dropped, v); const s = ro.snapshot(); if (s.u !== null) cur = s.u; }
      bi++;
    }
    u[k] = cur;
  }
  return u;
}
// per chunk bin u (latest bin with te <= t, kept until the next)
function binSeries(bins, n) {
  const m = new Map();
  for (const b of bins) if (b[2] !== null) m.set(Math.round(b[0] * 1000), toU(b[2]));
  return m; // te(ms) -> u
}

function settle(us, uo, un, k0, k1, mask = null) {
  // us, uo, un: per chunk arrays. returns {t50, t90, ttol} in chunks after k0 (null if never; censored -> k1-k0)
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
  const b90 = lastBad((x) => x.p === null || Math.abs(1 - x.p) > 0.1);
  const btol = lastBad((x) => x.d > TOL);
  const bdb = lastBad((x) => x.d > 0.3);
  const cens = k1 - k0;
  return {
    t50: t50 ?? cens, c50: t50 === null,
    t90: firstAfter(b90) ?? cens, c90: firstAfter(b90) === null,
    ttol: firstAfter(btol) ?? cens, ctol: firstAfter(btol) === null,
    tdb: firstAfter(bdb) ?? cens, cdb: firstAfter(bdb) === null,
  };
}

const LETTER_BRIGHT = { D: 0, B: 1, M: 0, W: 1 };
function controlId(r, letter) {
  if (r.kind === "a") return `${r.reader}__a${r.mode}__${letter}${letter}${letter}`;
  return letter === "M" ? `${r.man}__O` : `${r.woman}__O`;
}
const events = [];
let parN = 0, parBad = 0;
for (const r of rows) {
  for (const a of ["off", "on"]) { parN += r[a].parityN; parBad += r[a].parityBad; }
  if (!["DBD", "BDB", "MWM", "WMW"].includes(r.seq)) continue;
  const n = r.n;
  const joins = r.joins ?? [SEG, 2 * SEG];
  const pat = r.joins ? `${joins[0]}/${joins[1]}` : "18/36";
  for (const j of [1, 2]) {
    const from = r.seq[j - 1], to = r.seq[j];
    const cOld = byId.get(controlId(r, from)), cNew = byId.get(controlId(r, to));
    if (!cOld || !cNew) continue;
    const k0 = Math.round(joins[j - 1] / CHS), k1 = Math.min(n, j === 1 ? Math.round(joins[1] / CHS) : n);
    const dwell = j === 1 ? joins[0] : joins[1] - joins[0];
    const dir = LETTER_BRIGHT[to] > LETTER_BRIGHT[from] ? "up" : "down";
    const sex = r.kind === "a" ? r.sex : null;
    for (const a of ["off", "on"]) {
      const S = r[a], O = cOld[a], N = cNew[a];
      // replays
      const all = (x) => replay(x.bins, n, { admittedOnly: false });
      const cue = (x) => replay(x.bins, n, { admittedOnly: true });
      const sAll = all(S), oAll = all(O), nAll = all(N);
      const sCue = cue(S), oCue = cue(O), nCue = cue(N);
      // bins: time-matched by te
      const bs = binSeries(S.bins), bo = binSeries(O.bins), bn = binSeries(N.bins);
      const bu = (m) => { const arr = new Array(n).fill(null); for (const [ms, u] of m) { const k = Math.round(ms / 25) - 1; if (k >= 0 && k < n) arr[k] = u; } return arr; };
      const sB = bu(bs), oB = bu(bo), nB = bu(bn);
      const drawnMask = S.dot.map((d) => d === 1);
      const st = {
        bin: settle(sB, oB, nB, k0, k1),
        all: settle(sAll, oAll, nAll, k0, k1),
        cue: settle(sCue, oCue, nCue, k0, k1),
        posted: settle(S.u, O.u, N.u, k0, k1),
        drawn: settle(S.u, O.u, N.u, k0, k1, drawnMask),
      };
      // header
      const expect = r.seq[0] === to ? "about where you started" : LETTER_BRIGHT[to] > LETTER_BRIGHT[r.seq[0]] ? "brighter than your start" : "darker than your start";
      // header: first chunk (live / holding) showing the expected text, and the share of
      // live / holding chunks showing it from 8 s after the join to the segment end
      let th = null, anyLive = false, lateN = 0, lateOk = 0;
      for (let k = k0; k < k1; k++) {
        if (!LIVE.has(S.state[k])) continue;
        anyLive = true;
        const ok = r.hdrs[S.hdr[k]] === expect;
        if (ok && th === null) th = k - k0;
        if (k - k0 >= 8 / CHS) { lateN++; if (ok) lateOk++; }
      }
      const hdrLate = lateN ? lateOk / lateN : null;
      // context at the join
      const startUAt = S.startU[k0 - 1];
      const voicedAfter = (kk) => { let v = 0; for (let k = k0; k < Math.min(k1, k0 + kk); k++) if (S.hint[k] > 0) v++; return v * CHS; };
      // pitch hints after the join vs the new control (3 s)
      let pn = 0, pv = 0, poct = 0, pvd = 0;
      for (let k = k0; k < Math.min(k1, k0 + 120); k++) {
        const ps = S.hint[k], pc = N.hint[k];
        if (ps < 0 || pc < 0) continue;
        pn++;
        if ((ps > 0) !== (pc > 0)) pvd++;
        else if (ps > 0) { pv++; if (Math.abs(12 * Math.log2(ps / pc)) > 1) poct++; }
      }
      // bins dropped in the 5 s after the join, switch vs new control
      const dropIn = (x) => { let d = 0, t = 0; const why = {}; for (const b of x.bins) if (b[0] > k0 * CHS && b[0] <= (k0 + 200) * CHS) { t++; if (!b[3]) { d++; why[b[4]] = (why[b[4]] ?? 0) + 1; } } return { d, t, why }; };
      const hid = (x) => { let h = 0; for (let k = k0; k < Math.min(k1, k0 + 200); k++) if (r.pitch[k] > 0 && x.hint[k] === 0) h++; return h; };
      // row states in the 5 s after the join
      const states = {};
      for (let k = k0; k < Math.min(k1, k0 + 200); k++) states[ROW_STATES[S.state[k]]] = (states[ROW_STATES[S.state[k]]] ?? 0) + 1;
      // how far the drawn position got by the end of the segment (p of the last drawn chunk)
      let pEnd = null;
      for (let k = k1 - 1; k >= k0; k--) {
        if (S.dot[k] !== 1 || S.u[k] == null || O.u[k] == null || N.u[k] == null) continue;
        const step = N.u[k] - O.u[k];
        if (Math.abs(step) > 1e-6) { pEnd = (S.u[k] - O.u[k]) / step; break; }
      }
      events.push({
        pEnd,
        id: r.id, kind: r.kind, mode: r.mode ?? "real", sex, seq: r.seq, join: j, dir, arm: a, pat, dwell, segS: (k1 - k0) * CHS,
        step: (N.u[k0 + 10] ?? 0) - (O.u[k0 + 10] ?? 0),
        st, th: th ?? (anyLive ? k1 - k0 : null), hdrCens: th === null, hdrLate, startUAt,
        vAt: (kk) => voicedAfter(kk),
        tVoiced: Object.fromEntries(Object.entries(st).map(([kk, v]) => [kk, voicedAfter(v.ttol)])),
        pitch: { pn, pvd, poct },
        drops: { s: dropIn(S), c: dropIn(N) }, hidden: { s: hid(S), c: hid(N) }, states,
      });
    }
  }
}

function pats0() { return [...new Set(events.map((e) => e.pat))].filter((p) => p !== "18/36").sort(); }
const sec = (k) => (k == null ? null : k * CHS);
const f1 = (v) => (v == null ? "—" : v.toFixed(1));
const f2 = (v) => (v == null ? "—" : v.toFixed(2));
const lines = [];
const say = (s = "") => { lines.push(s); console.log(s); };
say(`Parity (worker posts = replica): ${parN - parBad} / ${parN}`);
say(`Events: ${events.length} (${rows.length} streams)`);
say();
const groups = [
  ["a: same reader, pitch kept", (e) => e.kind === "a" && e.mode === "k" && e.pat === "18/36"],
  ["a: same reader, pitch moves", (e) => e.kind === "a" && e.mode === "m" && e.pat === "18/36"],
  ["b: different readers", (e) => e.kind === "b" && e.pat === "18/36"],
];
const DWELL_GROUPS = [
  ["a: same reader (both pitch modes)", (e) => e.kind === "a"],
  ["b: different readers", (e) => e.kind === "b"],
];
const STAGES = ["bin", "all", "cue", "posted", "drawn"];
const summary = {};
for (const metric of ["ttol", "t90", "t50"]) {
  say(`### ${metric}: median s of audio after the join (n events; censored at 18 s)`);
  say();
  say(`| set | arm | dir | n | ${STAGES.join(" | ")} | header | cens. (drawn) |`);
  say(`|---|---|---|---|${STAGES.map(() => "---").join("|")}|---|---|`);
  for (const [label, pred] of groups) for (const arm of ["off", "on"]) for (const dir of ["up", "down"]) {
    const es = events.filter((e) => pred(e) && e.arm === arm && e.dir === dir);
    if (!es.length) continue;
    const m = STAGES.map((s) => med(es.map((e) => sec(e.st[s][metric]))));
    const h = med(es.filter((e) => e.th != null).map((e) => sec(e.th)));
    const cens = es.filter((e) => e.st.drawn[metric === "ttol" ? "ctol" : metric === "t90" ? "c90" : "c50"]).length;
    say(`| ${label} | ${arm} | ${dir} | ${es.length} | ${m.map(f1).join(" | ")} | ${metric === "ttol" ? f1(h) : ""} | ${cens} |`);
    summary[`${metric}|${label}|${arm}|${dir}`] = { n: es.length, stages: Object.fromEntries(STAGES.map((s, i) => [s, m[i]])), header: h, cens };
  }
  say();
}
// up/down ratio and by original sex / by join
say("### Ttol drawn: up vs down by group, original sex and join (arm on)");
say();
say("| set | sex (a) | join | up median | down median | ratio up/down |");
say("|---|---|---|---|---|---|");
for (const [label, pred] of groups) for (const sx of [null, "m", "f"]) for (const jn of [null, 1, 2]) {
  if (label.startsWith("b") && sx) continue;
  const es = events.filter((e) => pred(e) && e.arm === "on" && (sx === null || e.sex === sx) && (jn === null || e.join === jn));
  const u = med(es.filter((e) => e.dir === "up").map((e) => sec(e.st.drawn.ttol)));
  const d = med(es.filter((e) => e.dir === "down").map((e) => sec(e.st.drawn.ttol)));
  say(`| ${label} | ${sx ?? "all"} | ${jn ?? "both"} | ${f1(u)} | ${f1(d)} | ${u && d ? f2(u / d) : "—"} |`);
}
say();
// header by join
say("### Header right: median s after the join, by join (arm on; start = startU found before the join)");
say();
say("| set | join | dir | n | start found | header first right (median s) | never right in the segment | right from 8 s to segment end (median share) | drawn Ttol (median s) |");
say("|---|---|---|---|---|---|---|---|---|");
for (const [label, pred] of [...groups, ...pats0().map((p) => [`dwell ${p}`, (e) => e.pat === p])]) for (const j of [1, 2]) for (const dir of ["up", "down"]) {
  const es = events.filter((e) => pred(e) && e.arm === "on" && e.join === j && e.dir === dir);
  if (!es.length) continue;
  say(`| ${label} | ${j} | ${dir} | ${es.length} | ${es.filter((e) => e.startUAt != null).length} | ${f1(med(es.filter((e) => e.th != null).map((e) => sec(e.th))))} | ${es.filter((e) => e.hdrCens).length} | ${f2(med(es.map((e) => e.hdrLate)))} | ${f1(med(es.map((e) => sec(e.st.drawn.ttol))))} |`);
}
say();
// mechanisms
say("### At the join, per direction (arm on unless said; medians / sums)");
say();
say("| set | dir | step u | start found at join | bins dropped 5 s (switch / control) | why (switch) | hidden voiced hops 5 s (switch / control) | pitch hint 3 s: voicing differs / >1 st off (of hops) | row states 5 s (switch) |");
say("|---|---|---|---|---|---|---|---|---|");
const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];
for (const [label, pred] of groups) for (const dir of ["up", "down"]) {
  const es = events.filter((e) => pred(e) && e.arm === "on" && e.dir === dir);
  if (!es.length) continue;
  const sum = (f) => es.reduce((a, e) => a + f(e), 0);
  const why = {};
  for (const e of es) for (const [k, v] of Object.entries(e.drops.s.why)) why[VERD[k]] = (why[VERD[k]] ?? 0) + v;
  const stt = {};
  for (const e of es) for (const [k, v] of Object.entries(e.states)) stt[k] = (stt[k] ?? 0) + v;
  const tot = Object.values(stt).reduce((a, b) => a + b, 0);
  say(`| ${label} | ${dir} | ${f2(med(es.map((e) => e.step)))} | ${es.filter((e) => e.startUAt != null).length}/${es.length} | ${sum((e) => e.drops.s.d)}/${sum((e) => e.drops.s.t)} vs ${sum((e) => e.drops.c.d)}/${sum((e) => e.drops.c.t)} | ${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(", ")} | ${sum((e) => e.hidden.s)} / ${sum((e) => e.hidden.c)} | ${sum((e) => e.pitch.pvd)} / ${sum((e) => e.pitch.poct)} of ${sum((e) => e.pitch.pn)} | ${Object.entries(stt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / tot).toFixed(0)} %`).join(", ")} |`);
}
say();
// dwell: a short excursion (30 s in the first source, then 6 or 10 s in the other, then back)
const pats = [...new Set(events.map((e) => e.pat))].filter((p) => p !== "18/36").sort();
if (pats.length) {
  say("### Dwell: 30 s in the first source, a short excursion, then back (arm on; medians, s of audio)");
  say();
  say("| set | joins | first source | join | dir | n | T50 drawn | Ttol drawn | censored (Ttol) | p at segment end (drawn) |");
  say("|---|---|---|---|---|---|---|---|---|---|");
  for (const [label, pred] of DWELL_GROUPS) for (const pat of pats) for (const first of ["dark", "bright"]) for (const j of [1, 2]) {
    const es = events.filter((e) => pred(e) && e.arm === "on" && e.pat === pat && e.join === j && ((first === "dark") === (LETTER_BRIGHT[e.seq[0]] === 0)));
    if (!es.length) continue;
    say(`| ${label} | ${pat} | ${first} | ${j} | ${es[0].dir} | ${es.length} | ${f1(med(es.map((e) => sec(e.st.drawn.t50))))} | ${f1(med(es.map((e) => sec(e.st.drawn.ttol))))} | ${es.filter((e) => e.st.drawn.ctol).length} | ${f2(med(es.map((e) => e.pEnd)))} |`);
  }
  say();
}
// the user's scenario: start in one voice, change, change back. "away" = join 1 (out of the
// voice the session started in), "back" = join 2 (return to it). Tdb = from then on within
// 0.3 u (the header deadband) of the new voice's control.
say("### Away and back (arm on; drawn; medians s of audio; censored at the segment end)");
say();
say("| set | joins | first source | n | away: T50 | Tdb | Ttol | back: T50 | Tdb | Ttol | ratio away/back Tdb | ratio T50 |");
say("|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const [label, pred] of [["a: same reader", (e) => e.kind === "a"], ["b: different readers", (e) => e.kind === "b"]]) for (const pat of ["18/36", "30/36", "30/40"]) for (const first of ["dark", "bright", "both"]) {
  const es = events.filter((e) => pred(e) && e.arm === "on" && e.pat === pat && (first === "both" || (first === "dark") === (LETTER_BRIGHT[e.seq[0]] === 0)));
  if (!es.length) continue;
  const A = es.filter((e) => e.join === 1), Bk = es.filter((e) => e.join === 2);
  const m = (xs, key) => med(xs.map((e) => sec(e.st.drawn[key])));
  const r1 = m(A, "tdb") / m(Bk, "tdb"), r2 = m(A, "t50") / m(Bk, "t50");
  say(`| ${label} | ${pat} | ${first} | ${A.length} | ${f1(m(A, "t50"))} | ${f1(m(A, "tdb"))} | ${f1(m(A, "ttol"))} | ${f1(m(Bk, "t50"))} | ${f1(m(Bk, "tdb"))} | ${f1(m(Bk, "ttol"))} | ${Number.isFinite(r1) ? f2(r1) : "—"} | ${Number.isFinite(r2) ? f2(r2) : "—"} |`);
}
say();
const jf = arg("json", "");
if (jf) writeFileSync(jf, JSON.stringify({ summary, events: events.map(({ vAt, ...e }) => e) }, null, 1));
