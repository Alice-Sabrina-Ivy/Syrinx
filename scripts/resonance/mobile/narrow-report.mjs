// narrow-report.mjs — targets, guards and the selection rule of the narrower
// resonance-row hold round (measurements/resonance-row-hold-narrow-2026-11-01.md
// §7–§10), from pause-report.mjs stripReplay: the SHIPPED cue-strip model over
// the REAL hook's flags (pause-row.mjs) and the resonance posts (chain.mjs /
// hold-noise-run.mjs / as-run.mjs). Arms: BASE = stripReplay "act" (no hold),
// C1 = "cand" (createResonanceHold, reference only), K1–K5 = named arms
// (cueStripModel RESONANCE_HOLD_CANDIDATES, wired as §3.1).
//
//   node scripts/resonance/mobile/narrow-report.mjs [--set=dev|fresh] [--arms=BASE,C1,K1,K2,K3,K4,K5]
//        [--json=build/resonance-mobile/narrow/report-<set>.json] [--md=build/resonance-mobile/narrow/report-<set>.md]
//        [--timing-arms=<arm,...>] [--speech-runs=…] [--speech-hook=…] [--cold-runs=…] [--cold-hook=…]
//        [--as-runs=…] [--as-hook=…] [--list=…]
//   node scripts/resonance/mobile/narrow-report.mjs --write-freeze   (once, for the freeze commit)
//
// Frozen code (§4.4): any run that replays a K arm first checks the sha256 of
// each factory's toString() (and of the helpers and model functions they use),
// of pause-report.mjs and of this file against scripts/resonance/mobile/
// narrow-freeze.json (LF-normalised). A mismatch stops the run. --write-freeze
// writes that record (refusing to overwrite it).
//
// Speech (§7): per condition, pooled over the readers, window 20–150 s: mean
// trail = Σ points / Σ ticks; 1–5 s pauses with the thumb gone (pause-report
// pausesFromClean / pauseMetrics at 7e00e59, window start .. end + 250 ms);
// plus row idle %, trail clears / min, ticks with a drawable streak (448×890,
// 360×690), 0.3–1 s pauses, per sex, streak span. T-QUIET (§8): none, brown
// −55, pink −55, AC −55 each trail >= 10 and gone <= 5 %; T-NOISY = the
// number of the 9 noisier conditions meeting both.
// Noise (§7, §9): per level (L1 −48, L2 −40), mode (cold start: the whole
// 60 s; after speech: render points (k + 1)·25 ms >= (tLast + 6.0) s to the
// end) and screen class (narrow-screen.json): drawn / not idle / "keep
// talking…" (warming) %, pooled render-point weighted; per clip excess = the
// arm's drawn % − the same clip's BASE drawn %, in the clip's own window,
// unrounded. Bars (§9): speech-free drawn <= BASE + 1.0, not idle <= BASE +
// 2.0; talker drawn <= BASE + max(1.0, 0.25 × BASE), not idle <= BASE +
// max(2.0, 0.25 × BASE); per clip excess <= 15.00; warming <= BASE + 0.5 in
// each class. G-FT (dev): the talker bars on the 12 talker clips, at L1 / L2,
// cold start and after speech. G2 the thumb's u where both draw, G3 the pitch
// row at every tick and render point, G4 (speech) the resonance state / thumb
// only where BASE is idle — every render point and tick of every stream.
// Selection (§10): eligible = T-QUIET + every guard + G-FT (G5 is run
// separately); highest T-NOISY, then the smallest pooled after-speech drawn
// excess (the mean over L1 / L2 of arm − BASE pooled drawn %, all real-noise
// clips of both classes; equal when |a − b| < 0.005), then the fewest
// parameters.
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripReplay, windowMetrics, pausesFromClean, pauseMetrics, pauseFloor, STATES } from "./pause-report.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const R_ = (p) => path.resolve(repo, p);
const CS = await import(pathToFileURL(path.join(repo, "src/components/cueStripModel.js")).href);
const SELF = fileURLToPath(import.meta.url);
const FREEZE = path.join(repo, "scripts/resonance/mobile/narrow-freeze.json");

export const ARMS_ALL = ["BASE", "C1", "K1", "K2", "K3", "K4", "K5"];
const KEY = { BASE: "act", C1: "cand", K1: "K1", K2: "K2", K3: "K3", K4: "K4", K5: "K5" };
export const PARAMS = Object.freeze({ K1: 4, K2: 8, K3: 11, K4: 14, K5: 6 });
export const QUIET_CONDS = ["clean", "brown_m55", "pink_m55", "ac_m55"];
export const NOISY_CONDS = ["brown_m50", "pink_m50", "ac_m50", "brown_m48", "pink_m48", "ac_m48", "brown_m40", "pink_m40", "ac_m40"];
const SPEECH_CONDS = [...QUIET_CONDS, ...NOISY_CONDS];
export const LEVELS = [-48, -40];
const AFTER_S = 6.0, AFTER_INFO_S = 7.0, FROM_S = 20;
const LN = (L) => (L === -48 ? "L1 −48" : L === -40 ? "L2 −40" : `L ${L}`);
const IDLE = STATES.indexOf("idle"), START = STATES.indexOf("starting"), WARM = STATES.indexOf("warming"), SUST = STATES.indexOf("sustained");
// data-quality marks (§5.3; information only): the dev word rule's stem-and-ending matching
const QUALITY_STEMS = ["synth", "synthesizer", "synthesiser", "synthesized", "synthetic", "glitch", "remix", "game", "designed"];
const SUFFIXES = ["", "s", "es", "ed", "ing", "ings", "er", "ers", "ian", "ians", "al", "ally", "ter", "ren", "y", "ie", "ies"];
export const qualityHits = (text) => (String(text ?? "").toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => QUALITY_STEMS.some((s) => SUFFIXES.some((e) => w === s + e)));

