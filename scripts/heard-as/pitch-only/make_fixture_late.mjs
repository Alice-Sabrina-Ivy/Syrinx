// make_fixture_late.mjs — the late-switch-on fixture for tests/ml/pitch-only-warning-test.js
// (measurements/heard-as-pitch-only-warning-2026-10-07.md §8.9 (f) 2): KS-Q5 adopted 2026-10-13.
// Public data only (LibriSpeech, Multilingual LibriSpeech — CC BY 4.0; derived numbers, no audio).
//
// Inputs: the round-2 late-panel study's fresh test pool (§8.8): its recorded per-panel main-thread call streams
// (test_0.jsonl / test_1.jsonl: posted pitch frames "p", resonance posts "r" with each panel stream's own clock, panel
// updates with lnF0, the drawn share and the audio clock), its scored replay (rep_test.json, the KS-Q5 strings), and
// the study's harness module late-variants-r2.js (sha256 956061543a…, asserted). All stay in the study's scratch folder.
//
//   node scripts/heard-as/pitch-only/make_fixture_late.mjs --harness=<late-variants-r2.js> --rep=<rep_test.json> \
//        <test_0.jsonl> <test_1.jsonl>
//
// Chosen panels (§8.9 (f) 2 (i)): a male-base and a female-base pitch-only session that KS-Q5 hit at T30, T60 and
// T120 (the first by key order hit at T120 in all four phases: hcsL_ls2654_PO, hcsL_ls1474_PO; the latter's T30p0
// got a start share); natL_ls3792 at T120 (the failed check's reader); hcsL_ls2473_PO at T120p450 (the Q5 window
// never closes); hcsL_ls3171_PO at T60p1050 (one of the few panels where a 7.9 s seed window changes the output); a
// natural woman with no warning (natL_ls1474, the first by key order); and two panels on from the start. Since the
// §8.9 review fixes also panels where three K-seed rules change the output (no other panel does): the seed's F0
// range check (hcsL_mlspo3492_PO T30p1500 / T120p1500), copying the shadow's pending values at the first triggered
// update (hcsL_ls2853_PO T30p1500, hcsL_ls2694_PO T30p0) and the shadow's back-fill of them (hcsL_ls2853_PO T60p1500).
// Per session the fixture keeps every posted frame (times as t0 + 25 ms steps with exceptions, voicing as runs, the
// voiced f0 as base64 float64 — exact), the resonance posts that set t_fill / t_start, change the verdict or are the
// last before an included update (with each included stream's clock), and each panel's updates. EXPECTED: the
// harness's KS-Q5 variant (an implementation independent of src/ml/pitch-only-warning.js) per update — on/off (equal
// to rep_test.json's KS-Q5 string), held() after it, pitchStart() before it. The synthetic cases of
// late_synthetic.mjs get the harness's values too. The script refuses to write unless the harness gives the same
// values on the pruned stream as on the full one and the repo module reproduces them on both.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { LATE_CASES, callsFor, play } from "./late_synthetic.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../..");
const OUT = path.join(REPO, "tests/ml/fixtures/pitch-only-late.json");
const argv = process.argv.slice(2);
const opt = (n) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : null; };
const inputs = argv.filter((a) => !a.startsWith("--"));
const HARNESS = opt("harness"), REP = opt("rep");
if (!HARNESS || !REP || !inputs.length) throw new Error("usage: make_fixture_late.mjs --harness=<late-variants-r2.js> --rep=<rep_test.json> <test_*.jsonl>...");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
if (sha(HARNESS) !== "956061543a15b0372543fc32e797edbf316ac05632129bbf528a501d1d5de241") throw new Error("late-variants-r2.js is not 956061543a…");
const LV = await import(pathToFileURL(path.resolve(HARNESS)).href);
const M = await import(pathToFileURL(path.join(REPO, "src/ml/pitch-only-warning.js")).href);
const harness = () => LV.createPitchOnlyWarning({ ...LV.PITCH_ONLY_WARNING, fallback: LV.LATE_CANDIDATES["KS-Q5"] });
const REPS = JSON.parse(readFileSync(REP, "utf8")).sessions;

