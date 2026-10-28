// summarize.mjs — per condition and per sex, what a perturbation does to the
// resonance cue (records of chain.mjs).
//
//   node scripts/resonance/mobile/summarize.mjs --runs=<cond dir>[,<cond dir>...]
//        [--base=<cond dir of the clean run>] [--gate=on|off|both] [--json=<out.json>] [--readers]
//
// Each condition is compared with the base condition's run of the SAME gate and
// the same stream ids (default base: <parent of the first runs dir>/clean).
// Times are seconds of audio; u = the shown value (1 u = LibriSpeech men's to
// women's median gap). Per sex:
//   medU N     median over readers of the reader's N-control median shown u
//              (posts with u != null and fill >= 1, i.e. after the 5 s readout fills)
//   bias       median over readers of (medU N in this condition - medU N in the base)
//   sens       median over readers of medU(U10) - medU(D10) (the +-12 % formant
//              steps, ~ +-1.0 u clean); ratio = median over readers of sens / base sens
//   T50 / T90  faster-eval.mjs's method on the 1.0 u switch events (N-U10-N, N-D10-N:
//              change at 18 s, back at 36 s): first drawn post within 18 s after the
//              change whose shown u is >= 50 / 90 % of the way from the OLD voice's
//              control to the NEW voice's control (both of this condition, same post
//              index); never = 18 s (censored, counted). Median over events.
//   tAbs0.5    the same events, first drawn post at least 0.5 u from the old control
//              in the change's direction (absolute movement; censored = 18 s)
//   first pos  N control: first post with u != null (the narrowband detector decided);
//   first drawn  first post the row draws a position (cueStripModel cueRowStates with
//              the gated flags voiced / holding as logged, dotOpacity != null, u != null)
//   adm/s      admitted vtln bins (value != null) per second of audio, N control
//   voiced %   pitch-voiced hops / all hops (all streams pooled)
//   hid %      pitch-voiced hops the voice gate decided "no voice" / pitch-voiced hops
//              (the share the gate hides when on; reported for gate off too)
//   warm / sust %  utterance-gate verdict "warming" / "sustained" over all posts
//   drawn %    posts where the row draws a position, all posts of all streams
//   nbF        median over N controls of the narrowband detector's final F (dB; on
//              below -34, off above -28); nbOn = streams where it ever turned on
//   lvl        median active speech level of the audio fed (dBFS, 0-8 kHz) / median of
//              the voiced-hop 25 ms RMS (dBFS, the diag's inputRms scale)
//   long       the 150 s unchanged stream: median shown u, SD of drawn u (jitter)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? `=${d}`).split("=").slice(1).join("=");
const CS = await import(pathToFileURL(path.join(repo, "src/components/cueStripModel.js")).href);
const VERD = ["silent", "warming", "score", "sustained", "pause", "stale"];
const CHS = 0.025, SEGS = 18, SR = 48000, CH = 1200;
const P_ = { k: 0, c: 1, u: 2, raw: 3, uPlain: 4, shownStartU: 5, startU: 6, fill: 7, voicedS: 8, verdict: 9, since: 10, nbOn: 11, nbDec: 12, voiced: 13, holding: 14 };
const q = (a, p) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const med = (a) => q(a, 0.5);
const sd = (a) => { if (a.length < 2) return null; const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };

