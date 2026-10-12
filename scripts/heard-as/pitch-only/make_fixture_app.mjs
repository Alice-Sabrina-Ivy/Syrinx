// make_fixture_app.mjs — the golden replay fixture for tests/ml/pitch-only-warning-test.js at the APP cadence
// (2026-10-12, the adopted rule A40+KP8-3+DS10; measurements/heard-as-pitch-only-warning-2026-10-07.md §8.6).
// Public data only (LibriSpeech, Multilingual LibriSpeech; derived numbers, no audio).
//
// Input: the §8.5 study's app-cadence session records (its harness session_app.mjs: every main-thread event the
// warning gets, in order — posted pitch frames "p", resonance posts "r" with the hook's audio clock, panel updates
// "u" with lnF0, the drawn share and the audio clock; four panel phases per session) and the study's scored replay
// strings (replay2.mjs: rep_<split>_p<phase>.json, "<rule>|app"). Both stay in the study's scratch folder.
//
//   node scripts/heard-as/pitch-only/make_fixture_app.mjs --rep-dir=<select/out> <test_0.jsonl> <test_1.jsonl>
//
// Per chosen (session, phase) the fixture keeps the event stream needed to reproduce every update (pitch frames up to
// the first one past t_fill + 40 s, after which A40 is frozen and frames change nothing; the resonance posts that
// change fill >= 1 / startU-set, plus the last one before each update), rounded (f0 2 dp, u 4 dp, share 6 dp, lnF0
// 7 dp). EXPECTED values are the study's own scored strings (the harness's variant module, an implementation
// independent of src/ml/pitch-only-warning.js): the adopted rule's on/off per update and S0's (S0's also equal to the
// real module's live output recorded in the loop). The script refuses to write unless the repo module on the pruned,
// rounded stream reproduces both strings AND its own output on the full stream (on, held(), pitchStart()).
import { readFileSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "../../..");
const M = await import(pathToFileURL(path.join(REPO, "src/ml/pitch-only-warning.js")).href);
const argv = process.argv.slice(2);
const opt = (n) => { const a = argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split("=").slice(1).join("=") : null; };
const REP_DIR = opt("rep-dir");
const inputs = argv.filter((a) => !a.startsWith("--"));
if (!REP_DIR || !inputs.length) throw new Error("usage: make_fixture_app.mjs --rep-dir=<dir> <app.jsonl>...");
const OUT = path.join(REPO, "tests/ml/fixtures/pitch-only-golden.json");
const CH = "A40+KP8-3+DS10";

// [key, phase, why] — test split of §8.5 (fresh speakers never used for selection).
const PICK = [
  ["ehcs_ls3780_PO", 0, "pitch only, male base: warned, back at once after brief hides"],
  ["ehcs_ls4305_PO", 0, "pitch only, female base: warned, back at once after brief hides"],
  ["ehcs_mlspo5090_PO", 0, "pitch only, male base: the reader behind most lost male hits (S0 warns, the adopted rule late)"],
  ["ehcs_ls3088_PO", 0, "pitch only, male base: KP8 (variable reader) holds the warning back"],
  ["picka_ls4563_-6_+0.0", 0, "pitch only (-6 st), female base: DS10 holds it back (the drawn share hardly moved)"],
  ["hcs_ls3657A_PE", 0, "pitch + resonance together, male: never"],
  ["hcs_mlspo4067A_PE", 0, "pitch + resonance together, female: S0 warned on 20 updates, the adopted rule never"],
  ["hcs_ls3780A_EO", 0, "resonance only, male: never"],
  ["hcs_ls2598A_EO", 0, "resonance only, female: S0 flashed twice, the adopted rule never"],
  ["nat_mlsdu4429", 0, "natural reading, man: S0's worst reader (7 of 8 eligible updates), adopted 0"],
  ["nat_ls3783", 0, "natural reading, man: the adopted rule's worst reader (residual false alarms)"],
  ["nat_ls6300", 0, "natural reading, woman: S0's worst woman, adopted 0"],
  ["nat_mlsdu4429_skip2", 1000, "natural reading from a later start, man, panel phase 1000 ms: S0 20, adopted 0"],
  ["ehcs_ls4305_PO", 1500, "pitch only, female base, panel phase 1500 ms"],
];