// ---- frozen code
const lf = (s) => s.replace(/\r\n/g, "\n");
const sha = (s) => createHash("sha256").update(lf(s), "utf8").digest("hex");
export function freezeHashes() {
  const fn = {};
  for (const [k, f] of Object.entries(CS.RESONANCE_HOLD_CANDIDATES)) fn[`${k} ${f.name}`] = sha(f.toString());
  for (const name of ["holdQuantile", "holdMedian", "cueRowStates", "resonanceRowState", "createTrail", "createResonanceHold", "dotOpacity", "rowValue", "axisPos", "resonanceClamp"]) fn[name] = sha(CS[name].toString());
  return {
    node: process.version,
    functions: fn,
    files: {
      "scripts/resonance/mobile/pause-report.mjs": sha(readFileSync(path.join(repo, "scripts/resonance/mobile/pause-report.mjs"), "utf8")),
      "scripts/resonance/mobile/narrow-report.mjs": sha(readFileSync(SELF, "utf8")),
    },
  };
}
function checkFreeze() {
  if (!existsSync(FREEZE)) throw new Error(`no freeze record (${FREEZE}): a K arm is replayed only after the freeze commit`);
  const want = JSON.parse(readFileSync(FREEZE, "utf8")), got = freezeHashes();
  const bad = [];
  for (const sec of ["functions", "files"]) for (const [k, v] of Object.entries(want[sec])) if (got[sec][k] !== v) bad.push(`${sec}.${k}`);
  for (const k of Object.keys(got.functions)) if (!(k in want.functions)) bad.push(`functions.${k} (new)`);
  if (bad.length) throw new Error(`frozen code changed: ${bad.join(", ")} — stop (any change after the freeze is a reported deviation)`);
  return { ok: true, node: process.version, frozenNode: want.node, items: Object.keys(want.functions).length + Object.keys(want.files).length };
}

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
const sum = (a) => a.reduce((x, y) => x + y, 0);
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const f1 = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
const sg = (v, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}`);

/** First render point of the after-speech window: (k + 1)·25 ms >= (tLast + s)·1000. */
export const afterFrom = (tLast, s = AFTER_S) => Math.max(0, Math.ceil(((tLast + s) * 1000 - 1e-6) / 25) - 1);

// G2–G4 counts of one arm against BASE over a whole stream
function gCounts(R, key) {
  const a = R.arms.act, c = R.arms[key];
  const g = { pts: 0, uBoth: 0, uDiff: 0, pitchDiff: 0, resDiff: 0, resDiffNotIdle: 0, thumbDiff: 0, thumbDiffNotIdle: 0, ticks: 0, tickPitchDiff: 0, tickResDiff: 0, tickResDiffNotIdle: 0 };
  for (let k = 0; k < R.n; k++) {
    g.pts++;
    if (a.thumb[k] && c.thumb[k]) { g.uBoth++; if (a.thumbU[k] !== c.thumbU[k]) g.uDiff++; }
    if (a.ps[k] !== c.ps[k]) g.pitchDiff++;
    if (a.rs[k] !== c.rs[k]) { g.resDiff++; if (a.rs[k] !== IDLE) g.resDiffNotIdle++; }
    if (a.thumb[k] !== c.thumb[k]) { g.thumbDiff++; if (a.rs[k] !== IDLE) g.thumbDiffNotIdle++; }
  }
  for (let i = 0; i < a.ticks.length; i++) {
    const x = a.ticks[i], y = c.ticks[i];
    g.ticks++;
    if (x.pstate !== y.pstate) g.tickPitchDiff++;
    if (x.rstate !== y.rstate) { g.tickResDiff++; if (x.rstate !== "idle") g.tickResDiffNotIdle++; }
  }
  return g;
}
const addG = (acc, g) => { for (const [k, v] of Object.entries(g)) acc[k] = (acc[k] ?? 0) + v; return acc; };

// render-point shares of one arm over [kA, kB)
function shares(R, key, kA, kB) {
  const A = R.arms[key], B = R.arms.act;
  const o = { pts: 0, thumb: 0, notIdle: 0, warming: 0, held: 0, heldSustained: 0 };
  for (let k = kA; k < kB; k++) {
    o.pts++;
    if (A.thumb[k]) o.thumb++;
    if (A.rs[k] !== IDLE && A.rs[k] !== START) o.notIdle++;
    if (A.rs[k] === WARM) o.warming++;
    if (B.rs[k] === IDLE && A.flag[k]) { o.held++; if (A.rs[k] === SUST) o.heldSustained++; }
  }
  return o;
}
const pct = (n, d) => (d ? (100 * n) / d : null);

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === SELF.toLowerCase()) {
  if (process.argv.includes("--write-freeze")) {
    if (existsSync(FREEZE)) throw new Error(`${FREEZE} exists; the freeze is written once`);
    const h = freezeHashes();
    writeFileSync(FREEZE, JSON.stringify({ note: "Frozen code of the narrower resonance-row hold round (measurements/resonance-row-hold-narrow-2026-11-01.md §4.4, §10 step 2): sha256 of each LF-normalised toString() / file. narrow-report.mjs checks it before any K replay.", ...h }, null, 1) + "\n");
    console.log(JSON.stringify(h, null, 1));
    process.exit(0);
  }
  const SET = arg("set", "dev");
  const DEF = {
    dev: { speechRuns: "build/resonance-mobile/pause/runs", speechHook: "build/resonance-mobile/narrow/hook-speech", coldRuns: "build/resonance-mobile/hold/runs",
      coldHook: "build/resonance-mobile/narrow/hook-cold", asRuns: "build/resonance-mobile/narrow/runs-dev", asHook: "build/resonance-mobile/narrow/hook-dev",
      list: "scripts/resonance/mobile/hold-noise-list.json", ft: true },
    fresh: { speechRuns: "build/resonance-mobile/narrow/conf/runs", speechHook: "build/resonance-mobile/narrow/conf/hook-speech", coldRuns: "build/resonance-mobile/narrow/conf/cold-runs",
      coldHook: "build/resonance-mobile/narrow/conf/hook-cold", asRuns: "build/resonance-mobile/narrow/runs-fresh", asHook: "build/resonance-mobile/narrow/hook-fresh",
      list: "scripts/resonance/mobile/narrow-noise-list.json", ft: false },
  }[SET];
  if (!DEF) throw new Error(`--set=${SET}`);
  const P = Object.fromEntries(Object.entries(DEF).map(([k, v]) => [k, typeof v === "string" ? R_(arg(k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v)) : v]));
  const arms = arg("arms", ARMS_ALL.join(",")).split(",").filter(Boolean);
  for (const a of arms) if (!ARMS_ALL.includes(a)) throw new Error(`arm ${a}`);
  if (arms[0] !== "BASE") throw new Error("--arms must start with BASE");
  const kArms = arms.filter((a) => a.startsWith("K"));
  const freeze = kArms.length ? checkFreeze() : { ok: null, note: "no K arm replayed: not checked" };
  const cands = Object.fromEntries(kArms.map((k) => [k, CS.RESONANCE_HOLD_CANDIDATES[k]]));
  const others = arms.filter((a) => a !== "BASE");
  const screen = JSON.parse(readFileSync(path.join(repo, "scripts/resonance/mobile/narrow-screen.json"), "utf8")).sets[SET];
  if (!screen) throw new Error(`narrow-screen.json: no set ${SET}`);
  const SCR = new Map(screen.clips.map((c) => [c.id, c]));
  const LIST = new Map(JSON.parse(readFileSync(P.list, "utf8")).clips.map((c) => [c.id, c]));
  const qmark = (id) => { const c = LIST.get(id); if (!c) return []; if (Array.isArray(c.qualityMark)) return c.qualityMark; return qualityHits([c.title, ...(c.tags ?? [])].join(" ")); };
  const pairing = JSON.parse(readFileSync(path.join(repo, "scripts/resonance/mobile/narrow-pairing.json"), "utf8")).sets[SET];
  const checks = { freeze, hookHints: 0, hookHintMismatch: 0, levelSame: 0, streams: 0, worker: { checked: 0, mismatch: 0, streams: 0 }, tLastPairing: 0, tLastPairingMismatch: 0, levelChecks: { speechMaxDev: 0, noiseMaxDev: 0 } };
  const noteHook = (h) => { checks.streams++; checks.hookHints += h.hint.want; checks.hookHintMismatch += h.hint.mismatch; if (h.levelCheck.same) checks.levelSame++; };
  const gAll = Object.fromEntries(others.map((a) => [a, { speech: {}, cold: {}, after: {}, ft: {} }]));

  // ---- speech
  const sHooks = loadJsonl(P.speechHook, /^hook-.*\.jsonl$/).filter((h) => SPEECH_CONDS.includes(h.cond));
  const sChain = chainIndex(P.speechRuns, SPEECH_CONDS);
  const cleanBy = new Map();
  const cleanOf = (id) => { if (!cleanBy.has(id)) { const f = path.join(P.speechRuns, "clean", "pitch", `${id}.json`); cleanBy.set(id, existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).byChunk : null); } return cleanBy.get(id); };
  const speech = [];
  for (const h of sHooks) {
    const cr = sChain.get(`${h.cond}|${h.id}`);
    if (!cr) throw new Error(`no chain record ${h.cond} ${h.id}`);
    noteHook(h);
    const R = stripReplay(h, cr, { from: FROM_S, cands });
    const kFrom = R.kFrom, kTo = R.n;
    const pauses = pausesFromClean(cleanOf(h.id));
    const row = { cond: h.cond, id: h.id, sex: h.sex, floor: pauseFloor(h, cleanOf(h.id), pauses, { kFrom }).medDb, a: {} };
    const t0 = (kFrom + 1) * 0.025, t1 = kTo * 0.025;
    for (const arm of arms) {
      const key = KEY[arm];
      const w = windowMetrics(R, key, { kFrom, kTo });
      const tk = R.arms[key].ticks.filter((x) => x.t >= t0 && x.t <= t1);
      const sh = shares(R, key, kFrom, kTo);
      row.a[arm] = { w, pauses: pauseMetrics(R, key, pauses, { kFrom }), trailSum: sum(tk.map((x) => x.trailLen)), ticks: tk.length,
        agesFull: tk.filter((x) => x.trailLen === 15).map((x) => x.ageS), ages2: tk.filter((x) => x.trailLen >= 2).map((x) => x.ageS), held: sh.held, heldSustained: sh.heldSustained };
    }
    for (const arm of others) addG(gAll[arm].speech, gCounts(R, KEY[arm]));
    speech.push(row);
  }
  const speechAgg = (rr, arm) => {
    const n = (cl) => sum(rr.map((x) => x.a[arm].pauses[cl].n)), g = (cl) => sum(rr.map((x) => x.a[arm].pauses[cl].gone));
    const tw = rr.map((x) => x.a[arm].w.sec), tkn = rr.map((x) => x.a[arm].w.ticks);
    const wm = (k) => sum(rr.map((x, i) => x.a[arm].w[k] * tw[i])) / sum(tw);
    const tm = (k) => sum(rr.map((x, i) => (x.a[arm].w[k] * tkn[i]) / 100)) / sum(tkn) * 100;
    const full = rr.flatMap((x) => x.a[arm].agesFull), two = rr.flatMap((x) => x.a[arm].ages2), nt = sum(rr.map((x) => x.a[arm].ticks));
    return {
      readers: rr.length, trail: sum(rr.map((x) => x.a[arm].trailSum)) / nt,
      mid: { n: n("mid"), gone: g("mid"), pct: pct(g("mid"), n("mid")) }, short: { n: n("short"), gone: g("short"), pct: pct(g("short"), n("short")) },
      idlePct: wm("idlePct"), clearsPerMin: wm("clearsPerMin"), streak448: tm("streakPct448"), streak360: tm("streakPct360"),
      fullPct: pct(full.length, nt), ageFull: [q(full, 0.5), q(full, 0.1), q(full, 0.9)], age2: [q(two, 0.5), q(two, 0.1), q(two, 0.9)],
      heldSustainedPct: pct(sum(rr.map((x) => x.a[arm].heldSustained)), sum(rr.map((x) => x.a[arm].held))),
    };
  };
  const SP = {};
  for (const c of SPEECH_CONDS) {
    SP[c] = {};
    for (const arm of arms) {
      const rr = speech.filter((x) => x.cond === c);
      SP[c][arm] = { all: speechAgg(rr, arm), m: speechAgg(rr.filter((x) => x.sex === "m"), arm), f: speechAgg(rr.filter((x) => x.sex === "f"), arm),
        floor: q(rr.map((x) => x.floor), 0.5) };
    }
  }
  const meets = (s) => s.trail >= 10 && s.mid.pct <= 5;
  const TT = Object.fromEntries(arms.map((arm) => [arm, { quiet: QUIET_CONDS.every((c) => meets(SP[c][arm].all)), noisy: NOISY_CONDS.filter((c) => meets(SP[c][arm].all)).length,
    quietDetail: Object.fromEntries(QUIET_CONDS.map((c) => [c, meets(SP[c][arm].all)])) }]));

  // ---- noise: cold start (RN_m*), after speech (AS_m*), G-FT (FT_m*, FTAS_m*)
  const noise = [];
  const noiseSet = (mode, runsDir, hookDir, conds, isFt) => {
    const hooks = loadJsonl(hookDir, /^hook-.*\.jsonl$/).filter((h) => conds.includes(h.cond));
    const chain = chainIndex(runsDir, conds);
    for (const h of hooks) {
      const cr = chain.get(`${h.cond}|${h.id}`);
      if (!cr) throw new Error(`no chain record ${h.cond} ${h.id}`);
      noteHook(h);
      if (cr.worker) { checks.worker.streams++; checks.worker.checked += cr.worker.checked; checks.worker.mismatch += cr.worker.mismatch; }
      if (cr.levelCheck) {
        if (cr.levelCheck.speechActiveDb != null) checks.levelChecks.speechMaxDev = Math.max(checks.levelChecks.speechMaxDev, Math.abs(cr.levelCheck.speechActiveDb + 32));
        checks.levelChecks.noiseMaxDev = Math.max(checks.levelChecks.noiseMaxDev, Math.abs(cr.levelCheck.noiseDspMedDb - cr.noiseDb));
      }
      const level = -Number(h.cond.split("_m")[1]);
      const R = stripReplay(h, cr, { from: 0, cands });
      let kA = 0, kInfo = null, tLast = null, tCut = null, posAtCut = null;
      if (mode === "after") {
        tLast = cr.tLast; tCut = cr.tCut;
        const pr = (isFt ? pairing.ft : pairing.as).find((x) => x.clip === h.id);
        checks.tLastPairing++;
        if (!pr || pr.tLast !== tLast || pr.reader !== cr.reader || pr.tCut !== tCut) checks.tLastPairingMismatch++;
        kA = afterFrom(tLast); kInfo = afterFrom(tLast, AFTER_INFO_S);
        const kc = Math.floor((tCut * 1000) / 25);
        const sp = R.snapAt[kc] != null ? R.snaps[R.snapAt[kc]] : null;
        posAtCut = { u: sp?.u != null, fill1: sp?.u != null && sp?.fill === 1 };
      }
      const scr = isFt ? { class: "talker", family: "talker" } : SCR.get(h.id);
      if (!scr) throw new Error(`${h.id}: not in the screen`);
      const meta = isFt ? { source: "ft", cls: "foreground talker" } : LIST.get(h.id);
      const row = { mode, ft: isFt, level, id: h.id, reader: cr.reader, cls: scr.class, family: scr.family, source: meta?.source, sub: meta?.cls, quality: isFt ? [] : qmark(h.id),
        tLast, tCut, posAtCut, a: {} };
      for (const arm of arms) {
        const key = KEY[arm];
        row.a[arm] = shares(R, key, kA, R.n);
        if (kInfo != null) row.a[arm].info7 = shares(R, key, kInfo, R.n);
      }
      const gk = isFt ? "ft" : mode;
      for (const arm of others) addG(gAll[arm][gk], gCounts(R, KEY[arm]));
      noise.push(row);
    }
  };
  noiseSet("cold", P.coldRuns, P.coldHook, LEVELS.map((L) => `RN_m${-L}`), false);
  noiseSet("after", P.asRuns, P.asHook, LEVELS.map((L) => `AS_m${-L}`), false);
  if (P.ft) { noiseSet("cold", P.asRuns, P.asHook, LEVELS.map((L) => `FT_m${-L}`), true); noiseSet("after", P.asRuns, P.asHook, LEVELS.map((L) => `FTAS_m${-L}`), true); }

  // pooled shares and the bars
  const pool = (rows, arm, k, sub = null) => { const v = rows.map((x) => (sub ? x.a[arm][sub] : x.a[arm])); const d = sum(v.map((s) => s.pts)); return d ? (100 * sum(v.map((s) => s[k]))) / d : null; };
  const clipExcess = (x, arm, sub = null) => { const a = sub ? x.a[arm][sub] : x.a[arm], b = sub ? x.a.BASE[sub] : x.a.BASE; return (100 * a.thumb) / a.pts - (100 * b.thumb) / b.pts; };
  function cell(rows, arm, cls, sub = null) {
    const bd = pool(rows, "BASE", "thumb", sub), bn = pool(rows, "BASE", "notIdle", sub), bw = pool(rows, "BASE", "warming", sub);
    const ad = pool(rows, arm, "thumb", sub), an = pool(rows, arm, "notIdle", sub), aw = pool(rows, arm, "warming", sub);
    const ex = rows.map((x) => ({ id: x.id, d: clipExcess(x, arm, sub) }));
    const worst = ex.reduce((m, e) => (m == null || e.d > m.d ? e : m), null);
    const barD = cls === "talker" ? Math.max(1.0, 0.25 * bd) : 1.0, barN = cls === "talker" ? Math.max(2.0, 0.25 * bn) : 2.0;
    const r = { n: rows.length, baseDrawn: bd, drawn: ad, dDrawn: ad - bd, barDrawn: barD, baseNotIdle: bn, notIdle: an, dNotIdle: an - bn, barNotIdle: barN,
      baseWarming: bw, warming: aw, dWarming: aw - bw, maxClip: worst?.d ?? null, worstClip: worst?.id ?? null, clipsOver15: ex.filter((e) => e.d > 15).length };
    r.passDrawn = rows.length === 0 || r.dDrawn <= barD; r.passNotIdle = rows.length === 0 || r.dNotIdle <= barN; r.passClip = rows.length === 0 || r.maxClip <= 15.0; r.passWarming = rows.length === 0 || r.dWarming <= 0.5;
    r.pass = r.passDrawn && r.passNotIdle && r.passClip && r.passWarming;
    return r;
  }
  const real = noise.filter((x) => !x.ft), ft = noise.filter((x) => x.ft);
  const CELLS = [];
  for (const L of LEVELS) for (const mode of ["cold", "after"]) for (const cls of ["speech-free", "talker"]) CELLS.push({ L, mode, cls });
  const guards = {}, gft = {}, info = {};
  for (const arm of others) {
    guards[arm] = CELLS.map((c) => ({ ...c, ...cell(real.filter((x) => x.level === c.L && x.mode === c.mode && x.cls === c.cls), arm, c.cls) }));
    gft[arm] = LEVELS.flatMap((L) => ["cold", "after"].map((mode) => {
      const r = cell(ft.filter((x) => x.level === L && x.mode === mode), arm, "talker");
      return { L, mode, ...r, pass: r.passDrawn && r.passNotIdle && r.passClip }; // the talker bars (§9 G-FT); warming reported
    }));
    // information (no bar)
    info[arm] = {
      posAtCut: CELLS.filter((c) => c.mode === "after").map((c) => ({ ...c, ...cell(real.filter((x) => x.level === c.L && x.mode === "after" && x.cls === c.cls && x.posAtCut?.u), arm, c.cls) })),
      after7: CELLS.filter((c) => c.mode === "after").map((c) => ({ ...c, ...cell(real.filter((x) => x.level === c.L && x.mode === "after" && x.cls === c.cls), arm, c.cls, "info7") })),
      noQuality: CELLS.map((c) => ({ ...c, ...cell(real.filter((x) => x.level === c.L && x.mode === c.mode && x.cls === c.cls && !x.quality.length), arm, c.cls) })),
      bySource: LEVELS.flatMap((L) => ["cold", "after"].flatMap((mode) => [...new Set(real.map((x) => x.source))].sort().map((src) => ({ L, mode, src, ...cell(real.filter((x) => x.level === L && x.mode === mode && x.source === src), arm, "speech-free") })))),
      bySub: LEVELS.flatMap((L) => ["cold", "after"].flatMap((mode) => [...new Set(real.map((x) => x.sub))].sort().map((sub) => ({ L, mode, sub, ...cell(real.filter((x) => x.level === L && x.mode === mode && x.sub === sub), arm, "speech-free") })))),
      pooled: LEVELS.flatMap((L) => ["cold", "after"].map((mode) => ({ L, mode, ...cell(real.filter((x) => x.level === L && x.mode === mode), arm, "speech-free") }))),
      heldSustained: CELLS.map((c) => { const rr = real.filter((x) => x.level === c.L && x.mode === c.mode && x.cls === c.cls); return { ...c, held: sum(rr.map((x) => x.a[arm].held)), sustained: sum(rr.map((x) => x.a[arm].heldSustained)) }; }),
    };
  }
  // tie-break: the pooled after-speech drawn excess over all real-noise clips, mean over L1 / L2
  const tieBreak = Object.fromEntries(others.map((arm) => [arm, sum(LEVELS.map((L) => { const rr = real.filter((x) => x.level === L && x.mode === "after"); return pool(rr, arm, "thumb") - pool(rr, "BASE", "thumb"); })) / LEVELS.length]));
  const gPass = (arm) => { const g = gAll[arm]; const all = [g.speech, g.cold, g.after, g.ft];
    return { G2: all.every((x) => !x.uDiff), G3: all.every((x) => !x.pitchDiff && !x.tickPitchDiff), G4: !g.speech.resDiffNotIdle && !g.speech.tickResDiffNotIdle && !g.speech.thumbDiffNotIdle }; };
  const verdict = {};
  for (const arm of others) {
    const gp = gPass(arm);
    const v = { tQuiet: TT[arm].quiet, tNoisy: TT[arm].noisy, guards: guards[arm].every((c) => c.pass), gft: !P.ft || gft[arm].every((c) => c.pass), ...gp, tieBreak: tieBreak[arm], params: PARAMS[arm] ?? null };
    v.eligible = arm.startsWith("K") && v.tQuiet && v.guards && v.gft && v.G2 && v.G3 && v.G4;
    v.failed = [!v.tQuiet && "T-QUIET", ...guards[arm].filter((c) => !c.pass).map((c) => `${c.cls} ${LN(c.L)} ${c.mode}: ${[!c.passDrawn && "drawn", !c.passNotIdle && "not idle", !c.passClip && "single clip", !c.passWarming && "keep talking"].filter(Boolean).join(", ")}`),
      ...(P.ft ? gft[arm].filter((c) => !c.pass).map((c) => `G-FT ${LN(c.L)} ${c.mode}: ${[!c.passDrawn && "drawn", !c.passNotIdle && "not idle", !c.passClip && "single clip"].filter(Boolean).join(", ")}`) : []),
      !gp.G2 && "G2", !gp.G3 && "G3", !gp.G4 && "G4"].filter(Boolean);
    verdict[arm] = v;
  }
  const order = kArms.filter((a) => verdict[a].eligible).sort((a, b) => {
    const A = verdict[a], B = verdict[b];
    if (A.tNoisy !== B.tNoisy) return B.tNoisy - A.tNoisy;
    if (Math.abs(A.tieBreak - B.tieBreak) >= 0.005) return A.tieBreak - B.tieBreak;
    return A.params - B.params;
  });
  const selection = { eligible: order, pick: order[0] ?? null, stop: kArms.length > 0 && order.length === 0 };

  // ---- information: BASE and the pick with the timing options (dev speech)
  const timingArms = arg("timing-arms", "") ? arg("timing-arms", "").split(",") : selection.pick ? [selection.pick] : [];
  const timing = {};
  if (timingArms.length) {
    const tc = Object.fromEntries(timingArms.filter((a) => a.startsWith("K")).map((k) => [k, CS.RESONANCE_HOLD_CANDIDATES[k]]));
    for (const [name, opt] of [["tickJitter150", { tickJitterMs: 150 }], ["arrival40", { arrival40: true }]]) {
      const rows = [];
      for (const h of sHooks) {
        const cr = sChain.get(`${h.cond}|${h.id}`);
        const R = stripReplay(h, cr, { from: FROM_S, cands: tc, ...opt });
        const kFrom = R.kFrom, kTo = R.n, t0 = (kFrom + 1) * 0.025, t1 = kTo * 0.025;
        const pauses = pausesFromClean(cleanOf(h.id));
        const row = { cond: h.cond, a: {} };
        for (const arm of ["BASE", ...timingArms]) {
          const key = KEY[arm];
          const tk = R.arms[key].ticks.filter((x) => x.t >= t0 && x.t <= t1);
          row.a[arm] = { pauses: pauseMetrics(R, key, pauses, { kFrom }), trailSum: sum(tk.map((x) => x.trailLen)), ticks: tk.length };
        }
        rows.push(row);
      }
      timing[name] = {};
      for (const arm of ["BASE", ...timingArms]) {
        const per = Object.fromEntries(SPEECH_CONDS.map((c) => { const rr = rows.filter((x) => x.cond === c); const n = sum(rr.map((x) => x.a[arm].pauses.mid.n)); return [c, { trail: sum(rr.map((x) => x.a[arm].trailSum)) / sum(rr.map((x) => x.a[arm].ticks)), mid: pct(sum(rr.map((x) => x.a[arm].pauses.mid.gone)), n) }]; }));
        const m = (s) => s.trail >= 10 && s.mid <= 5;
        timing[name][arm] = { per, tQuiet: QUIET_CONDS.every((c) => m(per[c])), tNoisy: NOISY_CONDS.filter((c) => m(per[c])).length };
      }
    }
  }

  // ---- tables
  const Lm = [];
  const W = (s = "") => Lm.push(s);
  const NAME = (c) => (c === "clean" ? "none" : `${c.startsWith("ac") ? "AC" : c.split("_")[0]} −${c.split("_m")[1]}`);
  W(`Set ${SET}; arms ${arms.join(", ")}. Freeze check: ${freeze.ok === true ? `PASS (${freeze.items} items, Node ${freeze.node}; frozen on ${freeze.frozenNode})` : freeze.note}.`);
  W(`Checks: streams ${checks.streams}; rebuilt audio identical ${checks.levelSame}/${checks.streams}; hook hints = runner hints ${checks.hookHints - checks.hookHintMismatch}/${checks.hookHints}; real resonance worker = replica ${checks.worker.checked - checks.worker.mismatch}/${checks.worker.checked} posts (${checks.worker.streams} streams); tLast / reader / tCut = pairing table ${checks.tLastPairing - checks.tLastPairingMismatch}/${checks.tLastPairing}; level checks max |speech − (−32)| ${checks.levelChecks.speechMaxDev.toFixed(4)} dB, max |noise − L| ${checks.levelChecks.noiseMaxDev.toFixed(4)} dB.`);
  W("");
  W("### Speech: T-QUIET and T-NOISY (pooled over the readers, 20–150 s)");
  W("");
  W(`| condition | pause floor | ${arms.map((a) => `${a} trail`).join(" | ")} | ${arms.map((a) => `${a} 1–5 s gone %`).join(" | ")} |`);
  W(`|---|---|${arms.map(() => "---").join("|")}|${arms.map(() => "---").join("|")}|`);
  for (const c of SPEECH_CONDS) W(`| ${NAME(c)} | ${f1(SP[c].BASE.floor)} | ${arms.map((a) => f1(SP[c][a].all.trail)).join(" | ")} | ${arms.map((a) => f1(SP[c][a].all.mid.pct)).join(" | ")} |`);
  W("");
  W(`1–5 s pauses per condition (pooled): ${[...new Set(SPEECH_CONDS.map((c) => SP[c].BASE.all.mid.n))].join(" / ")}.`);
  W("");
  W("| arm | T-QUIET | none / brown −55 / pink −55 / AC −55 | T-NOISY (of 9) |");
  W("|---|---|---|---|");
  for (const a of arms) W(`| ${a} | ${TT[a].quiet ? "PASS" : "FAIL"} | ${QUIET_CONDS.map((c) => (TT[a].quietDetail[c] ? "yes" : "no")).join(" / ")} | ${TT[a].noisy} |`);
  W("");
  W("### Speech: other measures (pooled; row idle %, trail clears / min, ticks with a drawable streak 448×890 / 360×690 %, 0.3–1 s pauses gone %, trail men / women, 1–5 s gone men / women)");
  W("");
  for (const a of arms) {
    W(`**${a}**`);
    W("");
    W("| condition | row idle % | clears / min | streak 448 % | streak 360 % | 0.3–1 s gone % | trail m / f | 1–5 s gone m / f % | full-trail ticks % | span full: median [q10–q90] s | span ≥ 2 pts: median s | held points in 'needs running speech' % |");
    W("|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const c of SPEECH_CONDS) { const s = SP[c][a]; W(`| ${NAME(c)} | ${f1(s.all.idlePct)} | ${f1(s.all.clearsPerMin)} | ${f1(s.all.streak448)} | ${f1(s.all.streak360)} | ${f1(s.all.short.pct)} | ${f1(s.m.trail)} / ${f1(s.f.trail)} | ${f1(s.m.mid.pct)} / ${f1(s.f.mid.pct)} | ${f1(s.all.fullPct)} | ${f1(s.all.ageFull[0])} [${f1(s.all.ageFull[1])}–${f1(s.all.ageFull[2])}] | ${f1(s.all.age2[0])} | ${f1(s.all.heldSustainedPct)} |`); }
    W("");
  }
  W("### Noise guards (§9): eight cells per arm; Δ = arm − BASE, pooled render-point weighted");
  W("");
  W(`Clips per cell: ${CELLS.map((c) => `${c.cls} ${LN(c.L)} ${c.mode} ${real.filter((x) => x.level === c.L && x.mode === c.mode && x.cls === c.cls).length}`).join("; ")}.`);
  W("");
  W("| arm | cell | drawn BASE → arm (Δ; bar) | not idle BASE → arm (Δ; bar) | keep talking Δ | largest clip Δ (clip) | clips > 15 | pass |");
  W("|---|---|---|---|---|---|---|---|");
  for (const a of others) for (const c of guards[a]) W(`| ${a} | ${c.cls} ${LN(c.L)} ${c.mode} | ${f1(c.baseDrawn, 2)} → ${f1(c.drawn, 2)} (${sg(c.dDrawn)}; +${f1(c.barDrawn, 2)}) | ${f1(c.baseNotIdle, 2)} → ${f1(c.notIdle, 2)} (${sg(c.dNotIdle)}; +${f1(c.barNotIdle, 2)}) | ${sg(c.dWarming)} | ${sg(c.maxClip)} (${c.worstClip}) | ${c.clipsOver15} | ${c.pass ? "PASS" : "**FAIL**"} |`);
  W("");
  if (P.ft) {
    W("### G-FT (dev): the talker bars on the 12 foreground-talker clips");
    W("");
    W("| arm | cell | drawn BASE → arm (Δ; bar) | not idle BASE → arm (Δ; bar) | keep talking Δ (information) | largest clip Δ (clip) | pass |");
    W("|---|---|---|---|---|---|---|");
    for (const a of others) for (const c of gft[a]) W(`| ${a} | ${LN(c.L)} ${c.mode} | ${f1(c.baseDrawn, 2)} → ${f1(c.drawn, 2)} (${sg(c.dDrawn)}; +${f1(c.barDrawn, 2)}) | ${f1(c.baseNotIdle, 2)} → ${f1(c.notIdle, 2)} (${sg(c.dNotIdle)}; +${f1(c.barNotIdle, 2)}) | ${sg(c.dWarming)} | ${sg(c.maxClip)} (${c.worstClip}) | ${c.pass ? "PASS" : "**FAIL**"} |`);
    W("");
  }
  W("### G2–G4 (every render point and tick of every stream)");
  W("");
  W("| arm | set | render points | ticks | G2 u differs / both draw | G3 pitch row differs (points / ticks) | resonance differs where BASE not idle (points / ticks) | thumb differs where BASE not idle | resonance differs where BASE idle (points) |");
  W("|---|---|---|---|---|---|---|---|---|");
  for (const a of others) for (const s of ["speech", "cold", "after", "ft"]) { const g = gAll[a][s]; if (!g.pts) continue; W(`| ${a} | ${s} | ${g.pts} | ${g.ticks} | ${g.uDiff} / ${g.uBoth} | ${g.pitchDiff} / ${g.tickPitchDiff} | ${g.resDiffNotIdle} / ${g.tickResDiffNotIdle} | ${g.thumbDiffNotIdle} | ${g.resDiff - g.resDiffNotIdle} |`); }
  W("");
  W("### Selection (§10; G5 is run separately on the first eligible candidate)");
  W("");
  W("| arm | T-QUIET | T-NOISY | guards (8 cells) | G-FT | G2 | G3 | G4 | after-speech drawn excess (mean L1 / L2) | parameters | eligible | failed |");
  W("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const a of others) { const v = verdict[a]; W(`| ${a} | ${v.tQuiet ? "PASS" : "FAIL"} | ${v.tNoisy} | ${v.guards ? "PASS" : "FAIL"} | ${P.ft ? (v.gft ? "PASS" : "FAIL") : "—"} | ${v.G2 ? "PASS" : "FAIL"} | ${v.G3 ? "PASS" : "FAIL"} | ${v.G4 ? "PASS" : "FAIL"} | ${sg(v.tieBreak, 3)} | ${v.params ?? "—"} | ${a.startsWith("K") ? (v.eligible ? "yes" : "no") : "reference"} | ${v.failed.join("; ") || "—"} |`); }
  W("");
  W(`Order of the eligible candidates: ${order.length ? order.join(" > ") : "none"}. ${selection.stop ? "**No candidate is eligible: STOP before confirmation.**" : selection.pick ? `Pick (subject to G5): **${selection.pick}**.` : ""}`);
  W("");
  W("### Information (no bar)");
  W("");
  W("**Streams with a resonance position when the speech ended** (the post in force at the render point containing tCut: u ≠ null; and with fill = 1):");
  W("");
  for (const L of LEVELS) for (const cls of ["speech-free", "talker"]) { const rr = real.filter((x) => x.mode === "after" && x.level === L && x.cls === cls); W(`- ${LN(L)} ${cls}: ${rr.filter((x) => x.posAtCut.u).length} / ${rr.length} with u, ${rr.filter((x) => x.posAtCut.fill1).length} with fill 1.`); }
  if (P.ft) for (const L of LEVELS) { const rr = ft.filter((x) => x.mode === "after" && x.level === L); W(`- G-FT ${LN(L)}: ${rr.filter((x) => x.posAtCut.u).length} / ${rr.length} with u, ${rr.filter((x) => x.posAtCut.fill1).length} with fill 1.`); }
  W("");
  W(`**Readers** (tCut, tLast, fade-out): ${pairing.readers.map((r) => `${r.id} ${r.tCut.toFixed(3)} / ${r.tLast?.toFixed(3)}${r.fade ? " fade" : ""}`).join("; ")}.`);
  W("");
  const infoTable = (title, key, cols = "cell") => {
    W(`**${title}**`);
    W("");
    W("| arm | cell | clips | drawn BASE → arm (Δ) | not idle Δ | largest clip Δ (clip) | would pass |");
    W("|---|---|---|---|---|---|---|");
    for (const a of others) for (const c of info[a][key]) W(`| ${a} | ${cols === "cell" ? `${c.cls} ${LN(c.L)} ${c.mode}` : cols === "src" ? `${c.src} ${LN(c.L)} ${c.mode}` : cols === "sub" ? `${c.sub} ${LN(c.L)} ${c.mode}` : `${LN(c.L)} ${c.mode}`} | ${c.n} | ${f1(c.baseDrawn, 2)} → ${f1(c.drawn, 2)} (${sg(c.dDrawn)}) | ${sg(c.dNotIdle)} | ${sg(c.maxClip)} (${c.worstClip}) | ${cols === "cell" ? (c.pass ? "yes" : "no") : "—"} |`);
    W("");
  };
  infoTable("After speech, only the streams with u ≠ null at tCut", "posAtCut");
  infoTable("After speech, the window from tLast + 7 s", "after7");
  infoTable("Without the clips with a data-quality mark", "noQuality");
  infoTable("By source (both classes)", "bySource", "src");
  infoTable("Pooled over both classes", "pooled", "pool");
  infoTable("By metadata subclass (both classes)", "bySub", "sub");
  W(`Data-quality marks: ${real.filter((x) => x.quality.length && x.mode === "cold" && x.level === LEVELS[0]).map((x) => `${x.id} (${x.quality.join(", ")})`).join("; ") || "none"}.`);
  W("");
  W("**Held render points (BASE idle, the arm's flag on) in 'needs running speech'**:");
  W("");
  for (const a of others) W(`- ${a}: speech ${SPEECH_CONDS.map((c) => `${NAME(c)} ${f1(SP[c][a].all.heldSustainedPct)} %`).join(", ")}; noise ${info[a].heldSustained.map((c) => `${c.cls} ${LN(c.L)} ${c.mode} ${c.sustained} / ${c.held}`).join(", ")}.`);
  W("");
  W("**G4 on the noise streams**: see the G2–G4 table (cold / after / ft rows).");
  W("");
  if (Object.keys(timing).length) {
    W("**Timing options on dev speech (BASE and the pick)**: tickJitter150 = ticks at 350 + 250 j + δ, δ uniform [0, 150) ms; arrival40 = 40 ms capture buffers.");
    W("");
    W("| option | arm | T-QUIET | T-NOISY | trail none / brown −55 / pink −55 / AC −55 | 1–5 s gone % none / brown −55 / pink −55 / AC −55 |");
    W("|---|---|---|---|---|---|");
    for (const a of ["BASE", ...timingArms]) W(`| nominal | ${a} | ${TT[a].quiet ? "PASS" : "FAIL"} | ${TT[a].noisy} | ${QUIET_CONDS.map((c) => f1(SP[c][a].all.trail)).join(" / ")} | ${QUIET_CONDS.map((c) => f1(SP[c][a].all.mid.pct)).join(" / ")} |`);
    for (const [name, T] of Object.entries(timing)) for (const [a, t] of Object.entries(T)) W(`| ${name} | ${a} | ${t.tQuiet ? "PASS" : "FAIL"} | ${t.tNoisy} | ${QUIET_CONDS.map((c) => f1(t.per[c].trail)).join(" / ")} | ${QUIET_CONDS.map((c) => f1(t.per[c].mid)).join(" / ")} |`);
    W("");
  }
  const md = Lm.join("\n");
  console.log(md);
  const jsonOut = R_(arg("json", `build/resonance-mobile/narrow/report-${SET}.json`));
  mkdirSync(path.dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, JSON.stringify({ set: SET, arms, checks, speech: SP, tTargets: TT, guards, gft, g: gAll, tieBreak, verdict, selection, info, timing,
    noise: noise.map((x) => ({ ...x, a: Object.fromEntries(Object.entries(x.a).map(([k, s]) => [k, { pts: s.pts, thumb: s.thumb, notIdle: s.notIdle, warming: s.warming, held: s.held, heldSustained: s.heldSustained, ...(s.info7 ? { info7: { pts: s.info7.pts, thumb: s.info7.thumb } } : {}) }])) })) }, null, 1));
  writeFileSync(R_(arg("md", `build/resonance-mobile/narrow/report-${SET}.md`)), md);
}