const WANT = {
  hcsL_ls2654_PO: { why: "male base, pitch-only, hit at T30 / T60 / T120", panels: ["on0p0", "T30p0", "T60p0", "T120p0"] },
  hcsL_ls1474_PO: { why: "female base, pitch-only, hit at T30 / T60 / T120 (T30p0 got a start share)", panels: ["T30p0", "T60p0", "T120p0"] },
  natL_ls3792: { why: "natural reading, the man of the failed check (T120)", panels: ["on0p0", "T120p0", "T120p450", "T120p1050", "T120p1500"] },
  hcsL_ls2473_PO: { why: "male base, T120p450: the Q5 window never closes", panels: ["T120p450"] },
  hcsL_ls3171_PO: { why: "a panel where a 7.9 s seed window changes the output", panels: ["T60p1050"] },
  natL_ls1474: { why: "natural reading, a woman with no warning", panels: ["T30p0", "T120p0"] },
  hcsL_mlspo3492_PO: { why: "panels where the seed's F0 range check changes the output", panels: ["T30p1500", "T120p1500"] },
  hcsL_ls2853_PO: { why: "panels where copying the shadow's pending values (T30p1500) and its back-fill (T60p1500) change the output", panels: ["T30p1500", "T60p1500"] },
  hcsL_ls2694_PO: { why: "a panel where copying the shadow's pending values changes the output", panels: ["T30p0"] },
};

function panelsOf(r) {
  const out = [];
  const ph = r.phases ?? [0];
  out.push({ name: `on0p${ph[0]}`, stream: "on0", U: null, Rclk: null });
  for (let j = 1; j < ph.length; j++) out.push({ name: `on0p${ph[j]}`, stream: "on0", U: r.uX[j - 1], Rclk: null });
  for (const P of r.late.panels) { const St = r.late.streams[P.stream]; out.push({ name: `${P.cond}p${P.ph}`, stream: St.name, U: P.U, Rclk: St.Rclk }); }
  return out;
}
/** The recorded calls of one panel, in order: ["p", t, f0|null], ["r", snap, clock, rIndex], ["u", lnF0, share, clock, evIndex]. */
function callsOf(r, P) {
  const calls = []; let k = 0, ri = 0;
  for (let i = 0; i < r.ev.length; i++) {
    if (P.U) while (k < P.U.length && P.U[k][0] === i) { const u = P.U[k++]; calls.push(["u", u[2], u[3], u[4], i]); }
    const e = r.ev[i];
    if (e[0] === "p") calls.push(["p", e[1], e[2] > 0 ? e[2] : null]);
    else if (e[0] === "r") { calls.push(["r", { type: "state", u: e[1], startU: e[2], fill: e[3], verdict: e[4], sinceResumeS: e[5] }, P.Rclk ? P.Rclk[ri] : e[6], ri]); ri++; }
    else if (e[0] === "u" && !P.U) calls.push(["u", e[2], e[3], e[4], i]);
  }
  if (P.U) while (k < P.U.length) { const u = P.U[k++]; calls.push(["u", u[2], u[3], u[4], r.ev.length]); }
  return calls;
}
const same = (a, b) => a.on === b.on && a.held === b.held && a.p0.length === b.p0.length && a.p0.every((v, i) => Object.is(v, b.p0[i]));
const p0Changes = (p0) => { const out = []; p0.forEach((v, i) => { if (i === 0 || !Object.is(v, p0[i - 1])) out.push([i, v]); }); return out; };