export function loadRuns(dir) {
  return readdirSync(dir).filter((f) => /^runs-.*\.jsonl$/.test(f))
    .flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }));
}
/** Per post: t, u, drawn, row state (the resonance row as the cue strip shows it). */
export function postSeries(rec) {
  return rec.posts.map((p) => {
    const snap = { u: p[P_.u], raw: p[P_.raw], fill: p[P_.fill], voicedS: p[P_.voicedS], verdict: VERD[p[P_.verdict]], sinceResumeS: p[P_.since],
      narrowband: { on: !!p[P_.nbOn], decided: !!p[P_.nbDec] }, shownStartU: p[P_.shownStartU], startU: p[P_.startU] };
    const state = CS.cueRowStates({ pitchVoiced: !!p[P_.voiced], pitchHolding: !!p[P_.holding], pitchLevel: null, snap, workerStatus: "ready" }).resonance;
    const drawn = CS.dotOpacity(state) !== null && snap.u != null;
    return { k: p[P_.k], t: (p[P_.k] + 1) * CHS, u: p[P_.u], fill: p[P_.fill], verdict: snap.verdict, state, drawn };
  });
}
export function streamMetrics(rec) {
  const S = postSeries(rec);
  const filled = S.filter((x) => x.u != null && x.fill >= 1).map((x) => x.u);
  const firstPos = S.find((x) => x.u != null), firstDrawn = S.find((x) => x.drawn);
  const durS = (rec.n * CH) / SR;
  const verd = Object.fromEntries(VERD.map((v) => [v, 0])), states = {};
  for (const x of S) { verd[x.verdict]++; states[x.state] = (states[x.state] ?? 0) + 1; }
  const drawnU = S.filter((x) => x.drawn).map((x) => x.u);
  const nbDec = rec.posts.findIndex((p) => p[P_.nbDec]);
  return {
    id: rec.id, reader: rec.reader, sex: rec.sex, kind: rec.kind, variant: rec.variant, durS, S,
    medU: med(filled), nFilled: filled.length, medUdrawn: med(S.filter((x) => x.drawn && x.fill >= 1).map((x) => x.u)),
    sdDrawn: sd(drawnU), firstPos: firstPos ? firstPos.t : null, firstDrawn: firstDrawn ? firstDrawn.t : null,
    admPerS: rec.bins.filter((b) => b[3] && b[2] != null).length / durS,
    posts: S.length, drawn: S.filter((x) => x.drawn).length, verd, states,
    pitch: rec.pitchStats, nbFinalF: rec.nbFinal?.f ?? null, nbOn: rec.nbResets.length > 0 || rec.posts.some((p) => p[P_.nbOn]),
    nbDecidedT: nbDec >= 0 ? S[nbDec].t : null, level: rec.level, ms: rec.ms,
  };
}
function eventTimes(S, O, N, tj, dir) {
  let t50 = null, t90 = null, tAbs = null;
  for (let i = 0; i < S.length; i++) {
    const x = S[i];
    if (x.t <= tj + 1e-9 || x.t > tj + SEGS + 1e-9) continue;
    if (O[i].k !== x.k || N[i].k !== x.k) throw new Error("post grids differ");
    if (!x.drawn || x.u == null || O[i].u == null) continue;
    if (tAbs === null && (dir === "up" ? x.u - O[i].u >= 0.5 : O[i].u - x.u >= 0.5)) tAbs = x.t - tj;
    if (N[i].u == null || N[i].u === O[i].u) continue;
    const p = (x.u - O[i].u) / (N[i].u - O[i].u);
    if (t50 === null && p >= 0.5) t50 = x.t - tj;
    if (t90 === null && p >= 0.9) t90 = x.t - tj;
  }
  return { t50: t50 ?? SEGS, t90: t90 ?? SEGS, tAbs: tAbs ?? SEGS, c50: t50 === null, c90: t90 === null, cAbs: tAbs === null };
}
export function summarize(recs, baseRecs = null) {
  const M = new Map(recs.map((r) => [r.id, streamMetrics(r)]));
  const B = baseRecs ? new Map(baseRecs.map((r) => [r.id, streamMetrics(r)])) : null;
  const readers = [...new Set(recs.map((r) => r.reader))];
  const sexOf = Object.fromEntries(recs.map((r) => [r.reader, r.sex]));
  const get = (map, reader, v) => map?.get(`${reader}__${v}`) ?? null;
  // events
  const events = [];
  for (const r of recs.filter((x) => x.kind === "sw")) {
    const [A, Bv] = r.seq;
    const m = M.get(r.id), o1 = get(M, r.reader, A), n1 = get(M, r.reader, Bv);
    if (!o1 || !n1) continue;
    const up1 = Bv.startsWith("U");
    events.push({ id: r.id, reader: r.reader, sex: r.sex, dir: up1 ? "up" : "down", ...eventTimes(m.S, o1.S, n1.S, r.joins[0], up1 ? "up" : "down") });
    events.push({ id: r.id, reader: r.reader, sex: r.sex, dir: up1 ? "down" : "up", ...eventTimes(m.S, n1.S, o1.S, r.joins[1], up1 ? "down" : "up") });
  }
  const per = {};
  const perReader = [];
  for (const rd of readers) {
    const n = get(M, rd, "N"), u = get(M, rd, "U10"), d = get(M, rd, "D10"), L = get(M, rd, "L");
    const bn = get(B, rd, "N"), bu = get(B, rd, "U10"), bd = get(B, rd, "D10"), bL = get(B, rd, "L");
    const sens = u?.medU != null && d?.medU != null ? u.medU - d.medU : null;
    const bsens = bu?.medU != null && bd?.medU != null ? bu.medU - bd.medU : null;
    perReader.push({
      reader: rd, sex: sexOf[rd], medUN: n?.medU ?? null, bias: n?.medU != null && bn?.medU != null ? n.medU - bn.medU : null,
      sens, sensRatio: sens != null && bsens ? sens / bsens : null, firstPos: n?.firstPos ?? null, firstDrawn: n?.firstDrawn ?? null,
      admPerS: n?.admPerS ?? null, nbFinalF: n?.nbFinalF ?? null, medUL: L?.medU ?? null, biasL: L?.medU != null && bL?.medU != null ? L.medU - bL.medU : null,
      sdL: L?.sdDrawn ?? null, levelOut: n?.level?.outActiveDb ?? null, levelIn: n?.level?.inActiveDb ?? null, voicedRms: n?.level?.voicedHopRmsMedDb ?? null,
    });
  }
  for (const sex of ["m", "f"]) {
    const R = perReader.filter((x) => x.sex === sex);
    const all = [...M.values()].filter((x) => x.sex === sex);
    const E = events.filter((e) => e.sex === sex);
    const sum = (f) => all.reduce((a, x) => a + f(x), 0);
    const posts = sum((x) => x.posts);
    const ev = (dir, T) => { const xs = E.filter((e) => !dir || e.dir === dir); return { med: med(xs.map((e) => e[T])), n: xs.length, cens: xs.filter((e) => e[T === "t50" ? "c50" : T === "t90" ? "c90" : "cAbs"]).length }; };
    per[sex] = {
      readers: R.length, streams: all.length,
      medUN: med(R.map((x) => x.medUN)), bias: med(R.map((x) => x.bias)), biasMean: R.some((x) => x.bias != null) ? R.filter((x) => x.bias != null).reduce((a, x) => a + x.bias, 0) / R.filter((x) => x.bias != null).length : null,
      sens: med(R.map((x) => x.sens)), sensRatio: med(R.map((x) => x.sensRatio)),
      t50: ev(null, "t50"), t90: ev(null, "t90"), t50up: ev("up", "t50"), t50down: ev("down", "t50"), t90up: ev("up", "t90"), t90down: ev("down", "t90"), tAbs: ev(null, "tAbs"),
      firstPos: med(R.map((x) => x.firstPos)), firstDrawn: med(R.map((x) => x.firstDrawn)), admPerS: med(R.map((x) => x.admPerS)),
      voicedShare: sum((x) => x.pitch.voiced) / Math.max(1, sum((x) => x.pitch.hops)),
      hiddenShare: sum((x) => x.pitch.hidden) / Math.max(1, sum((x) => x.pitch.voiced)),
      vadVoiceShare: sum((x) => x.pitch.vadVoice) / Math.max(1, sum((x) => x.pitch.hops)),
      verdict: Object.fromEntries(VERD.map((v) => [v, sum((x) => x.verd[v]) / Math.max(1, posts)])),
      states: Object.fromEntries([...new Set(all.flatMap((x) => Object.keys(x.states)))].map((s) => [s, sum((x) => x.states[s] ?? 0) / Math.max(1, posts)])),
      drawnShare: sum((x) => x.drawn) / Math.max(1, posts),
      nbFinalF: med(R.map((x) => x.nbFinalF)), nbOnStreams: all.filter((x) => x.nbOn).length,
      levelOut: med(R.map((x) => x.levelOut)), levelIn: med(R.map((x) => x.levelIn)), voicedRms: med(R.map((x) => x.voicedRms)),
      medUL: med(R.map((x) => x.medUL)), biasL: med(R.map((x) => x.biasL)), sdL: med(R.map((x) => x.sdL)),
      msPitchPer54s: med(all.filter((x) => x.kind !== "long").map((x) => x.ms.pitch / 1000 * 54 / x.durS)),
      msBinsPer54s: med(all.filter((x) => x.kind !== "long").map((x) => x.ms.bins / 1000 * 54 / x.durS)),
    };
  }
  return { per, perReader, events };
}

