// summarize.mjs — applies measurements/exercise-take-checks-2026-10-27.md §1 to the rows,
// mechanically: pass shares per sex x condition cell for every candidate T (count b, count a
// beside it), the selection rule on the selection set, the confirmation step, the negatives'
// flag shares at the chosen T, the "too short" check and R4's try-pitch figures.
//
//   node scripts/exercises/take-checks/summarize.mjs [--out=build/exercise-take-checks]
// -> <out>/summary.txt and <out>/summary.json
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? "1"] : [a, "1"];
}));
const OUT = resolve(args.out ?? "build/exercise-take-checks");
const load = (set) => readFileSync(resolve(OUT, `rows-${set}.jsonl`), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const ROWS = { sel: load("sel"), conf: load("conf"), neg: load("neg") };

// ---- §1 constants ----
const CANDIDATES = [0.25, 0.5, 0.75, 1.0];
const SEL_BAR = 0.99;   // every cell, selection set
const CONF_BAR = 0.98;  // every cell, confirmation set
const SEXES = ["m", "f"];
const CONDS = ["clean", "quiet", "noisy"];
const TYPES = ["single", "double"];
const TOO_SHORT = { single: 1.0, double: 3.0 };
const TRY_PITCH_MIN_S = 1.0;
const NEG_CLASSES = ["n1", "n2", "n3", "n4", "n5", "n6"];
const EPS = 1e-9;

const lines = [];
const P = (s = "") => lines.push(s);
const pct = (x) => (x == null || Number.isNaN(x) ? "  -  " : (100 * x).toFixed(1).padStart(5));
const J = {};

const cellRows = (set, type, sex, cond) => ROWS[set].filter((r) => r.type === type && r.sex === sex && r.cond === cond);
const share = (rows, pred) => (rows.length ? rows.filter(pred).length / rows.length : NaN);
const passShare = (rows, key, T) => share(rows, (r) => r[key] >= T - EPS);

function quantile(v, q) { // linear interpolation between order statistics (numpy's default)
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const h = (s.length - 1) * q;
  const lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

function passTable(set, type, key) {
  const t = {};
  for (const T of CANDIDATES) {
    t[T] = {};
    for (const sex of SEXES) for (const cond of CONDS) {
      const rows = cellRows(set, type, sex, cond);
      t[T][`${sex}-${cond}`] = { n: rows.length, pass: rows.filter((r) => r[key] >= T - EPS).length, share: passShare(rows, key, T) };
    }
  }
  return t;
}
const allCellsAtLeast = (tab, T, bar) => Object.values(tab[T]).every((c) => c.n > 0 && c.share >= bar - EPS);

/** §1 selection rule + confirmation step, on count `key`. */
function select(type, key) {
  const sel = passTable("sel", type, key);
  const conf = passTable("conf", type, key);
  const trace = [];
  const okSel = CANDIDATES.filter((T) => allCellsAtLeast(sel, T, SEL_BAR));
  if (!okSel.length) { trace.push("selection: no candidate reaches 99.0 % in every cell -> STOP"); return { sel, conf, chosenSel: null, chosen: null, stop: true, trace }; }
  const chosenSel = Math.max(...okSel);
  trace.push(`selection: largest T with every cell >= 99.0 % = ${chosenSel} s`);
  let i = CANDIDATES.indexOf(chosenSel);
  while (i >= 0) {
    const T = CANDIDATES[i];
    if (allCellsAtLeast(conf, T, CONF_BAR)) { trace.push(`confirmation at ${T} s: every cell >= 98.0 % -> T = ${T} s`); return { sel, conf, chosenSel, chosen: T, stop: false, trace }; }
    const low = Object.entries(conf[T]).filter(([, c]) => !(c.share >= CONF_BAR - EPS)).map(([k, c]) => `${k} ${pct(c.share).trim()} %`);
    if (T === CANDIDATES[0]) { trace.push(`confirmation at ${T} s: cells under 98.0 % (${low.join(", ")}) -> STOP (no voice check, only "too short")`); return { sel, conf, chosenSel, chosen: null, stop: true, trace }; }
    trace.push(`confirmation at ${T} s: cells under 98.0 % (${low.join(", ")}) -> step down`);
    i--;
  }
  return { sel, conf, chosenSel, chosen: null, stop: true, trace };
}

function printPass(title, tabB, tabA) {
  P(title);
  P(`  T (s)  | ${SEXES.flatMap((s) => CONDS.map((c) => `${s}-${c}`.padEnd(21))).join(" ")}`);
  for (const T of CANDIDATES) {
    P(`  ${String(T).padEnd(6)} | ${SEXES.flatMap((s) => CONDS.map((c) => {
      const b = tabB[T][`${s}-${c}`], a = tabA[T][`${s}-${c}`];
      return `${(100 * b.share).toFixed(2)} [${b.n - b.pass}] (${(100 * a.share).toFixed(2)})`.padEnd(21);
    })).join(" ")}`);
  }
  const n0 = tabB[CANDIDATES[0]];
  P(`  n      | ${SEXES.flatMap((s) => CONDS.map((c) => String(n0[`${s}-${c}`].n).padEnd(21))).join(" ")}`);
  P(`  (pass share in % on count b [takes under T]; count a's share in round brackets)`);
}

P("Take checks — measurements/exercise-take-checks-2026-10-27.md §1 applied to the rows");
P(`rows: selection ${ROWS.sel.length}, confirmation ${ROWS.conf.length}, negatives ${ROWS.neg.length}`);
const det = (rows) => rows.reduce((a, r) => { for (const k of ["voice", "novoice", "none", "late", "dropped", "dspMulti"]) a[k] = (a[k] ?? 0) + r.det[k]; return a; }, {});
for (const s of ["sel", "conf", "neg"]) P(`detector decisions ${s}: ${JSON.stringify(det(ROWS[s]))}`);
J.detector = Object.fromEntries(["sel", "conf", "neg"].map((s) => [s, det(ROWS[s])]));
P("");

// ---- takes per cell, b distribution ----
P("Takes and voice per cell (count b in s: min / 1st pct / 5th pct / median; count a median)");
for (const set of ["sel", "conf"]) for (const type of TYPES) {
  for (const sex of SEXES) for (const cond of CONDS) {
    const rows = cellRows(set, type, sex, cond);
    const b = rows.map((r) => r.b), a = rows.map((r) => r.a);
    P(`  ${set.padEnd(4)} ${type.padEnd(6)} ${sex}-${cond.padEnd(5)} n=${String(rows.length).padStart(3)}  b ${Math.min(...b).toFixed(3)} / ${quantile(b, 0.01).toFixed(3)} / ${quantile(b, 0.05).toFixed(3)} / ${quantile(b, 0.5).toFixed(3)}   a med ${quantile(a, 0.5).toFixed(3)}   speech med ${quantile(rows.map((r) => r.speechS), 0.5).toFixed(2)} s`);
  }
}
P("");

// ---- selection rule ----
J.selection = {};
for (const type of TYPES) {
  const rb = select(type, "b");
  const ra = select(type, "a");
  J.selection[type] = { b: rb, a: { chosenSel: ra.chosenSel, chosen: ra.chosen, stop: ra.stop, trace: ra.trace } };
  P(`=== ${type.toUpperCase()} takes (${type === "single" ? "R3's take: one sentence" : "R4's try: the sentence twice"}) ===`);
  printPass("Selection set (dev-clean):", rb.sel, ra.sel);
  printPass("Confirmation set (test-clean):", rb.conf, ra.conf);
  P("Rule on count b (binding):");
  for (const t of rb.trace) P(`  ${t}`);
  P(`  => ${rb.stop ? "STOP" : `chosen T = ${rb.chosen} s`}`);
  P("Same rule on count a (reported, not binding):");
  for (const t of ra.trace) P(`  ${t}`);
  P(`  => ${ra.stop ? "STOP" : `T = ${ra.chosen} s`}`);
  // failing takes at the chosen T (or at 0.25 on STOP)
  const Tshow = rb.chosen ?? CANDIDATES[0];
  for (const set of ["sel", "conf"]) {
    const fail = ROWS[set].filter((r) => r.type === type && r.b < Tshow - EPS);
    P(`  ${set} takes with b < ${Tshow} s: ${fail.length}${fail.length ? " — " + fail.slice(0, 12).map((r) => `${r.takeId} ${r.cond} b=${r.b} a=${r.a}`).join("; ") : ""}`);
  }
  P("");
}

// ---- negatives ----
P("=== Positive takes under 0.25 s of voice on count b: their speech level ===");
P("(speech RMS over the speech portion at the file's level; quiet = 20 dB lower; the floor is pink noise at -60 dBFS)");
J.lowVoice = [];
for (const set of ["sel", "conf"]) {
  const lv = ROWS[set].filter((r) => r.cond === "clean").map((r) => r.speechRmsDb);
  P(`  ${set}: speech RMS of all takes (clean rows) min ${Math.min(...lv).toFixed(1)} / p5 ${quantile(lv, 0.05).toFixed(1)} / median ${quantile(lv, 0.5).toFixed(1)} / max ${Math.max(...lv).toFixed(1)} dBFS`);
  for (const r of ROWS[set].filter((x) => x.b < CANDIDATES[0] - EPS)) {
    const lvl = r.speechRmsDb - (r.cond === "quiet" ? 20 : 0);
    J.lowVoice.push({ set, takeId: r.takeId, cond: r.cond, sex: r.sex, levelDb: +lvl.toFixed(1), a: r.a, b: r.b, gate: r.gate });
    P(`    ${r.takeId} ${r.cond} (${r.sex}): speech ${lvl.toFixed(1)} dBFS, a ${r.a} s, b ${r.b} s, frames voice ${r.gate.voice} / hidden ${r.gate.hidden}`);
  }
}
P("");

P("=== Negative takes (no speech): share flagged (b < T) per class ===");
J.negatives = {};
const negRows = (cls) => ROWS.neg.filter((r) => r.cls === cls);
P(`  class | n  | ${CANDIDATES.map((T) => `T=${T}`.padEnd(13)).join(" ")} | median b (s)  max b`);
for (const cls of NEG_CLASSES) {
  const rows = negRows(cls);
  J.negatives[cls] = { n: rows.length, flagged: {} };
  const cells = CANDIDATES.map((T) => {
    const fb = share(rows, (r) => r.b < T - EPS), fa = share(rows, (r) => r.a < T - EPS);
    J.negatives[cls].flagged[T] = { b: fb, a: fa };
    return `${pct(fb)} (${pct(fa).trim()})`.padEnd(13);
  });
  P(`  ${cls.padEnd(5)} | ${String(rows.length).padEnd(2)} | ${cells.join(" ")} | ${quantile(rows.map((r) => r.b), 0.5).toFixed(3)}  ${Math.max(...rows.map((r) => r.b)).toFixed(3)}`);
}
P("  (flag share in %, count b; count a in brackets)");
for (const type of TYPES) {
  const T = J.selection[type].b.chosen;
  if (T == null) { P(`  ${type}: STOP — no voice check, nothing flagged`); continue; }
  const lim = NEG_CLASSES.filter((c) => !(J.negatives[c].flagged[T].b >= 0.5 - EPS));
  P(`  at the chosen ${type} T = ${T} s: ${NEG_CLASSES.map((c) => `${c} ${pct(J.negatives[c].flagged[T].b).trim()} %`).join(", ")}; flagged under 50 % (known limitation): ${lim.length ? lim.join(", ") : "none"}`);
  J.negatives[`limitations_${type}`] = lim;
}
P("  by take length (count b; 2.0 s takes / 5.0 s takes, 15 each):");
for (const cls of NEG_CLASSES) {
  const r2 = negRows(cls).filter((r) => r.takeS < 3), r5 = negRows(cls).filter((r) => r.takeS >= 3);
  P(`    ${cls}: ${CANDIDATES.map((T) => `T=${T} ${pct(share(r2, (r) => r.b < T - EPS)).trim()} / ${pct(share(r5, (r) => r.b < T - EPS)).trim()} %`).join("   ")}   b range 2 s ${Math.min(...r2.map((r) => r.b)).toFixed(3)}-${Math.max(...r2.map((r) => r.b)).toFixed(3)}, 5 s ${Math.min(...r5.map((r) => r.b)).toFixed(3)}-${Math.max(...r5.map((r) => r.b)).toFixed(3)}`);
}
P("");

// ---- too short ----
P("=== \"Too short\" (fixed by design): positive takes that would trip it ===");
J.tooShort = {};
for (const type of TYPES) for (const set of ["sel", "conf"]) {
  const rows = ROWS[set].filter((r) => r.type === type);
  const n = rows.filter((r) => r.takeS < TOO_SHORT[type] - EPS).length;
  J.tooShort[`${type}-${set}`] = { n: rows.length, short: n, minTakeS: Math.min(...rows.map((r) => r.takeS)) };
  P(`  ${type} (< ${TOO_SHORT[type]} s) ${set}: ${n} of ${rows.length} (${pct(n / rows.length).trim()} %); shortest take ${Math.min(...rows.map((r) => r.takeS)).toFixed(3)} s`);
}
P("");

// ---- R4 try pitch ----
P(`=== R4's try pitch: shown when count b >= ${TRY_PITCH_MIN_S} s (double takes) ===`);
J.tryPitch = { reach: {}, semitones: {} };
for (const set of ["sel", "conf"]) {
  P(`  ${set}: share reaching it per cell (count b; count a in brackets)`);
  for (const sex of SEXES) {
    P(`    ${sex}: ${CONDS.map((c) => {
      const rows = cellRows(set, "double", sex, c);
      const sb = passShare(rows, "b", TRY_PITCH_MIN_S), sa = passShare(rows, "a", TRY_PITCH_MIN_S);
      J.tryPitch.reach[`${set}-${sex}-${c}`] = { n: rows.length, b: sb, a: sa };
      return `${c} ${pct(sb).trim()} % (${pct(sa).trim()} %) n=${rows.length}`;
    }).join("   ")}`);
  }
}
P("  Semitones between the take's median voiced f0 and the same take's clean median, |12 log2(cond / clean)|:");
P("  primary: pairs where the pitch is shown in both (b >= 1.0 s), median f0 of the b frames; beside it: every pair with both medians (b frames), and the a-frame medians");
const st = (x, y) => Math.abs(12 * Math.log2(x / y));
for (const set of ["sel", "conf"]) {
  const byTake = new Map();
  for (const r of ROWS[set].filter((x) => x.type === "double")) {
    if (!byTake.has(r.takeId)) byTake.set(r.takeId, {});
    byTake.get(r.takeId)[r.cond] = r;
  }
  for (const cond of ["quiet", "noisy"]) for (const sex of ["all", ...SEXES]) {
    const shown = [], any = [], anyA = [];
    for (const g of byTake.values()) {
      const c0 = g.clean, c1 = g[cond];
      if (!c0 || !c1 || (sex !== "all" && c0.sex !== sex)) continue;
      if (c0.medB && c1.medB) any.push(st(c1.medB, c0.medB));
      if (c0.medA && c1.medA) anyA.push(st(c1.medA, c0.medA));
      if (c0.b >= TRY_PITCH_MIN_S - EPS && c1.b >= TRY_PITCH_MIN_S - EPS) shown.push(st(c1.medB, c0.medB));
    }
    const rec = {
      shown: { n: shown.length, median: quantile(shown, 0.5), p90: quantile(shown, 0.9), max: shown.length ? Math.max(...shown) : NaN },
      anyB: { n: any.length, median: quantile(any, 0.5), p90: quantile(any, 0.9) },
      anyA: { n: anyA.length, median: quantile(anyA, 0.5), p90: quantile(anyA, 0.9) },
    };
    J.tryPitch.semitones[`${set}-${cond}-${sex}`] = rec;
    const f = (x) => (Number.isFinite(x) ? x.toFixed(2) : "-");
    P(`    ${set} ${cond.padEnd(5)} ${sex.padEnd(3)}: shown n=${String(rec.shown.n).padStart(3)} median ${f(rec.shown.median)} st, p90 ${f(rec.shown.p90)} st, max ${f(rec.shown.max)}   | any n=${rec.anyB.n} median ${f(rec.anyB.median)} p90 ${f(rec.anyB.p90)}   | a-frames n=${rec.anyA.n} median ${f(rec.anyA.median)} p90 ${f(rec.anyA.p90)}`);
  }
}
P("");

// ---- the recorder's 8 s cap (reported, not part of §1) ----
P("=== Sensitivity, not in §1: the take recorder stops at 8 s (src/exercises/takes.js TAKE_MAX_S) ===");
for (const set of ["sel", "conf"]) {
  const long = ROWS[set].filter((r) => r.type === "double" && r.takeS > 8.0 + EPS);
  const T = J.selection.double.b.chosen ?? CANDIDATES[0];
  const all = ROWS[set].filter((r) => r.type === "double");
  P(`  ${set}: ${long.length / 3} of ${all.length / 3} double takes are longer than 8.0 s (lead + speech + tail); counting only frames up to 8.0 s after Record: pass share at T = ${T} s ${pct(share(all, (r) => r.b8 >= T - EPS)).trim()} % (all ${pct(share(all, (r) => r.b >= T - EPS)).trim()} %), pitch shown ${pct(share(all, (r) => r.b8 >= TRY_PITCH_MIN_S - EPS)).trim()} % (${pct(share(all, (r) => r.b >= TRY_PITCH_MIN_S - EPS)).trim()} %); min b over the long takes ${long.length ? Math.min(...long.map((r) => r.b8)).toFixed(3) : "-"} s (full ${long.length ? Math.min(...long.map((r) => r.b)).toFixed(3) : "-"} s)`);
}
P("");
P(`RESULT: single T = ${J.selection.single.b.stop ? "STOP" : J.selection.single.b.chosen + " s"}, double T = ${J.selection.double.b.stop ? "STOP" : J.selection.double.b.chosen + " s"}`);

writeFileSync(resolve(OUT, "summary.txt"), lines.join("\n") + "\n");
writeFileSync(resolve(OUT, "summary.json"), JSON.stringify(J, null, 1));
console.log(lines.join("\n"));