const sessions = [];
const found = new Set();
for (const f of inputs) for (const line of readFileSync(f, "utf8").split("\n")) {
  if (!line.trim()) continue;
  const key = line.slice(8, line.indexOf('"', 8));
  if (!WANT[key]) continue;
  const r = JSON.parse(line);
  found.add(key);
  const panels = panelsOf(r).filter((P) => WANT[key].panels.includes(P.name));
  // the frames
  const fr = r.ev.filter((e) => e[0] === "p");
  const t0 = fr[0][1], tx = {};
  fr.forEach((e, i) => { if (e[1] !== t0 + 25 * i) tx[i] = e[1]; });
  const runs = []; let cur = false, len = 0; const vf = [];
  for (const e of fr) { const v = e[2] > 0; if (v !== cur) { runs.push(len); cur = v; len = 0; } len++; if (v) vf.push(e[2]); }
  runs.push(len);
  // the resonance posts kept: t_fill, t_start, verdict changes, a startU back to null, the last before each update
  const rs = r.ev.filter((e) => e[0] === "r");
  const keep = new Set();
  let fillSeen = false, startSeen = false, prevV, sawStartU = false;
  rs.forEach((e, k) => {
    if (!fillSeen && (e[3] ?? 0) >= 1) { fillSeen = true; keep.add(k); }
    if (fillSeen && !startSeen && e[2] != null) { startSeen = true; keep.add(k); }
    if (k === 0 || e[4] !== prevV) keep.add(k);
    if (e[2] == null && sawStartU) keep.add(k);
    if (e[2] != null) sawStartU = true;
    prevV = e[4];
  });
  const full = {};
  for (const P of panels) {
    full[P.name] = callsOf(r, P);
    let last = -1;
    for (const c of full[P.name]) { if (c[0] === "r") last = c[3]; else if (c[0] === "u" && last >= 0) keep.add(last); }
  }
  const kept = [...keep].sort((a, b) => a - b);
  // flat order of frames and kept posts; positions of the kept posts
  const flat = []; let fi = 0, rk = 0;
  for (const e of r.ev) { if (e[0] === "p") flat.push(["p", fi++]); else if (e[0] === "r") { if (keep.has(rk)) flat.push(["r", rk]); rk++; } }
  const rPos = {}; flat.forEach((x, i) => { if (x[0] === "r") rPos[x[1]] = i; });
  const streams = {};
  const outPanels = [];
  for (const P of panels) {
    // updates: number of flat items before each
    const U = []; let pos = 0;
    for (const c of full[P.name]) {
      if (c[0] === "p") pos++;
      else if (c[0] === "r") { if (keep.has(c[3])) pos++; }
      else U.push([pos, c[1], c[2], c[3]]);
    }
    streams[P.stream] ??= kept.map((k) => (P.Rclk ? P.Rclk[k] : rs[k][6]));
    const exp = play(harness(), full[P.name]);
    const rec = REPS[key][P.name]["KS-Q5"];
    if (exp.on !== rec) throw new Error(`${key} ${P.name}: the harness does not reproduce rep_test.json's KS-Q5 string`);
    outPanels.push({ name: P.name, stream: P.stream, U, expect: { on: exp.on, held: exp.held, p0: p0Changes(exp.p0) } });
  }
  const ts = r.bounds.find((b) => b.phase === "shift")?.t0 ?? null;
  sessions.push({ key, why: WANT[key].why, sex: r.meta.sex, set: r.meta.set, corpus: r.meta.corpus, tshiftS: ts,
    frames: { n: fr.length, t0, tx, runs, f0: Buffer.from(Float64Array.from(vf).buffer).toString("base64") },
    res: kept.map((k) => [rPos[k], rs[k][1], rs[k][2], rs[k][3], rs[k][4], rs[k][5]]), streams, panels: outPanels, _full: full });
}
for (const k of Object.keys(WANT)) if (!found.has(k)) throw new Error(`session ${k} not in the inputs`);