const f = (x, d = 2) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
const pc = (x) => (x == null ? "—" : (100 * x).toFixed(1));
const tc = (e) => (e.n ? `${f(e.med, 1)}${e.cens ? `(${e.cens}c)` : ""}` : "—");
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const dirs = arg("runs", "").split(",").filter(Boolean).map((d) => path.resolve(d));
  if (!dirs.length) throw new Error("--runs=<cond dir>[,...]");
  const baseDir = path.resolve(arg("base", path.join(path.dirname(dirs[0]), "clean")));
  const baseAll = existsSync(baseDir) ? loadRuns(baseDir) : [];
  const gates = arg("gate", "both") === "both" ? ["on", "off"] : [arg("gate", "both")];
  const out = {};
  const rows = [];
  for (const d of dirs) {
    const all = loadRuns(d);
    for (const g of gates) {
      const recs = all.filter((r) => r.gate === g);
      if (!recs.length) continue;
      const cond = recs[0].cond, hd = recs[0].hintDelay ?? 0;
      const ids = new Set(recs.map((r) => r.id));
      const base = baseAll.filter((r) => r.gate === g && ids.has(r.id) && (r.hintDelay ?? 0) === 0);
      const s = summarize(recs, base.length ? base : null);
      out[`${cond}|${g}${hd ? `|hd${hd}` : ""}`] = { cond, gate: g, hintDelay: hd, pert: recs[0].pert, base: base.length ? baseDir : null, ...s, events: s.events };
      for (const sex of ["m", "f"]) if (s.per[sex].streams) rows.push({ cond: `${cond}${hd ? ` hd${hd}` : ""}`, g, sex, ...s.per[sex] });
      if (process.argv.includes("--readers")) {
        console.log(`\n${cond} gate ${g}: per reader`);
        console.log("reader\tsex\tmedU N\tbias\tsens\tsens/base\tfirstPos\tfirstDrawn\tadm/s\tnbF\tlvlOut\tvoicedRms\tbiasL\tsdL");
        for (const x of s.perReader) console.log([x.reader, x.sex, f(x.medUN), f(x.bias), f(x.sens), f(x.sensRatio), f(x.firstPos, 1), f(x.firstDrawn, 1), f(x.admPerS, 2), f(x.nbFinalF, 1), f(x.levelOut, 1), f(x.voicedRms, 1), f(x.biasL), f(x.sdL, 3)].join("\t"));
      }
    }
  }
  console.log("\ncond\tgate\tsex\tn\tmedU N\tbias\tsens\tsens/base\tT50 ↑/↓\tT90 ↑/↓\ttAbs0.5\tfirstPos\tfirstDrawn\tadm/s\tvoiced%\thid%\twarm%\tsust%\tdrawn%\tnbF\tnbOn\tlvl/voicedRms\tlong medU / bias / SD\tpitch s/54s\tbins s/54s");
  for (const r of rows) {
    console.log([r.cond, r.g, r.sex, r.readers, f(r.medUN), f(r.bias), f(r.sens), f(r.sensRatio), `${tc(r.t50up)}/${tc(r.t50down)}`, `${tc(r.t90up)}/${tc(r.t90down)}`, tc(r.tAbs),
      f(r.firstPos, 1), f(r.firstDrawn, 1), f(r.admPerS), pc(r.voicedShare), pc(r.hiddenShare), pc(r.verdict.warming), pc(r.verdict.sustained), pc(r.drawnShare),
      f(r.nbFinalF, 1), r.nbOnStreams, `${f(r.levelOut, 1)}/${f(r.voicedRms, 1)}`, `${f(r.medUL)} / ${f(r.biasL)} / ${f(r.sdL, 3)}`, f(r.msPitchPer54s, 1), f(r.msBinsPer54s, 1)].join("\t"));
  }
  if (arg("json", "")) writeFileSync(arg("json", ""), JSON.stringify(out, (k, v) => (k === "S" ? undefined : v), 1));
}