function* lines(p) {
  const fd = openSync(p, "r"); const buf = Buffer.alloc(1 << 22); let rest = "";
  for (;;) { const n = readSync(fd, buf, 0, buf.length, null); if (!n) break; rest += buf.toString("utf8", 0, n);
    let i; while ((i = rest.indexOf("\n")) >= 0) { const l = rest.slice(0, i); rest = rest.slice(i + 1); if (l.trim()) yield l; } }
  if (rest.trim()) yield rest; closeSync(fd);
}
function streamFor(r, PHASE) {
  if (PHASE === (r.cfg?.phaseMs ?? 0)) return { ev: r.ev, upd: r.upd };
  const j = (r.phases ?? []).indexOf(PHASE);
  if (j < 1) throw new Error(`${r.key}: phase ${PHASE} not recorded`);
  const U = r.uX[j - 1], ev = [];
  let k = 0;
  for (let i = 0; i < r.ev.length; i++) {
    while (k < U.length && U[k][0] === i) ev.push(["u", ...U[k++].slice(1)]);
    if (r.ev[i][0] !== "u") ev.push(r.ev[i]);
  }
  while (k < U.length) ev.push(["u", ...U[k++].slice(1)]);
  return { ev, upd: r.updX[j - 1] };
}
// Drive a module over [p|r|u] events -> on / held / pitchStart strings.
function drive(w, ev) {
  let res = null; const on = [], held = [], p0 = [];
  for (const e of ev) {
    if (e[0] === "p") w.addPitch({ audioMs: e[1], f0: e[2] > 0 ? e[2] : null });
    else if (e[0] === "r") { res = { u: e[1], startU: e[2], fill: e[3], verdict: e[4], sinceResumeS: e[5] }; w.noteResonance(res, e[6]); }
    else if (e[0] === "u") {
      p0.push(w.pitchStart());
      on.push(w.update({ lnF0: e[2], resonance: res, share: e[3], audioMs: e[4] }) ? "1" : "0");
      held.push(w.held() ? "1" : "0");
    }
  }
  return { on: on.join(""), held: held.join(""), p0 };
}
const rnd = (v, d) => (typeof v === "number" ? +v.toFixed(d) : v);

function prune(ev) {
  // epochs of t_fill / t_start (a resonance restart starts a new one); the reference spans
  // [t_fill, max(t_start, t_fill + 40 s)]
  let tFill = null, tStart = null, saw = false, cut = -Infinity;
  for (const e of ev) {
    if (e[0] !== "r") continue;
    if (e[2] == null) { if (saw) { tFill = null; tStart = null; saw = false; } } else saw = true;
    if (tFill === null && (e[3] ?? 0) >= 1) { tFill = e[6]; cut = Math.max(cut, tFill + 40000); }
    if (tFill !== null && tStart === null && e[2] != null) { tStart = e[6]; cut = Math.max(cut, tStart); }
  }
  const out = [];
  let pastCut = false, prevKey = null;
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i];
    if (e[0] === "p") {
      if (e[1] > cut) { if (pastCut) continue; pastCut = true; }
      out.push(["p", e[1], rnd(e[2], 2)]);
    } else if (e[0] === "r") {
      const key = `${(e[3] ?? 0) >= 1}|${e[2] == null}`;
      let nextIsU = false;
      for (let j = i + 1; j < ev.length; j++) { if (ev[j][0] === "r") break; if (ev[j][0] === "u") { nextIsU = true; break; } }
      if (key !== prevKey || nextIsU) out.push(["r", rnd(e[1], 4), rnd(e[2], 4), rnd(e[3], 4), e[4], rnd(e[5], 2), e[6]]);
      prevKey = key;
    } else if (e[0] === "u") {
      out.push(["u", e[1], rnd(e[2], 7), rnd(e[3], 6), e[4]]);
    }
  }
  return out;
}
// Compact form: pitch frames as runs over two arrays (times implied at +25 ms unless listed in tx).
function encode(ev) {
  const pf = [], tx = {}, toks = [];
  let t0 = null, run = 0;
  const flush = () => { if (run) { toks.push(run); run = 0; } };
  for (const e of ev) {
    if (e[0] === "p") {
      const i = pf.length;
      if (t0 === null) t0 = e[1];
      if (e[1] !== t0 + i * 25) tx[i] = e[1];
      pf.push(e[2]); run++;
    } else { flush(); toks.push(e); }
  }
  flush();
  return { t0, pf, tx, ev: toks };
}
function decode(s) {
  const ev = []; let i = 0;
  for (const t of s.ev) {
    if (typeof t === "number") { for (let k = 0; k < t; k++, i++) ev.push(["p", s.tx[i] ?? s.t0 + i * 25, s.pf[i]]); }
    else ev.push(t);
  }
  return ev;
}