/** The test's decoder (kept identical to tests/ml/pitch-only-warning-test.js). */
function decodeCalls(s, P) {
  const fb = Buffer.from(s.frames.f0, "base64");
  const vf = new Float64Array(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength));
  const frames = []; let v = false, vi = 0, i = 0;
  for (const n of s.frames.runs) { for (let k = 0; k < n; k++, i++) frames.push([s.frames.tx[i] ?? s.frames.t0 + 25 * i, v ? vf[vi++] : null]); v = !v; }
  const clk = s.streams[P.stream];
  const rAt = new Map(s.res.map((x, k) => [x[0], k]));
  const N = s.frames.n + s.res.length, calls = [];
  let fi = 0, ui = 0;
  for (let pos = 0; pos <= N; pos++) {
    while (ui < P.U.length && P.U[ui][0] === pos) { const u = P.U[ui++]; calls.push(["u", u[1], u[2], u[3]]); }
    if (pos === N) break;
    if (rAt.has(pos)) { const x = s.res[rAt.get(pos)]; calls.push(["r", { type: "state", u: x[1], startU: x[2], fill: x[3], verdict: x[4], sinceResumeS: x[5] }, clk[rAt.get(pos)]]); }
    else { const f = frames[fi++]; calls.push(["p", f[0], f[1]]); }
  }
  return calls;
}
const expand = (e, n) => { const p0 = new Array(n); let k = 0; for (let i = 0; i < n; i++) { while (k + 1 < e.p0.length && e.p0[k + 1][0] <= i) k++; p0[i] = e.p0[k][1]; } return { on: e.on, held: e.held, p0 }; };
let checks = 0;
for (const s of sessions) for (const P of s.panels) {
  const want = expand(P.expect, P.expect.on.length);
  const pruned = decodeCalls(s, P), full = s._full[P.name];
  if (!same(play(harness(), pruned), want)) throw new Error(`${s.key} ${P.name}: the harness differs on the pruned stream`);
  if (!same(play(M.createPitchOnlyWarning(), pruned), want)) throw new Error(`${s.key} ${P.name}: the repo module differs on the pruned stream`);
  if (!same(play(M.createPitchOnlyWarning(), full), want)) throw new Error(`${s.key} ${P.name}: the repo module differs on the full stream`);
  checks++;
}
const synthetic = [];
for (const [name, spec] of Object.entries(LATE_CASES)) {
  const calls = callsFor(spec);
  const exp = play(harness(), calls);
  if (!same(play(M.createPitchOnlyWarning(), calls), exp)) throw new Error(`synthetic ${name}: the repo module differs from the harness`);
  const times = calls.filter((c) => c[0] === "u").map((c) => c[3]);
  const firstOn = exp.on.indexOf("1");
  synthetic.push({ name, spec, expect: { on: exp.on, held: exp.held, p0: p0Changes(exp.p0), firstWarningMs: firstOn < 0 ? null : times[firstOn] } });
}
for (const s of sessions) delete s._full;
const fixture = {
  about: "Late-switch-on (KS-Q5) fixture for tests/ml/pitch-only-warning-test.js — measurements/heard-as-pitch-only-warning-2026-10-07.md §8.9 (f) 2. "
    + "Public data only: LibriSpeech / Multilingual LibriSpeech (CC BY 4.0) via §8.8's fresh test pool; derived numbers, no audio. "
    + "frames: n posted frames at t0 + 25 ms steps (tx: exceptions by index), runs = alternating unvoiced / voiced run lengths (unvoiced first), "
    + "f0 = the voiced values as base64 little-endian float64. res: [flat position, u, startU, fill, verdict, sinceResumeS] — the kept resonance "
    + "posts; streams: each panel stream's audio clock per kept post. Flat order = frames and kept posts; a panel update [at, lnF0, share, "
    + "audioMs] comes before flat item `at`. expect: the round-2 harness's KS-Q5 variant (late-variants-r2.js 956061543a…): on/off and held() "
    + "per update, pitchStart() before it as [first update index, value] changes. synthetic: late_synthetic.mjs cases with the same expectations.",
  generated: "scripts/heard-as/pitch-only/make_fixture_late.mjs",
  sources: { harness: sha(HARNESS), rep: sha(REP), inputs: inputs.map((p) => [path.basename(p), sha(p)]) },
  sessions, synthetic,
};
const json = JSON.stringify(fixture);
writeFileSync(OUT, json);
console.log(`${path.relative(REPO, OUT)}: ${(json.length / 1024).toFixed(0)} KB, ${sessions.length} sessions, ${checks} panels, ${synthetic.length} synthetic cases`);
for (const s of sessions) console.log(`  ${s.key} (${s.sex}): ${s.panels.map((P) => `${P.name} ${[...P.expect.on].filter((c) => c === "1").length}/${P.expect.on.length}`).join(", ")}; ${s.res.length} posts kept`);
for (const c of synthetic) console.log(`  synthetic ${c.name}: first warning ${c.expect.firstWarningMs === null ? "never" : `${c.expect.firstWarningMs / 1000} s`}`);