const need = new Map(PICK.map(([k]) => [k, null]));
for (const p of inputs) for (const l of lines(p)) {
  const m = /^\{"key":"([^"]+)"/.exec(l);
  if (m && need.has(m[1])) need.set(m[1], JSON.parse(l));
}
const repCache = {};
const repFor = (split, ph) => (repCache[`${split}${ph}`] ??= JSON.parse(readFileSync(path.join(REP_DIR, `rep_${split}_p${ph}.json`), "utf8")).sessions);
const sessions = [];
for (const [key, phase, why] of PICK) {
  const r = need.get(key);
  if (!r) throw new Error(`${key} not found`);
  const S = streamFor(r, phase);
  const rep = repFor(r.meta.split, phase)[key];
  const expCh = rep[`${CH}|app`], expS0 = rep["S0|app"];
  const live = S.upd.map((u) => (u[8] ? "1" : "0")).join("");
  if (expS0 !== live) throw new Error(`${key}@${phase}: S0 replay string != the real module's live output`);
  const pruned = prune(S.ev);
  const enc = encode(pruned);
  const back = decode(enc);
  for (const [name, C, exp] of [["adopted", M.PITCH_ONLY_WARNING, expCh], ["S0", M.S0_CONFIG, expS0]]) {
    const full = drive(M.createPitchOnlyWarning(C), S.ev), cut = drive(M.createPitchOnlyWarning(C), back);
    if (full.on !== exp) throw new Error(`${key}@${phase} ${name}: repo module on the full stream != the study's string`);
    // pitchStart() moves by the f0 rounding only (< 0.01 Hz -> < 1e-4 in ln Hz); on / held must be identical.
    const p0Same = cut.p0.length === full.p0.length && cut.p0.every((v, i) => (v === null) === (full.p0[i] === null) && (v === null || Math.abs(v - full.p0[i]) < 1e-4));
    if (cut.on !== full.on || cut.held !== full.held || !p0Same) throw new Error(`${key}@${phase} ${name}: pruned / rounded stream changes the output (on ${cut.on === full.on}, held ${cut.held === full.held}, p0 ${p0Same})`);
  }
  const shift = r.bounds.find((b) => b.phase === "shift");
  const kind = r.meta.set === "nat" || r.meta.set === "off" ? "natural"
    : r.meta.set === "picka" ? (r.meta.dvtl === 0 ? "pitch" : "other")
      : { PO: "pitch", PE: "together", EO: "resonance" }[r.meta.cond] ?? "other";
  const p0 = drive(M.createPitchOnlyWarning(), back).p0.filter((v) => v !== null).at(-1) ?? null;
  sessions.push({ key, phase, why, sex: r.meta.sex, corpus: r.meta.corpus, kind, tShiftMs: shift ? +(shift.t0 * 1000).toFixed(3) : null,
    ...enc, expect: { on: expCh, onS0: expS0, p0 } });
}
const G = {
  rule: { name: CH, ...M.PITCH_ONLY_WARNING },
  source: "measurements/heard-as-pitch-only-warning-2026-10-07.md §8.5-8.6: test split, app-cadence harness; expected = the study's scored replay strings",
  sessions,
};
writeFileSync(OUT, JSON.stringify(G));
console.log(`wrote ${OUT}: ${sessions.length} session-phases, ${(JSON.stringify(G).length / 1024).toFixed(0)} KB`);
for (const s of sessions) console.log(`  ${s.key}@${s.phase} ${s.sex} ${s.kind}: adopted ${[...s.expect.on].filter((c) => c === "1").length}, S0 ${[...s.expect.onS0].filter((c) => c === "1").length} of ${s.expect.on.length} updates; frames ${s.pf.length}, events ${s.ev.length}`);
